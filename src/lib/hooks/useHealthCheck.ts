import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";
const PING_INTERVAL = 30000; // ✅ Ping the server every 30 seconds

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
    // ✅ REMOVE PREVIOUS LISTENERS BEFORE ADDING NEW ONES
    socket.off("temperature");
    socket.off("alcohol");
    socket.off("camera");

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
        hasNavigated: false,
        sessionCount: 0, // ✅ Track session count to ensure smooth transitions
        pingInterval: null as NodeJS.Timeout | null, // ✅ Ping interval to keep connection alive
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

            console.log("📡 Sensor data received:", data);
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            setState((prev) => ({
                ...prev,
                stabilityTime:
                    prev.currentState === "TEMPERATURE"
                        ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                        : prev.stabilityTime,
                temperatureData:
                    prev.currentState === "TEMPERATURE"
                        ? { temperature: Number(data.temperature) || 0 }
                        : prev.temperatureData,
                alcoholData:
                    prev.currentState === "ALCOHOL"
                        ? { alcoholLevel: alcoholStatus }
                        : prev.alcoholData,
            }));
        },
        [handleTimeout]
    );

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL, {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: 50, // ✅ Increase reconnection attempts
                reconnectionDelay: 5000,
            });

            refs.socket.on("connect", () => {
                console.log("✅ WebSocket connected.");
            });

            refs.socket.on("disconnect", (reason) => {
                console.warn("⚠️ WebSocket disconnected:", reason);
                refs.socket = null;

                // ✅ Auto-reconnect if unexpected disconnection occurs
                setTimeout(() => {
                    if (!refs.socket) {
                        refs.socket = io(import.meta.env.VITE_SERVER_URL, {
                            transports: ["websocket"],
                            reconnection: true,
                            reconnectionAttempts: 50,
                            reconnectionDelay: 5000,
                        });
                    }
                }, 2000);
            });

            // ✅ Keep connection alive by sending a ping every 30 seconds
            refs.pingInterval = setInterval(() => {
                if (refs.socket?.connected) {
                    refs.socket.emit("ping");
                    console.log("📡 Sent keep-alive ping to server");
                }
            }, PING_INTERVAL);
        }

        configureSocketListeners(refs.socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });

        return () => {
            console.log("🛑 Not cleaning up event listeners until authentication is fully done...");
        };
    }, [state.currentState, handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Completing health check...");
        navigate("/complete-authentication");

        setTimeout(() => {
            console.log("⏳ Returning to home and preparing next session...");
            navigate("/");
        }, 4000);
    }, [navigate]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
