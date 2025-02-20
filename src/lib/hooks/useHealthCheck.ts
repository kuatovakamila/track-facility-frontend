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
    console.log("🔄 Configuring WebSocket listeners...");

    socket.off("connect_error");
    socket.off("error");
    socket.off("temperature");
    socket.off("alcohol");
    socket.off("camera");

    socket.on("connect_error", handlers.onError);
    socket.on("error", handlers.onError);

    if (currentState === "TEMPERATURE") {
        console.log("🟡 Listening for temperature data...");
        socket.on("temperature", (data) => {
            console.log("📡 Temperature Data Received:", data);
            handlers.onData(data);
        });
    }

    if (currentState === "ALCOHOL") {
        console.log("🟡 Listening for alcohol data...");
        socket.on("alcohol", (data) => {
            console.log("📡 Alcohol Data Received:", data);
            handlers.onData(data);
        });
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

            let alcoholStatus = state.alcoholData.alcoholLevel;
            let temperatureValue = state.temperatureData.temperature;

            if (data.alcoholLevel) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
                console.log("🍷 Processed Alcohol Level:", alcoholStatus);
            }

            if (data.temperature) {
                temperatureValue = Number(data.temperature) || 0;
                console.log("🌡️ Processed Temperature Data:", temperatureValue);
            }

            setState((prev) => {
                let newStabilityTime = prev.stabilityTime;

                if (prev.currentState === "TEMPERATURE" && data.temperature) {
                    newStabilityTime = Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME);
                }

                if (prev.currentState === "ALCOHOL" && data.alcoholLevel) {
                    newStabilityTime = MAX_STABILITY_TIME;
                }

                return {
                    ...prev,
                    stabilityTime: newStabilityTime,
                    temperatureData: { temperature: temperatureValue },
                    alcoholData: { alcoholLevel: alcoholStatus },
                };
            });

            if (state.currentState === "ALCOHOL" && data.alcoholLevel) {
                setTimeout(handleComplete, 300);
            }
        },
        [state, handleTimeout]
    );

    useEffect(() => {
        if (refs.socket) {
            refs.socket.disconnect();
            refs.socket = null;
        }

        console.log("🌍 Reconnecting WebSocket for state:", state.currentState);
        const socket = io(import.meta.env.VITE_SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 10000,
        });

        socket.on("connect", () => {
            console.log("✅ WebSocket connected.");
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

        console.log("🚀 Handling completion...");

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

            const finalData = {
                temperatureData: state.temperatureData,
                alcoholData: state.alcoholData,
                faceId,
            };

            console.log("📡 Sending final data:", finalData);

            const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/health`, {
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
            updateState((prev: HealthCheckState) => ({
                currentState: typeof newState === "function" ? newState(prev.currentState) : newState,
            })),
    };
};
