import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;

type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
    cameraStatus?: "failed" | "success";
    sensorStatus?: string; // "on" | "off"
    sensorReady?: boolean; // true | false
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
    // ✅ REMOVE ONLY THE PREVIOUS STATE'S LISTENERS TO AVOID UNEXPECTED REMOVALS
    if (currentState === "TEMPERATURE") {
        socket.off("alcohol"); // Remove alcohol listener if switching from ALCOHOL
        socket.on("temperature", handlers.onData);
    } else if (currentState === "ALCOHOL") {
        socket.off("temperature"); // Remove temperature listener if switching from TEMPERATURE
        socket.on("alcohol", handlers.onData);
    }

    socket.on("camera", handlers.onData);

    // ✅ Log all incoming events for debugging
    socket.onAny((event, data) => {
        console.log(`📡 Received event: ${event}`, data);
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
        hasNavigated: false,
        sessionCount: 0, // ✅ Track session count for debugging
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

        console.warn("⚠️ Timeout occurred, navigating home.");
        navigate("/");
    }, [navigate]);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            console.log("📡 Full Sensor Data Received:", JSON.stringify(data));

            if (!data || typeof data !== "object") {
                console.warn("⚠️ Received invalid data:", data);
                return;
            }

            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            // ✅ Validate and handle alcohol data properly
            let alcoholStatus = "Не определено";
            if (data.alcoholLevel) {
                if (data.alcoholLevel === "normal") {
                    alcoholStatus = "Трезвый";
                } else if (data.alcoholLevel === "abnormal") {
                    alcoholStatus = "Пьяный";
                }
            } else {
                console.warn("❌ Alcohol data missing from payload");
            }

            // ✅ Ensure sensor is ready before updating UI
            if (data.sensorStatus === "off" || data.sensorReady === false) {
                console.warn("⏳ Sensor not ready, waiting...");
                return; // Do not update state if sensor is off or not ready
            }

            setState((prev) => ({
                ...prev,
                alcoholData: prev.currentState === "ALCOHOL" ? { alcoholLevel: alcoholStatus } : prev.alcoholData,
                temperatureData: prev.currentState === "TEMPERATURE" && data.temperature
                    ? { temperature: Number(data.temperature) || 0 }
                    : prev.temperatureData,
                stabilityTime: prev.currentState === "TEMPERATURE"
                    ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                    : prev.stabilityTime,
            }));

            if (state.currentState === "ALCOHOL") {
                console.log("✅ Alcohol data received, proceeding to next step.");
                setTimeout(handleComplete, 300);
            }
        },
        [handleTimeout]
    );

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL, {
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

        configureSocketListeners(refs.socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });

        return () => {
            console.log("🛑 Keeping event listeners active until authentication completes...");
        };
    }, [state.currentState, handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Checking state sequence...");

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
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("❌ Face ID not found");

            console.log("📡 Sending final data...");
            refs.hasNavigated = true;
            refs.sessionCount += 1;

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            setTimeout(() => {
                console.log("🚀 Navigating to completion page");
                navigate("/complete-authentication", { state: { success: true } });
            }, 500);

            // ✅ Delay disconnect to ensure all data is processed
            setTimeout(() => {
                console.log("🛑 Now disconnecting WebSocket after authentication completes...");
                refs.socket?.disconnect();
                refs.socket = null;
            }, 5000);
        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.");
            refs.isSubmitting = false;
        }
    }, [state, navigate, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
