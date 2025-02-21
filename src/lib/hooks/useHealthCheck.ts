import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { ref, onValue, off } from "firebase/database";
import { db } from "./firebase";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
const TIMEOUT_MESSAGE =
    "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    secondsLeft: number;
};

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

const configureSocketListeners = (
    socket: Socket,
    currentState: StateKey,
    handlers: {
        onData: (data: SensorData) => void;
        onError: () => void;
    }
) => {
    socket.removeAllListeners();
    socket.on("connect_error", handlers.onError);
    socket.on("error", handlers.onError);

    if (currentState === "TEMPERATURE") {
        socket.on("temperature", handlers.onData);
    }
};

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();
    const [state, setState] = useState<Omit<HealthCheckState, "secondsLeft">>({
        currentState: "TEMPERATURE",
        stabilityTime: 0,
        temperatureData: { temperature: 0 },
        alcoholData: { alcoholLevel: "Не определено" },
    });
    const [secondsLeft, setSecondsLeft] = useState(15);

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
        alcoholMeasured: false,
    }).current;

    const updateState = useCallback(
        <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
            setState((prev) => ({ ...prev, ...updates }));
        },
        []
    );

    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;

        refs.hasTimedOut = true;
        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: {
                background: "#272727",
                color: "#fff",
                borderRadius: "8px",
            },
        });
        navigate("/");
    }, [navigate]);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) return;
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            updateState({
                stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
                temperatureData:
                    state.currentState === "TEMPERATURE"
                        ? { temperature: Number(data.temperature!) }
                        : state.temperatureData,
            });
        },
        [state.currentState, state.stabilityTime, state.temperatureData, updateState, handleTimeout]
    );

    const setupSocketForState = useCallback(
        (socket: Socket, currentState: StateKey) => {
            configureSocketListeners(socket, currentState, {
                onData: handleDataEvent,
                onError: handleTimeout,
            });
        },
        [handleDataEvent, handleTimeout]
    );

    const listenToAlcoholData = useCallback(() => {
        const alcoholRef = ref(db, "alcohol_value");

        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        const unsubscribe = onValue(alcoholRef, (snapshot) => {
            if (refs.alcoholMeasured) return;

            const data = snapshot.val();
            if (!data) {
                return;
            }

            let alcoholStatus = "Не определено";
            if (data.sober === 0) alcoholStatus = "Трезвый";
            else if (data.drunk === 0) alcoholStatus = "Пьяный";

            updateState({
                alcoholData: { alcoholLevel: alcoholStatus },
            });

            clearTimeout(refs.timeout!);

            if (!refs.alcoholMeasured && (data.sober === 0 || data.drunk === 0)) {
                refs.alcoholMeasured = true;
                setTimeout(() => {
                    navigate("/complete-authentication");
                }, 500);
            }
        });

        return () => {
            off(alcoholRef, "value", unsubscribe);
            clearTimeout(refs.timeout!);
        };
    }, [navigate, handleTimeout]);

    useEffect(() => {
        refs.hasTimedOut = false;

        const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });

        refs.socket = socket;
        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        setupSocketForState(socket, state.currentState);

        const stabilityInterval = setInterval(() => {
            if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
                updateState({
                    stabilityTime: Math.max(state.stabilityTime - 1, 0),
                });
            }
        }, STABILITY_UPDATE_INTERVAL);

        let cleanupAlcohol: (() => void) | undefined;
        if (state.currentState === "ALCOHOL") {
            cleanupAlcohol = listenToAlcoholData();
        }

        return () => {
            socket.disconnect();
            clearTimeout(refs.timeout!);
            clearInterval(stabilityInterval);
            if (cleanupAlcohol) cleanupAlcohol();
        };
    }, [
        state.currentState,
        state.stabilityTime,
        handleTimeout,
        handleDataEvent,
        setupSocketForState,
        listenToAlcoholData,
        updateState,
    ]);

    useEffect(() => {
        setSecondsLeft(15);
        const interval = setInterval(() => {
            setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(interval);
    }, [state.currentState]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            updateState({
                currentState: STATE_SEQUENCE[currentIndex + 1],
                stabilityTime: 0,
            });
            refs.isSubmitting = false;
            return;
        }

        try {
            refs.socket?.disconnect();
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");

            const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bpmData: 0,
                    temperatureData: state.temperatureData,
                    alcoholData: state.alcoholData,
                    faceId,
                }),
            });

            if (!response.ok) throw new Error("Request failed");

            localStorage.setItem(
                "results",
                JSON.stringify({
                    bpm: 0,
                    temperature: state.temperatureData.temperature,
                    alcohol: state.alcoholData.alcoholLevel,
                })
            );

            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            refs.isSubmitting = false;
        }
    }, [state, navigate, refs, updateState]);

    return {
        ...state,
        secondsLeft,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};

