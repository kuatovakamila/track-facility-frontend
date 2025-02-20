import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;

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
        console.warn("⏳ Timeout reached, but preventing premature navigation");
    }, []);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) {
                console.warn("⚠️ Received empty data packet");
                return;
            }

            console.log("📡 Received sensor data:", data);
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let alcoholStatus = state.alcoholData.alcoholLevel;
            if (data.alcoholLevel !== undefined) {
                console.log(`🍷 Alcohol status received: ${data.alcoholLevel}`);
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            setState((prev) => {
                const isTemperatureStable =
                    prev.currentState === "TEMPERATURE" &&
                    prev.stabilityTime + 1 >= MAX_STABILITY_TIME;

                const nextState = isTemperatureStable ? "ALCOHOL" : prev.currentState;

                console.log(`🔄 Transitioning to state: ${nextState}`);

                return {
                    ...prev,
                    stabilityTime: isTemperatureStable
                        ? 0
                        : Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME),
                    temperatureData:
                        data.temperature !== undefined
                            ? { temperature: Number(data.temperature) || 0 }
                            : prev.temperatureData,
                    alcoholData:
                        data.alcoholLevel !== undefined
                            ? { alcoholLevel: alcoholStatus }
                            : prev.alcoholData,
                    currentState: nextState,
                };
            });
        },
        [handleTimeout, state.alcoholData.alcoholLevel]
    );

    useEffect(() => {
        if (!refs.socket) {
            console.log("🛠️ Initializing WebSocket connection...");
            refs.socket = io(import.meta.env.VITE_SERVER_URL, {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
            });

            refs.socket.on("connect", () => {
                console.log("✅ WebSocket connected.");
            });

            refs.socket.on("disconnect", (reason) => {
                console.warn("⚠️ WebSocket disconnected:", reason);
            });

            // 🔹 Log ALL incoming events
            refs.socket.onAny((event, data) => {
                console.log(`📡 Incoming WebSocket event: ${event}`, data);
            });

            // 🔹 Set up main event listeners
            refs.socket.on("temperature", handleDataEvent);
            refs.socket.on("alcohol", handleDataEvent);
            refs.socket.on("camera", handleDataEvent);
        }
    }, []);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || state.currentState !== "ALCOHOL") return;
        refs.isSubmitting = true;

        console.log("🚀 Completing health check...");

        // 🔹 Ensure alcohol data is received before navigating
        if (state.alcoholData.alcoholLevel === "Не определено") {
            console.warn("🚨 Alcohol data missing, cannot complete!");
            refs.isSubmitting = false;
            return;
        }

        navigate("/complete-authentication", { replace: true });
    }, [navigate, state.currentState, state.alcoholData.alcoholLevel]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
