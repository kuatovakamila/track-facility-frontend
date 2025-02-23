import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;

// Define sensor data types
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

const configureSocketListeners = (
    socket: Socket,
    currentState: StateKey,
    handlers: {
        onData: (data: SensorData) => void;
        onError: () => void;
    }
) => {
    socket.off("temperature");
    socket.off("alcohol");
    socket.off("camera");

    console.log(`🔄 Setting up WebSocket listeners for state: ${currentState}`);

    if (currentState === "TEMPERATURE") {
        socket.on("temperature", handlers.onData);
    } else if (currentState === "ALCOHOL") {
        socket.on("alcohol", handlers.onData);
    }

    socket.on("camera", handlers.onData);
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
        console.warn("⏳ Timeout reached, checking retry mechanism...");
    
        if (state.currentState === "ALCOHOL") {
            // ✅ Instead of navigating away, retry fetching alcohol data
            refs.hasTimedOut = false; // Reset timeout flag
            refs.socket?.emit("request-alcohol-data"); // Ask server to resend data
        }
    }, [state.currentState]);
    
    const handleDataEvent = useCallback(
        (data: SensorData) => {
            console.log("📡 Received sensor data:", JSON.stringify(data));
    
            if (!data || (!data.temperature && !data.alcoholLevel)) {
                console.warn("⚠️ No valid sensor data received");
                return;
            }
    
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
    
            let alcoholStatus = "Не определено";
            if (data.alcoholLevel !== undefined && data.alcoholLevel !== null) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }
    
            setState((prev) => {
                const isTemperatureStable =
                    prev.currentState === "TEMPERATURE" &&
                    prev.stabilityTime + 1 >= MAX_STABILITY_TIME;
    
                const nextState = isTemperatureStable ? "ALCOHOL" : prev.currentState;
    
                // ✅ Disconnect temperature WebSocket when transitioning to ALCOHOL
                if (isTemperatureStable && refs.socket) {
                    console.log("🔌 Disconnecting temperature WebSocket...");
                    refs.socket.off("temperature");
                }
    
                return {
                    ...prev,
                    stabilityTime: isTemperatureStable ? 0 : prev.stabilityTime + 1,
                    temperatureData: prev.currentState === "TEMPERATURE"
                        ? { temperature: parseFloat(Number(data.temperature).toFixed(2)) || 0 }
                        : prev.temperatureData,
                    alcoholData: prev.currentState === "ALCOHOL"
                        ? { alcoholLevel: alcoholStatus }
                        : prev.alcoholData,
                    currentState: nextState,
                };
            });
        },
        []
    );
    
    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io('http://localhost:3001', {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
            });
        }
        configureSocketListeners(refs.socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });
    }, [state.currentState, handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || state.currentState !== "ALCOHOL") return;
        refs.isSubmitting = true;
    
        try {
            console.log("📝 Saving final temperature and alcohol data...");
    
            // ✅ Save final temperature and alcohol data before disconnecting WebSockets
            setState((prev) => ({
                ...prev,
                temperatureData: prev.temperatureData || { temperature: 0 },
                alcoholData: prev.alcoholData || { alcoholLevel: "Не определено" },
            }));
    
            console.log("✅ Final Data Saved:", state.temperatureData, state.alcoholData);
    
            console.log("🔌 Disconnecting all WebSockets before authentication...");
            refs.socket?.off("temperature");
            refs.socket?.off("alcohol");
            refs.socket?.disconnect();
    
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");
    
            console.log("🚀 Submitting health check data...");
            const response = await fetch(`http://localhost:3001/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    temperatureData: state.temperatureData,
                    alcoholData: state.alcoholData,
                    faceId,
                }),
            });
    
            if (!response.ok) throw new Error("Request failed");
    
            console.log("✅ Navigation to complete authentication...");
            navigate("/complete-authentication", { replace: true });
    
        } catch (error) {
            console.error("❌ Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate, refs]);
    
    
    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) => updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
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
