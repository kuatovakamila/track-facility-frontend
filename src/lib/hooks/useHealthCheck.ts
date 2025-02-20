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

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

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
        alcoholMeasured: false, // ✅ Track alcohol measurement completion
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

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) return;
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let newStabilityTime = state.stabilityTime;

            // ✅ Temperature works as usual
            if (state.currentState === "TEMPERATURE" && data.temperature) {
                newStabilityTime = Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME);
            }

            let alcoholStatus = state.alcoholData.alcoholLevel;

            // ✅ Ensure alcohol only completes when "normal" or "abnormal" received
            if (state.currentState === "ALCOHOL" && data.alcoholLevel) {
                console.log("📡 Alcohol Data Received:", data.alcoholLevel);
                if (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal") {
                    alcoholStatus = data.alcoholLevel;
                    refs.alcoholMeasured = true; // ✅ Mark alcohol as measured
                }
            }

            updateState({
                stabilityTime: newStabilityTime,
                temperatureData: state.currentState === "TEMPERATURE"
                    ? { temperature: Number(data.temperature) }
                    : state.temperatureData,
                alcoholData: state.currentState === "ALCOHOL"
                    ? { alcoholLevel: alcoholStatus }
                    : state.alcoholData,
            });

            // ✅ After alcohol measurement, ensure full spin before completing
            if (refs.alcoholMeasured) {
                setTimeout(() => {
                    handleComplete();
                }, 4000); // ⏳ Let the loading circle complete its animation
            }
        },
        [state.currentState, state.stabilityTime, state.temperatureData, state.alcoholData, updateState, handleTimeout]
    );

    useEffect(() => {
        if (refs.socket) return;
        refs.hasTimedOut = false;

        const socket = io(import.meta.env.VITE_SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 2000,
        });

        socket.on("connect", () => {
            console.log("✅ WebSocket connected successfully.");
            refs.socket = socket;
        });

        socket.on("disconnect", (reason) => {
            console.warn("⚠️ WebSocket disconnected:", reason);
        });

        // ✅ Listen for Alcohol Data
        socket.on("alcohol", (data) => {
            console.log("📡 Alcohol Data Received:", data);
            handleDataEvent(data);
        });

        // ✅ Listen for Temperature Data
        socket.on("temperature", (data) => {
            console.log("🌡 Temperature Data Received:", data);
            handleDataEvent(data);
        });

        socket.on("error", handleTimeout);

        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        return () => {
            socket.disconnect();
            refs.socket = null;
        };
    }, [handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            updateState({
                currentState: STATE_SEQUENCE[currentIndex + 1],
                stabilityTime: 0,
            });
            refs.isSubmitting = false;
            return;
        }

        // ✅ Ensure alcohol measurement was received before proceeding
        if (state.currentState === "ALCOHOL" && !refs.alcoholMeasured) {
            console.warn("⚠️ No valid alcohol data received! Redirecting...");
            toast.error("Не удалось измерить уровень алкоголя. Попробуйте снова.");
            navigate("/");
            return;
        }

        try {
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");

            const response = await fetch(
                `${import.meta.env.VITE_SERVER_URL}/health`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        temperatureData: state.temperatureData,
                        alcoholData: state.alcoholData,
                        faceId,
                    }),
                }
            );

            if (!response.ok) throw new Error("Request failed");

            localStorage.setItem(
                "results",
                JSON.stringify({
                    temperature: state.temperatureData.temperature,
                    alcohol: state.alcoholData.alcoholLevel,
                }),
            );

            console.log("✅ Submission successful, navigating...");
            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            console.error("❌ Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState: React.SetStateAction<StateKey>) =>
            updateState({
                currentState: typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};
