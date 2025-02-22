import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { DataSnapshot, ref, onValue, off } from "firebase/database";
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import { db } from "./firebase"; 

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

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();
    const [state, setState] = useState<HealthCheckState>({
        currentState: STATE_SEQUENCE[0], // ✅ Start with first state
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
        alcoholReceived: false,
        temperatureReceived: false, // ✅ Track if temperature has been processed
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

    // ✅ Handles state transition
    const moveToNextState = useCallback(() => {
        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            updateState({ currentState: STATE_SEQUENCE[currentIndex + 1], stabilityTime: 0 });
        } else {
            setTimeout(handleComplete, 300);
        }
    }, [state.currentState, updateState]);

    const handleTemperatureData = useCallback(
        (data: SensorData) => {
            if (!data?.temperature || refs.temperatureReceived) return;
            console.log("📡 Temperature data received:", data);
    
            refs.temperatureReceived = true;
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
    
            setState((prev) => {
                const newStabilityTime = Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME);
                console.log(`🔄 Stability Time: ${newStabilityTime}`); // Debug
    
                const isStable = newStabilityTime >= MAX_STABILITY_TIME;
                if (isStable) {
                    console.log("✅ Temperature stable, moving to ALCOHOL state");
                    moveToNextState();
                }
    
                return {
                    ...prev,
                    stabilityTime: newStabilityTime,
                    temperatureData: { temperature: Number(data.temperature) || 0 },
                };
            });
        },
        [handleTimeout, moveToNextState]
    );
    

    // ✅ Handles alcohol data and ensures it runs only **once per session**
    const handleAlcoholData = useCallback((snapshot: DataSnapshot) => {
        const data = snapshot.val();
        if (!data || refs.alcoholReceived) return; // ✅ Process only once
        console.log("📡 Alcohol data received from Firebase:", data);

        let alcoholStatus = "Не определено";
        if (data.sober === 1 && data.drunk === 0) {
            alcoholStatus = "Трезвый";
        } else if (data.sober === 0 && data.drunk === 1) {
            alcoholStatus = "Пьяный";
        }

        refs.alcoholReceived = true;
        updateState({
            alcoholData: { alcoholLevel: alcoholStatus },
            stabilityTime: MAX_STABILITY_TIME,
        });

        console.log("✅ Alcohol data processed, transitioning...");
        moveToNextState();
    }, [moveToNextState, updateState]);

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: 20,
                reconnectionDelay: 10000,
            });
    
            refs.socket.on("connect", () => console.log("✅ WebSocket connected."));
            refs.socket.on("temperature", handleTemperatureData);
        }
    
        return () => {
            console.log("🛑 Cleaning up WebSocket listeners...");
            refs.socket?.off("temperature", handleTemperatureData);
        };
    }, [handleTemperatureData]);
    

// ✅ Firebase for ALCOHOL (removes listener after first data)
useEffect(() => {
    if (state.currentState === "ALCOHOL") {
        const alcoholRef = ref(db, "alcohol_value");

        // ✅ Create a function to handle data retrieval
        const handleSnapshot = (snapshot: DataSnapshot) => {
            handleAlcoholData(snapshot);

            // ✅ Stop listening after first valid alcohol data
            console.log("🛑 Stopping Firebase listener.");
            off(alcoholRef, "value", handleSnapshot);
        };

        // ✅ Attach listener
        onValue(alcoholRef, handleSnapshot);

        // ✅ Cleanup function to remove listener if unmounting
        return () => off(alcoholRef, "value", handleSnapshot);
    }
}, [state.currentState, handleAlcoholData]);

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
                console.log("⏳ Preparing next session...");
                navigate("/");

                setTimeout(() => {
                    console.log(`🔄 Starting new session #${refs.sessionCount + 1}`);
                    updateState({
                        currentState: STATE_SEQUENCE[0], // ✅ Restart sequence
                        stabilityTime: 0,
                        temperatureData: { temperature: 0 },
                        alcoholData: { alcoholLevel: "Не определено" },
                        secondsLeft: 15,
                    });

                    refs.temperatureReceived = false;
                    refs.alcoholReceived = false;
                }, 1000);
            }, 4000);
        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.");
            refs.isSubmitting = false;
        } finally {
            setTimeout(() => {
                console.log("🛑 Disconnecting WebSocket after authentication...");
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
