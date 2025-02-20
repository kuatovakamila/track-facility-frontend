import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
    measurementComplete?: boolean;
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string | null };
    faceId: string | null; // ✅ Preloaded Face ID
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
        alcoholData: { alcoholLevel: null },
        faceId: null, // ✅ Preloaded Face ID
        secondsLeft: 15,
    });

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
    }).current;

    // ✅ Preload Face ID once to avoid delays
    useEffect(() => {
        const storedFaceId = localStorage.getItem("faceId");
        if (storedFaceId) {
            setState((prev) => ({ ...prev, faceId: storedFaceId }));
        }
    }, []);

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

            if (refs.timeout) clearTimeout(refs.timeout);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let newAlcoholStatus = state.alcoholData.alcoholLevel;
            let newTemperature = state.temperatureData.temperature;

            // ✅ Store temperature without triggering submission
            if (data.temperature) {
                newTemperature = Number(data.temperature);
                setState((prev) => ({
                    ...prev,
                    temperatureData: { temperature: newTemperature }, // Store final value
                    stabilityTime: Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME),
                }));
            }

            // ✅ If alcohol measurement is complete, send all data once
            if (
                data.measurementComplete &&
                (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal")
            ) {
                console.log("✅ Final alcohol level detected:", data.alcoholLevel);
                newAlcoholStatus = data.alcoholLevel;

                // ✅ Save result
                localStorage.setItem(
                    "measurementResult",
                    JSON.stringify({
                        alcoholLevel: newAlcoholStatus,
                        temperature: newTemperature,
                    })
                );

                // ✅ Update UI and progress bar
                setState((prev) => ({
                    ...prev,
                    stabilityTime: MAX_STABILITY_TIME,
                    alcoholData: { alcoholLevel: newAlcoholStatus },
                }));

                // ✅ Send final data once
                handleComplete(newTemperature, newAlcoholStatus);
            }
        },
        [handleTimeout, state.alcoholData.alcoholLevel, state.temperatureData.temperature, state.stabilityTime]
    );

    useEffect(() => {
        if (refs.socket) {
            refs.socket.off("temperature");
            refs.socket.off("alcohol");
        }

        refs.hasTimedOut = false;

        const SERVER_URL = process.env.VITE_SERVER_URL || "http://localhost:3001";
        console.log("🔗 Connecting to WebSocket:", SERVER_URL);

        const socket = io(SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 10000,
        });

        socket.on("connect", () => {
            console.log("✅ WebSocket connected successfully.");
            refs.socket = socket;
        });

        socket.on("disconnect", (reason) => {
            console.warn("⚠️ WebSocket disconnected:", reason);
        });

        socket.on("connect_error", (err) => {
            console.error("❌ WebSocket connection error:", err);
        });

        socket.on("temperature", handleDataEvent);
        socket.on("alcohol", handleDataEvent);

        refs.socket = socket;

        return () => {
            socket.off("temperature");
            socket.off("alcohol");
        };
    }, [handleDataEvent, navigate]);

    const handleComplete = useCallback(async (finalTemperature?: number, finalAlcoholLevel?: string) => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Sending final temperature & alcohol data together...");

        if (!state.faceId) {
            console.error("❌ Face ID not found");
            toast.error("Ошибка: Face ID не найден");
            refs.isSubmitting = false;
            return;
        }

        // ✅ If parameters are missing, use stored values
        const finalTemp = finalTemperature ?? state.temperatureData.temperature;
        const finalAlcohol = finalAlcoholLevel ?? state.alcoholData.alcoholLevel;

        const finalData = {
            temperatureData: { temperature: finalTemp },
            alcoholData: { alcoholLevel: finalAlcohol },
            faceId: state.faceId,
        };

        console.log("📡 Sending final data:", finalData);
        const toastId = toast.loading("Отправка данных...");

        try {
            const response = await fetch("http://localhost:3001", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(finalData),
            });

            if (!response.ok) {
                throw new Error(`❌ Server responded with status: ${response.status}`);
            }

            console.log("✅ Submission successful, navigating...");
            toast.success("Данные успешно отправлены", { id: toastId });

            navigate("/complete-authentication", { state: { success: true } });

        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.", { id: toastId });
            refs.isSubmitting = false;
        }
    }, [state, navigate]);

    return {
        ...state,
        handleComplete: () => handleComplete(), // ✅ Call without parameters
        setCurrentState: (newState: React.SetStateAction<StateKey>) => {
            updateState({
                currentState:
                    typeof newState === "function" ? newState(state.currentState) : newState,
            });
        },
    };
};
