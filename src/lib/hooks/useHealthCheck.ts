import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
    cameraStatus?: 'failed' | 'success';
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
    socket.off("connect_error");
    socket.off("error");
    socket.off("temperature");
    socket.off("alcohol");
    socket.off("camera");

    socket.on("connect_error", handlers.onError);
    socket.on("error", handlers.onError);

    if (currentState === "TEMPERATURE") {
        socket.on("temperature", handlers.onData);
    }

    if (currentState === "ALCOHOL") {
        socket.on("alcohol", handlers.onData);
    }

    socket.on("camera", (data) => {
        console.log("📡 Camera Data Received:", data);
        handlers.onData(data);
    });
};

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();
    const [state, setState] = useState<HealthCheckState>({
        currentState: "TEMPERATURE",
        stabilityTime: 0,
        temperatureData: { temperature: 0 },
        alcoholData: { alcoholLevel: "Не определено" },
        secondsLeft: 15,
    });

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
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
            style: { background: "#272727", color: "#fff", borderRadius: "8px" },
        });
        navigate("/");
    }, [navigate]);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) {
                console.warn("⚠️ Received empty data packet");
                return;
            }

            console.log("📡 Full sensor data received:", data);
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            setState((prev) => {
                if (prev.currentState === "ALCOHOL") {
                    console.log("✅ Alcohol data received, instantly completing progress.");
                    return {
                        ...prev,
                        stabilityTime: MAX_STABILITY_TIME, // ✅ Instantly set progress to max
                        alcoholData: { alcoholLevel: alcoholStatus },
                    };
                }

                return {
                    ...prev,
                    stabilityTime: prev.currentState === "TEMPERATURE"
                        ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                        : prev.stabilityTime,
                    temperatureData: prev.currentState === "TEMPERATURE"
                        ? { temperature: Number(data.temperature) || 0 }
                        : prev.temperatureData,
                };
            });

            // 🚀 Immediately trigger handleComplete when alcohol data is received
            if (state.currentState === "ALCOHOL") {
                setTimeout(handleComplete, 300);
            }
        },
        [handleTimeout]
    );

    useEffect(() => {
        if (refs.socket) return;
        refs.hasTimedOut = false;

        const socket = io('http://localhost:3001', {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 10000,
        });

        socket.on("connect", () => {
            console.log("✅ WebSocket connected successfully.");
            refs.socket = socket;
        });

        socket.on("disconnect", (reason) => {
            console.warn("⚠️ WebSocket disconnected:", reason);
        });

        configureSocketListeners(socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });

        return () => {
            socket.disconnect();
            refs.socket = null;
        };
    }, [state.currentState, handleTimeout, handleDataEvent, navigate]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Checking state sequence...");

        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            updateState({
                currentState: STATE_SEQUENCE[currentIndex + 1],
                stabilityTime: 0, // ✅ Reset stability time
            });

            refs.isSubmitting = false;
            return;
        }

        try {
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("❌ Face ID not found");

            const finalData = {
                temperatureData: state.temperatureData,
                alcoholData: state.alcoholData,
                faceId,
            };

            console.log("📡 Sending final data:", finalData);

            const response = await fetch(`http:localhost:3001/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(finalData),
            });

            if (!response.ok) {
                throw new Error(`❌ Server responded with status: ${response.status}`);
            }

            console.log("✅ Submission successful, navigating to complete authentication...");

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            refs.socket?.disconnect();

            navigate("/complete-authentication", { state: { success: true } });

        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.");
            refs.isSubmitting = false;
        }
    }, [state, navigate, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState: React.SetStateAction<StateKey>) =>
            updateState({
                currentState: typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};



// import { useState, useEffect, useCallback, useRef } from "react";
// import { useNavigate } from "react-router-dom";
// import { io, type Socket } from "socket.io-client";
// import { ref, onValue } from "firebase/database";
// import { db } from "./firebase";
// import { StateKey } from "../constants";
// import toast from "react-hot-toast";

// const MAX_STABILITY_TIME = 7;
// const SOCKET_TIMEOUT = 15000;
// const STABILITY_UPDATE_INTERVAL = 1000;
// const COUNTDOWN_TIME = 15;

// const TIMEOUT_MESSAGE =
// 	"Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// type SensorData = {
// 	temperature?: string;
// 	alcoholLevel?: string;
// };

// type HealthCheckState = {
// 	currentState: StateKey;
// 	stabilityTime: number;
// 	temperatureData: { temperature: number };
// 	alcoholData: { alcoholLevel: string };
// 	secondsLeft: number;
// 	progress: number;
// };

// const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

// export const useHealthCheck = (): HealthCheckState & {
// 	handleComplete: () => Promise<void>;
// 	setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
// } => {
// 	const navigate = useNavigate();
// 	const [state, setState] = useState<HealthCheckState>({
// 		currentState: STATE_SEQUENCE[0],
// 		stabilityTime: 0,
// 		temperatureData: { temperature: 0 },
// 		alcoholData: { alcoholLevel: "Не определено" },
// 		secondsLeft: COUNTDOWN_TIME,
// 		progress: 0,
// 	});

// 	/** ✅ NEW: Stop All Actions After Completion */
// 	const refs = useRef({
// 		socket: null as Socket | null,
// 		timeout: null as NodeJS.Timeout | null,
// 		lastDataTime: Date.now(),
// 		stopAll: false,
// 		hasTimedOut: false,
// 		stabilityInterval: null as NodeJS.Timeout | null,
// 		processCompleted: false, // ✅ Ensures process only runs ONCE
// 	}).current;

// 	const updateState = useCallback(
// 		<K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
// 			setState((prev) => ({ ...prev, ...updates }));
// 		},
// 		[]
// 	);

// 	const handleTimeout = useCallback(() => {
// 		if (refs.stopAll || refs.hasTimedOut) return;
// 		refs.hasTimedOut = true;

// 		toast.error(TIMEOUT_MESSAGE, {
// 			duration: 3000,
// 			style: { background: "#272727", color: "#fff", borderRadius: "8px" },
// 		});
// 		navigate("/");
// 	}, [navigate]);

// 	const handleComplete = useCallback(async () => {
// 		if (refs.processCompleted) return; // ✅ Prevent multiple executions
// 		refs.processCompleted = true; // ✅ Mark process as completed
// 		refs.stopAll = true;

// 		console.log("🎉 Health check complete! Navigating to /complete-authentication");

// 		if (refs.socket) {
// 			console.log("🔌 Disconnecting WebSocket...");
// 			refs.socket.disconnect();
// 			refs.socket = null;
// 		}

// 		clearTimeout(refs.timeout!);
// 		refs.timeout = null;

// 		setTimeout(() => navigate("/complete-authentication", { state: { success: true } }), 100);
// 	}, [navigate]);

// 	const handleDataEvent = useCallback(
// 		(data: SensorData) => {
// 			if (!data || refs.stopAll) return;

// 			refs.lastDataTime = Date.now();
// 			clearTimeout(refs.timeout!);
// 			refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

// 			if (state.currentState === "TEMPERATURE" && data.temperature) {
// 				const newTemperature = Number(data.temperature);

// 				setState((prev) => {
// 					const newStabilityTime = Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME);
// 					const newProgress = (newStabilityTime / MAX_STABILITY_TIME) * 100;

// 					if (newStabilityTime >= MAX_STABILITY_TIME) {
// 						console.log("✅ Temperature stabilized! Moving to next state...");
// 						const nextStateIndex = STATE_SEQUENCE.indexOf(prev.currentState) + 1;
// 						if (nextStateIndex < STATE_SEQUENCE.length) {
// 							updateState({ currentState: STATE_SEQUENCE[nextStateIndex], stabilityTime: 0, progress: 0 });
// 						} else {
// 							handleComplete();
// 						}
// 					}

// 					return {
// 						...prev,
// 						stabilityTime: newStabilityTime,
// 						temperatureData: { temperature: newTemperature },
// 						progress: newProgress,
// 					};
// 				});
// 			}
// 		},
// 		[state.currentState, handleTimeout, updateState]
// 	);

// 	const listenToAlcoholData = useCallback(() => {
// 		if (refs.processCompleted) return; // ✅ Prevent re-listening

// 		const alcoholRef = ref(db, "alcohol_value");
// 		console.log("📡 Listening to Firebase alcohol data...");

// 		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

// 		const unsubscribe = onValue(alcoholRef, (snapshot) => {
// 			if (refs.processCompleted) return; // ✅ Prevent execution after completion

// 			const data = snapshot.val();
// 			if (!data) {
// 				console.warn("⚠️ No alcohol data received from Firebase.");
// 				return;
// 			}

// 			console.log("📡 Alcohol data received from Firebase:", data);

// 			let alcoholStatus = "Не определено";
// 			if (data.sober === 0) alcoholStatus = "Трезвый";
// 			else if (data.drunk === 0) alcoholStatus = "Пьяный";

// 			if (alcoholStatus !== "Не определено") {
// 				console.log("✅ Final alcohol status detected:", alcoholStatus);

// 				setState((prev) => ({
// 					...prev,
// 					alcoholData: { alcoholLevel: alcoholStatus },
// 				}));

// 				clearTimeout(refs.timeout!);
// 				unsubscribe();

// 				console.log("🚀 Executing handleComplete()");
// 				handleComplete();
// 			}
// 		});

// 		return () => {
// 			console.log("❌ Stopping alcohol listener.");
// 			unsubscribe();
// 			clearTimeout(refs.timeout!);
// 		};
// 	}, [handleComplete, handleTimeout]);

// 	useEffect(() => {
// 		if (state.currentState === "ALCOHOL") {
// 			const cleanupAlcohol = listenToAlcoholData();
// 			return () => {
// 				if (cleanupAlcohol) cleanupAlcohol();
// 			};
// 		}
// 	}, [state.currentState, listenToAlcoholData]);

// 	useEffect(() => {
// 		if (refs.processCompleted) return;

// 		const socket = io("http://localhost:3001", { transports: ["websocket"], reconnection: false });

// 		refs.socket = socket;
// 		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

// 		socket.on("temperature", handleDataEvent);

// 		return () => {
// 			console.log("🛑 Cleanup: Disconnecting WebSocket...");
// 			socket.disconnect();
// 			clearTimeout(refs.timeout!);
// 		};
// 	}, [state.currentState, handleTimeout]);

// 	return {
// 		...state,
// 		handleComplete,
// 		setCurrentState: (newState: React.SetStateAction<StateKey>) =>
// 			updateState({
// 				currentState: typeof newState === "function" ? newState(state.currentState) : newState,
// 			}),
// 	};
// };
