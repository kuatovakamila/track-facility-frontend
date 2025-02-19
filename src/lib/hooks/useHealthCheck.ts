import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// **Constants**
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
const TIMEOUT_MESSAGE =
    "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// **Type Definitions**
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

    const [isAlcoholComplete, setIsAlcoholComplete] = useState(false);

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
            let isAlcoholMeasured = false;

            // ✅ Temperature behaves as usual (progresses gradually)
            if (state.currentState === "TEMPERATURE" && data.temperature) {
                newStabilityTime = Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME);
            }

            // ✅ Alcohol completes only after receiving "normal" or "abnormal"
            if (state.currentState === "ALCOHOL" && data.alcoholLevel) {
                console.log("📡 Alcohol Data Received:", data.alcoholLevel);

                if (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal") {
                    isAlcoholMeasured = true;
                    setIsAlcoholComplete(true);
                }
            }

            updateState({
                stabilityTime: newStabilityTime, 
                temperatureData:
                    state.currentState === "TEMPERATURE"
                        ? { temperature: Number(data.temperature) }
                        : state.temperatureData,
                alcoholData:
                    state.currentState === "ALCOHOL"
                        ? { alcoholLevel: data.alcoholLevel || "Не определено" }
                        : state.alcoholData,
            });

            // ✅ Progress bar completes in 4 seconds for alcohol
            if (isAlcoholMeasured) {
                let alcoholTimer = 0;
                const interval = setInterval(() => {
                    setState((prev) => {
                        if (alcoholTimer >= 4) {
                            clearInterval(interval);
                        }
                        alcoholTimer += 1;
                        return { ...prev, stabilityTime: Math.min(prev.stabilityTime + 2, MAX_STABILITY_TIME) };
                    });
                }, 1000); // ⏳ Completes in 4 seconds
            }
        },
        [state.currentState, state.stabilityTime, state.temperatureData, state.alcoholData, updateState, handleTimeout]
    );

    // ✅ Runs when alcohol measurement is completed
    useEffect(() => {
        if (isAlcoholComplete) {
            setTimeout(handleComplete, 4000); // ⏳ Wait for 4 seconds before completing
            setIsAlcoholComplete(false);
        }
    }, [isAlcoholComplete]);

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
        socket.on("error", handleTimeout);

        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        return () => {
            socket.disconnect();
            refs.socket = null;
        };
    }, [handleTimeout, handleDataEvent]);

    // ✅ **Stability Time Reduction when no new data received**
    useEffect(() => {
        const stabilityInterval = setInterval(() => {
            if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
                updateState({
                    stabilityTime: Math.max(state.stabilityTime - 1, 0), // ⬇️ Reduce stability if no data
                });
            }
        }, STABILITY_UPDATE_INTERVAL);

        return () => clearInterval(stabilityInterval);
    }, [state.stabilityTime, updateState]);

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

        if (state.currentState === "ALCOHOL" && (state.alcoholData.alcoholLevel === "Не определено" || state.alcoholData.alcoholLevel === "")) {
            console.warn("⚠️ No alcohol data received! Redirecting...");
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
