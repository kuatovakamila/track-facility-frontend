import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// Type definitions
type SensorData = {
    temperature?: number;
    alcoholLevel?: string;
};

type HealthCheckState = {
    currentState: "TEMPERATURE" | "ALCOHOL";
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    secondsLeft: number; // ✅ Ensure it's part of the state
};

// Configure socket listeners
const configureSocketListeners = (
    socket: Socket,
    currentState: "TEMPERATURE" | "ALCOHOL",
    handlers: {
        onData: (data: SensorData) => void;
        onError: () => void;
    }
) => {
    socket.removeAllListeners();
    socket.on("connect_error", handlers.onError);
    socket.on("error", handlers.onError);

    switch (currentState) {
        case "TEMPERATURE":
            socket.on("temperature", handlers.onData);
            break;
        case "ALCOHOL":
            socket.on("alcohol", handlers.onData);
            break;
    }
};

export const useHealthCheck = () => {
    const navigate = useNavigate();
    const [state, setState] = useState<HealthCheckState>({
        currentState: "TEMPERATURE",
        stabilityTime: 0,
        temperatureData: { temperature: 0 },
        alcoholData: { alcoholLevel: "Не определено" },
        secondsLeft: MAX_STABILITY_TIME, // ✅ Initialize secondsLeft
    });

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        hasTimedOut: false,
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
        toast.error(TIMEOUT_MESSAGE, { duration: 3000 });
        navigate("/");
    }, [navigate]);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            console.log("📡 Data Received:", data);

            if (!data) {
                console.warn("⚠️ Received empty data packet");
                return;
            }

            refs.hasTimedOut = false;
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            if (state.currentState === "TEMPERATURE" && data.temperature !== undefined) {
                console.log("🌡 Temperature Data:", data.temperature);
                updateState({
                    stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
                    temperatureData: { temperature: data.temperature },
                });

                if (state.stabilityTime + 1 >= MAX_STABILITY_TIME) {
                    updateState({ currentState: "ALCOHOL", stabilityTime: 0, secondsLeft: MAX_STABILITY_TIME });
                }
            }

            if (state.currentState === "ALCOHOL" && data.alcoholLevel) {
                console.log("🍷 Alcohol Level Received:", data.alcoholLevel);

                const alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";

                updateState({
                    stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
                    alcoholData: { alcoholLevel: alcoholStatus },
                });

                localStorage.setItem("results", JSON.stringify({
                    temperature: state.temperatureData.temperature,
                    alcohol: alcoholStatus,
                }));

                if (state.stabilityTime + 1 >= MAX_STABILITY_TIME) {
                    setTimeout(() => {
                        navigate("/complete-authentication", { state: { success: true } });
                    }, 500);
                }
            }
        },
        [state, updateState, handleTimeout, navigate]
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

        socket.on("disconnect", (reason) => console.warn("⚠️ WebSocket disconnected:", reason));

        configureSocketListeners(socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });

        return () => {
            socket.disconnect();
            refs.socket = null;
        };
    }, [state.currentState, handleTimeout, handleDataEvent, navigate]);

    return {
        ...state,
        handleComplete: async () => {
            if (state.currentState === "ALCOHOL" && state.alcoholData.alcoholLevel === "Не определено") {
                console.warn("⚠️ Alcohol data is missing. Retrying...");
                return;
            }

            navigate("/complete-authentication", { state: { success: true } });
        },
    };
};
