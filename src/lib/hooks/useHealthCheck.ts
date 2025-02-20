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
    console.log(`🔄 Configuring WebSocket Listeners for: ${currentState}`);

    // Ensure only relevant listeners are active
    socket.off("temperature");
    socket.off("alcohol");
    socket.off("camera");

    socket.on("camera", handlers.onData);

    if (currentState === "TEMPERATURE") {
        socket.on("temperature", handlers.onData);
    } else if (currentState === "ALCOHOL") {
        socket.on("alcohol", handlers.onData);
    }

    // ✅ Debugging: Log all incoming WebSocket events
    socket.onAny((event, data) => {
        console.log(`📡 WebSocket Event Received: ${event}`, data);
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
        sessionCount: 0,
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

    const handleDataEvent = useCallback((data: SensorData) => {
        console.log("📡 FULL SENSOR DATA RECEIVED:", JSON.stringify(data));

        if (!data || typeof data !== "object") {
            console.warn("⚠️ Invalid data format:", data);
            return;
        }

        refs.lastDataTime = Date.now();
        clearTimeout(refs.timeout!);
        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        let alcoholStatus = "Не определено";

        if (data.hasOwnProperty("alcoholLevel")) {
            console.log("✅ Alcohol data detected:", data.alcoholLevel);
            if (data.alcoholLevel === "normal") alcoholStatus = "Трезвый";
            if (data.alcoholLevel === "abnormal") alcoholStatus = "Пьяный";
        } else {
            console.warn("❌ Alcohol data missing from payload");
        }

        // Log sensor status and readiness
        console.log(`🛠️ Sensor Status: ${data.sensorStatus}, Ready: ${data.sensorReady}`);

        if (data.sensorStatus === "off" || data.sensorReady === false) {
            console.warn("⏳ Sensor is not ready, waiting...");
            return;
        }

        setState((prev) => ({
            ...prev,
            alcoholData: prev.currentState === "ALCOHOL" ? { alcoholLevel: alcoholStatus } : prev.alcoholData,
            stabilityTime: prev.currentState === "TEMPERATURE"
                ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                : prev.stabilityTime,
        }));

        if (state.currentState === "ALCOHOL") {
            console.log("✅ Alcohol data received, proceeding to next step.");
            setTimeout(handleComplete, 300);
        }
    }, [handleTimeout]);

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
