import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { toast } from "react-toastify";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7; // 7 seconds for progress completion
const SOCKET_TIMEOUT = 15000; // 7 seconds timeout before showing an error

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
        secondsLeft: 7,
    });

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
        finalAlcoholLevel: "", // Store the final alcohol level
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
        console.warn("⏳ Timeout reached, showing error and navigating home...");

        toast.error("Ошибка измерения. Пожалуйста, попробуйте снова.");
        navigate("/", { replace: true });
    }, [navigate]);
    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || state.currentState !== "ALCOHOL") return;
        refs.isSubmitting = true;
    
        try {
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
    
            console.log("✅ Authentication complete, navigating to authentication screen...");
            
            // ✅ Prevent state updates after authentication completes
            refs.finalAlcoholLevel = "COMPLETED"; 
    
            navigate("/complete-authentication", { replace: true });
    
        } catch (error) {
            console.error("❌ Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate]);
    
    const handleDataEvent = useCallback(
        (data: SensorData) => {
            console.log("📡 Received sensor data:", JSON.stringify(data));
    
            if (!data || (!data.temperature && !data.alcoholLevel)) {
                console.warn("⚠️ No valid sensor data received");
                return;
            }
    
            // ✅ Stop updates if authentication is already completed
            if (refs.finalAlcoholLevel === "COMPLETED") {
                console.warn("🚫 Ignoring updates after authentication is complete.");
                return;
            }
    
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT); // ⏳ Reset timeout to 15s
    
            let alcoholStatus = refs.finalAlcoholLevel || state.alcoholData.alcoholLevel;
            if (data.alcoholLevel !== undefined && data.alcoholLevel !== null) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
                refs.finalAlcoholLevel = alcoholStatus; // Store final alcohol state
            }
    
            setState((prev) => {
                let nextState = prev.currentState;
                let nextStabilityTime = prev.stabilityTime + 1;
    
                if (prev.currentState === "TEMPERATURE") {
                    if (nextStabilityTime >= MAX_STABILITY_TIME) {
                        nextState = "ALCOHOL";
                        nextStabilityTime = 0;
                        console.log("🔌 Switching to ALCOHOL state, disconnecting temperature WebSocket...");
                        refs.socket?.off("temperature");
                    }
                }
    
                if (prev.currentState === "ALCOHOL") {
                    if (refs.finalAlcoholLevel !== "") {
                        nextStabilityTime = prev.stabilityTime + 1; // Start progress when final alcohol state is received
                    }
    
                    if (nextStabilityTime >= MAX_STABILITY_TIME) {
                        console.log("✅ Alcohol measurement complete, navigating to authentication...");
                        handleComplete();
                        return prev; // ✅ Stop state updates after authentication
                    }
                }
    
                return {
                    ...prev,
                    stabilityTime: nextStabilityTime,
                    temperatureData: prev.currentState === "TEMPERATURE"
                        ? { temperature: parseFloat(Number(data.temperature).toFixed(2)) || 0 }
                        : prev.temperatureData,
                    alcoholData: prev.currentState === "ALCOHOL"
                        ? { alcoholLevel: refs.finalAlcoholLevel || "Не определено" }
                        : prev.alcoholData,
                    currentState: nextState,
                };
            });
        },
        [handleComplete]
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

        refs.socket.off("temperature");
        refs.socket.off("alcohol");
        refs.socket.off("camera");

        console.log(`🔄 Setting up WebSocket listeners for state: ${state.currentState}`);

        if (state.currentState === "TEMPERATURE") {
            refs.socket.on("temperature", handleDataEvent);
        } else if (state.currentState === "ALCOHOL") {
            refs.socket.on("alcohol", handleDataEvent);
        }

        refs.socket.on("camera", handleDataEvent);

        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT); // Start the timeout
    }, [state.currentState, handleTimeout, handleDataEvent]);

  

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
