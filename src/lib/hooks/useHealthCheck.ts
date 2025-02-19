import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// Type definitions
type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
    cameraStatus?: "failed" | "success";
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
        if (refs.hasTimedOut || refs.isSubmitting) return;
        refs.hasTimedOut = true;

        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: { background: "#272727", color: "#fff", borderRadius: "8px" },
        });

        navigate("/");
    }, [navigate]);

    // Handle incoming data from WebSocket
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
                console.log("📡 Raw alcohol data received:", data.alcoholLevel);

                if (data.alcoholLevel === "normal") {
                    alcoholStatus = "Трезвый";
                } else if (data.alcoholLevel === "abnormal") {
                    alcoholStatus = "Пьяный";
                }
            }

            updateState({
                stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
                temperatureData: state.currentState === "TEMPERATURE"
                    ? { temperature: Number(data.temperature) || 0 }
                    : state.temperatureData,
                alcoholData: state.currentState === "ALCOHOL"
                    ? { alcoholLevel: alcoholStatus }
                    : state.alcoholData,
            });
        },
        [state.currentState, state.stabilityTime, state.temperatureData, state.alcoholData, updateState, handleTimeout]
    );

    useEffect(() => {
        if (refs.socket) return;
        refs.hasTimedOut = false;

        const socket = io(import.meta.env.VITE_SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 10000,
        });

        socket.on("connect", () => {
            console.log("✅ WebSocket connected successfully.");
            refs.socket = socket;
        });

        configureSocketListeners(socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });

        return () => {
            socket.disconnect();
            refs.socket = null;
        };
    }, [state.currentState, handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Checking state sequence...");
        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);

        if (currentIndex < STATE_SEQUENCE.length - 1) {
            console.log("⏭️ Moving to next state:", STATE_SEQUENCE[currentIndex + 1]);

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

            console.log("✅ All states completed, submitting final data...");

            const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    temperatureData: state.temperatureData,
                    alcoholData: state.alcoholData,
                    faceId,
                }),
            });

            if (!response.ok) {
                const errorMsg = await response.text();
                throw new Error(`Request failed: ${errorMsg}`);
            }

            console.log("✅ Submission successful!");

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Попробуйте снова.");
        } finally {
            refs.isSubmitting = false;
        }
    }, [state, navigate, refs, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState: React.SetStateAction<StateKey>) =>
            updateState({
                currentState: typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};