// import { useState, useEffect, useCallback, useRef } from "react";
// import { useNavigate } from "react-router-dom";
// import { ref, onValue, off } from "firebase/database";
// import { db } from "./firebase"; // ✅ Firebase instance
// import { io } from "socket.io-client"; // ✅ WebSocket client
// import toast from "react-hot-toast";

// // ✅ Define type for `StateKey`
// export type StateKey = "TEMPERATURE" | "ALCOHOL";

// export type HealthCheckState = {
//     currentState: StateKey;
//     stabilityTime: number;
//     temperatureData: { temperature: number };
//     alcoholData: { alcoholLevel: string };
//     validAlcoholReceived: boolean;
//     secondsLeft: number;
// };

// // ✅ WebSocket connection (Replace with your backend URL)
// const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
//     transports: ["websocket", "polling"],
//     secure: true,
//     reconnection: true,
// });

// const SOCKET_TIMEOUT = 15000;
// const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// export const useHealthCheck = (): HealthCheckState & {
//     handleComplete: () => Promise<void>;
// } => {
//     const navigate = useNavigate();
//     const [state, setState] = useState<HealthCheckState>({
//         currentState: "TEMPERATURE",
//         stabilityTime: 0,
//         temperatureData: { temperature: 0 },
//         alcoholData: { alcoholLevel: "Не определено" },
//         validAlcoholReceived: false,
//         secondsLeft: 15,
//     });

//     const refs = useRef({
//         timeout: null as NodeJS.Timeout | null,
//         hasTimedOut: false,
//     }).current;

//     // ✅ Handle timeout - redirect user to home if no valid alcohol data
//     const handleTimeout = useCallback(() => {
//         if (refs.hasTimedOut) return;
//         refs.hasTimedOut = true;

//         toast.error(TIMEOUT_MESSAGE, {
//             duration: 3000,
//             style: { background: "#272727", color: "#fff", borderRadius: "8px" },
//         });

//         navigate("/");
//     }, [navigate]);

//     // ✅ Listen for temperature data via WebSocket
//     const listenToTemperatureData = useCallback(() => {
//         console.log("✅ Listening for temperature via WebSocket...");

//         socket.on("temperature", (data) => {
//             console.log("📡 Temperature data received:", data);

//             setState((prev) => ({
//                 ...prev,
//                 temperatureData: { temperature: Number(data.temperature) || 0 },
//             }));
//         });

//         return () => {
//             socket.off("temperature");
//         };
//     }, []);

//     // ✅ Listen for alcohol data via Firebase
//     const listenToAlcoholData = useCallback(() => {
//         const alcoholRef = ref(db, "alcohol_value");
//         console.log("📡 Listening to Firebase alcohol data...");

//         refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

//         const unsubscribe = onValue(alcoholRef, (snapshot) => {
//             const data = snapshot.val();
//             if (!data) {
//                 console.warn("⚠️ No alcohol data received from Firebase.");
//                 return;
//             }

//             console.log("📡 Alcohol data received from Firebase:", data);

//             let alcoholStatus = "Не определено";
//             if (data.sober === 0) alcoholStatus = "Трезвый";
//             else if (data.drunk === 0) alcoholStatus = "Пьяный";

//             const isValidAlcoholData = data.sober === 0 || data.drunk === 0;

//             setState((prev) => ({
//                 ...prev,
//                 alcoholData: { alcoholLevel: alcoholStatus },
//                 validAlcoholReceived: isValidAlcoholData,
//             }));

//             if (isValidAlcoholData) {
//                 console.log("✅ Alcohol measurement finalized. Saving and navigating...");

//                 localStorage.setItem("results", JSON.stringify({
//                     temperature: state.temperatureData.temperature,
//                     alcohol: alcoholStatus,
//                 }));

//                 clearTimeout(refs.timeout!);

//                 setTimeout(() => {
//                     navigate("/complete-authentication");
//                 }, 500);
//             }
//         });

//         return () => {
//             off(alcoholRef, "value", unsubscribe);
//             clearTimeout(refs.timeout!);
//         };
//     }, [navigate, handleTimeout]);

//     useEffect(() => {
//         // ✅ Start WebSocket temperature listener
//         const cleanupTemperature = listenToTemperatureData();

//         // ✅ Start Firebase alcohol listener
//         const cleanupAlcohol = listenToAlcoholData();

//         return () => {
//             cleanupTemperature();
//             cleanupAlcohol();
//         };
//     }, [listenToTemperatureData, listenToAlcoholData]);

//     // ✅ Fix `handleComplete` to return a Promise<void>
//     const handleComplete = useCallback(async (): Promise<void> => {
//         return new Promise<void>((resolve) => {
//             listenToAlcoholData();
//             resolve();
//         });
//     }, [listenToAlcoholData]);

//     return {
//         ...state,
//         handleComplete,
//     };
// };
