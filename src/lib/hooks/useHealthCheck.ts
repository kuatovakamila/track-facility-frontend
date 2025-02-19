import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const PING_INTERVAL = 30000;

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
        socket.on("temperature", (data) => {
            console.log("🔥 Temperature event received:", data);
            handlers.onData(data);
        });
    } else if (currentState === "ALCOHOL") {
        socket.on("alcohol", (data) => {
            console.log("🍷 Alcohol event received:", data);
            handlers.onData(data);
        });
    }

    socket.on("camera", (data) => {
        console.log("📷 Camera event received:", data);
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
        hasNavigated: false,
        pingInterval: null as NodeJS.Timeout | null,
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

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel !== undefined) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            setState((prev) => {
                const isTemperatureStable = prev.currentState === "TEMPERATURE" && prev.stabilityTime + 1 >= MAX_STABILITY_TIME;
                const nextState = isTemperatureStable ? "ALCOHOL" : prev.currentState;

                console.log(`🔄 Transitioning to state: ${nextState}`);

                return {
                    ...prev,
                    stabilityTime: isTemperatureStable ? 0 : Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME),
                    temperatureData:
                        prev.currentState === "TEMPERATURE"
                            ? { temperature: Number(data.temperature) || 0 }
                            : prev.temperatureData,
                    alcoholData:
                        prev.currentState === "ALCOHOL"
                            ? { alcoholLevel: alcoholStatus }
                            : prev.alcoholData,
                    currentState: nextState,
                };
            });
        },
        [handleTimeout]
    );

    useEffect(() => {
        console.log(`⚙️ useEffect triggered. Current state: ${state.currentState}`);

        if (!refs.socket) {
            console.log("🛠️ Initializing WebSocket connection...");
            refs.socket = io(import.meta.env.VITE_SERVER_URL, {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: 50,
                reconnectionDelay: 5000,
            });

            refs.socket.on("connect", () => {
                console.log("✅ WebSocket connected.");
            });

            refs.socket.on("disconnect", (reason) => {
                console.warn("⚠️ WebSocket disconnected:", reason);
                refs.socket = null;
            });

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
    }, [state.currentState, handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || state.currentState !== "ALCOHOL") return;
        refs.isSubmitting = true;

        console.log("🚀 Completing health check...");
        navigate("/complete-authentication");

        setTimeout(() => {
            console.log("⏳ Returning to home and preparing next session...");
            navigate("/");
        }, 4000);
    }, [navigate, state.currentState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
