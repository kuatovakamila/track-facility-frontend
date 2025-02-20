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
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    secondsLeft: number;
};

// const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

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
            style: {
                background: "#272727",
                color: "#fff",
                borderRadius: "8px",
            },
        });
        navigate("/");
    }, [navigate]);

    // ✅ Debug: Log all incoming WebSocket data
    const handleDataEvent = useCallback(
        (data: SensorData) => {
            console.log("📡 Full WebSocket Data Received:", data);

            if (!data) {
                console.warn("⚠️ Received empty data packet");
                return;
            }

            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            // ✅ Handle Temperature State
            if (state.currentState === "TEMPERATURE" && data.temperature) {
                console.log("🌡 Temperature Data:", data.temperature);
                updateState({
                    stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
                    temperatureData: { temperature: Number(data.temperature) || 0 },
                });

                // ✅ Move to Alcohol state after temperature is measured
                if (state.stabilityTime >= MAX_STABILITY_TIME) {
                    updateState({ currentState: "ALCOHOL", stabilityTime: 0 });
                }
            }

            // ✅ Handle Alcohol State
            if (state.currentState === "ALCOHOL" && data.alcoholLevel) {
                console.log("🍷 Alcohol Level Received:", data.alcoholLevel);

                const alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";

                // ✅ Update state with received alcohol level
                updateState({
                    stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
                    alcoholData: { alcoholLevel: alcoholStatus },
                });

                // ✅ Store results in localStorage
                localStorage.setItem(
                    "results",
                    JSON.stringify({
                        temperature: state.temperatureData.temperature,
                        alcohol: alcoholStatus,
                    })
                );

                console.log("✅ Updated LocalStorage:", {
                    temperature: state.temperatureData.temperature,
                    alcohol: alcoholStatus,
                });

                // ✅ Ensure navigation only after stability time is completed
                if (state.stabilityTime >= MAX_STABILITY_TIME) {
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

        socket.on("alcohol", handleDataEvent);
        socket.on("temperature", handleDataEvent);

        socket.on("disconnect", (reason) => {
            console.warn("⚠️ WebSocket disconnected:", reason);
        });

        return () => {
            socket.off("alcohol");
            socket.off("temperature");
            socket.disconnect();
            refs.socket = null;
        };
    }, [handleDataEvent]);

    return {
        ...state,
        handleComplete: async () => {
            console.log("🚀 Checking state sequence...");

            if (state.currentState === "ALCOHOL" && state.alcoholData.alcoholLevel === "Не определено") {
                console.warn("⚠️ Alcohol data is missing. Retrying...");
                return;
            }

            console.log("✅ All states completed, navigating...");
            navigate("/complete-authentication", { state: { success: true } });
        },
        setCurrentState: (newState: React.SetStateAction<StateKey>) =>
            updateState({
                currentState: typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};
