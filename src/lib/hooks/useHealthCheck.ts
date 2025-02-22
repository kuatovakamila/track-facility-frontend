import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { ref, onValue, off } from "firebase/database"; // Firebase imports
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import { db } from "./firebase"; // Import Firebase config

// Initialize Firebase


// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;

type SensorData = {
    temperature?: string;
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
    socket.off("camera");

    if (currentState === "TEMPERATURE") {
        socket.on("temperature", handlers.onData);
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
        hasNavigated: false,
        sessionCount: 0,
        alcoholReceived: false, // ✅ Ensure alcohol data is received before completing session
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
        navigate("/");
    }, [navigate]);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) {
                console.warn("⚠️ Received empty data packet");
                return;
            }

            console.log("📡 Sensor data received:", data);
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            setState((prev) => ({
                ...prev,
                stabilityTime: prev.currentState === "TEMPERATURE"
                    ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                    : prev.stabilityTime,
                temperatureData: prev.currentState === "TEMPERATURE"
                    ? { temperature: Number(data.temperature) || 0 }
                    : prev.temperatureData,
            }));

            // ✅ Move to ALCOHOL state only after stability is reached
            if (state.currentState === "TEMPERATURE" && state.stabilityTime >= MAX_STABILITY_TIME) {
                updateState({ currentState: "ALCOHOL", stabilityTime: 0 });
            }
        },
        [handleTimeout]
    );

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001', {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: 20,
                reconnectionDelay: 10000,
            });

            refs.socket.on("connect", () => {
                console.log("✅ WebSocket connected.");
            });

            refs.socket.on("disconnect", (reason) => {
                console.warn("⚠️ WebSocket disconnected:", reason);
                refs.socket = null;
            });
        }

        if (state.currentState === "TEMPERATURE") {
            configureSocketListeners(refs.socket, state.currentState, {
                onData: handleDataEvent,
                onError: handleTimeout,
            });
        }

        return () => {
            console.log("🛑 Not cleaning up event listeners until authentication is fully done...");
        };
    }, [state.currentState, handleTimeout, handleDataEvent]);
    useEffect(() => {
        if (state.currentState === "ALCOHOL") {
            const alcoholRef = ref(db, "alcohol_value"); // Adjust if path differs
    
            const listener = onValue(alcoholRef, (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    console.log("📡 Alcohol data received from Firebase:", data);
    
                    let alcoholStatus = "Не определено";
    
                    if (data.sober === 1 && data.drunk === 0) {
                        alcoholStatus = "Трезвый";
                    } else if (data.sober === 0 && data.drunk === 1) {
                        alcoholStatus = "Пьяный";
                    }
    
                    updateState({
                        alcoholData: { alcoholLevel: alcoholStatus },
                        stabilityTime: MAX_STABILITY_TIME,
                    });
    
                    refs.alcoholReceived = true;
    
                    // ✅ Only complete if alcohol data is fully received
                    if (refs.alcoholReceived) {
                        setTimeout(handleComplete, 300);
                    }
                }
            });
    
            return () => {
                off(alcoholRef, "value", listener);
            };
        }
    }, [state.currentState]);
    

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        try {
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("❌ Face ID not found");

            console.log("📡 Sending final data...");

            refs.hasNavigated = true;
            refs.sessionCount += 1;

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            navigate("/complete-authentication", { state: { success: true } });

            setTimeout(() => {
                console.log("⏳ Returning to home and preparing next session...");
                navigate("/");

                setTimeout(() => {
                    console.log(`🔄 Starting new session #${refs.sessionCount + 1}`);
                    updateState({
                        currentState: "TEMPERATURE",
                        stabilityTime: 0,
                        temperatureData: { temperature: 0 },
                        alcoholData: { alcoholLevel: "Не определено" },
                        secondsLeft: 15,
                    });
                    refs.alcoholReceived = false;
                }, 1000);
            }, 4000);
        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.");
            refs.isSubmitting = false;
        } finally {
            setTimeout(() => {
                console.log("🛑 Now disconnecting WebSocket after authentication is fully completed...");
                refs.socket?.disconnect();
                refs.socket = null;
            }, 5000);
        }
    }, [state, navigate, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
