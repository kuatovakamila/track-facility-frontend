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

    // ✅ Handle incoming WebSocket Data
    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) return;
    
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
    
            let alcoholStatus = state.alcoholData.alcoholLevel;
            let isAlcoholMeasured = false;
    
            if (data.alcoholLevel) {
                console.log("📡 Alcohol Data Received:", data.alcoholLevel);
    
                if (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal") {
                    alcoholStatus = data.alcoholLevel;
                    isAlcoholMeasured = true;
                }
            }
    
            // ✅ Ensure stabilityTime completes when alcohol is received
            updateState({
                stabilityTime: isAlcoholMeasured
                    ? MAX_STABILITY_TIME  // 🔥 Force full circle if alcohol is valid
                    : state.stabilityTime,
                temperatureData: state.currentState === "TEMPERATURE"
                    ? { temperature: Number(data.temperature!) }
                    : state.temperatureData,
                alcoholData: state.currentState === "ALCOHOL"
                    ? { alcoholLevel: alcoholStatus }
                    : state.alcoholData,
            });

            // ✅ Trigger completion when alcohol is received
            if (isAlcoholMeasured) {
                setTimeout(() => {
                    handleComplete();
                }, 500);
            }
        },
        [state, updateState, handleTimeout]
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

        socket.on("temperature", handleDataEvent);
        socket.on("alcohol", handleDataEvent);

        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        return () => {
            socket.disconnect();
            refs.socket = null;
        };
    }, [handleDataEvent, handleTimeout]);

    // ✅ Stability Update Interval
    useEffect(() => {
        const stabilityInterval = setInterval(() => {
            if (Date.now() - refs.lastDataTime > 1000) {
                updateState({
                    stabilityTime: Math.max(state.stabilityTime - 1, 0),
                });
            }
        }, 1000);

        return () => clearInterval(stabilityInterval);
    }, [state.stabilityTime, updateState]);

    // ✅ Countdown Timer
    useEffect(() => {
        setState((prev) => ({ ...prev, secondsLeft: 15 }));
        const interval = setInterval(() => {
            setState((prev) => ({
                ...prev,
                secondsLeft: prev.secondsLeft > 0 ? prev.secondsLeft - 1 : 0,
            }));
        }, 1000);
        return () => clearInterval(interval);
    }, [state.currentState]);

    // ✅ Handle Completion Logic
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

        // 🚨 **CHECK IF ALCOHOL MEASUREMENT WAS RECEIVED**
        if (state.currentState === "ALCOHOL" && (state.alcoholData.alcoholLevel === "Не определено")) {
            console.warn("⚠️ No alcohol data received! Retrying...");
            toast.error("Не удалось измерить уровень алкоголя. Попробуйте снова.");

            setTimeout(() => {
                handleComplete();
            }, 2000);
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
                },
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
