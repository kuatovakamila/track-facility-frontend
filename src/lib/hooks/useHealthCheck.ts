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
    cameraStatus?: "failed" | "success";
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

    // ✅ useRef для устранения устаревшего состояния
    const currentStateRef = useRef<StateKey>(state.currentState);
    useEffect(() => {
        currentStateRef.current = state.currentState;
    }, [state.currentState]);

    // ✅ Исправление: Явно объявленные типы
    const refs = useRef<{
        socket: Socket | null;
        timeout: NodeJS.Timeout | null;
        lastDataTime: number;
        hasTimedOut: boolean;
        isSubmitting: boolean;
    }>({
        socket: null,
        timeout: null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
    }).current;

    // ✅ Фикс: Типизация параметра `prev`
    const updateState = useCallback(
        (updates: Partial<HealthCheckState>) => {
            setState((prev: HealthCheckState) => ({ ...prev, ...updates }));
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

    // ✅ Обработчик данных с сенсоров
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

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            updateState({
                stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
                temperatureData: state.currentState === "TEMPERATURE"
                    ? { temperature: Number(data.temperature) || 0 }
                    : state.temperatureData,
                alcoholData: state.currentState === "ALCOHOL"
                    ? { alcoholLevel: alcoholStatus }
                    : state.alcoholData,
            });
        },
        [state, updateState, handleTimeout]
    );

    // ✅ Устранение утечек событий WebSocket
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

        socket.on("disconnect", (reason) => {
            console.warn("⚠️ WebSocket disconnected:", reason);
        });

        socket.removeAllListeners();

        socket.on("error", handleTimeout);
        socket.on("connect_error", handleTimeout);
        socket.on("temperature", handleDataEvent);
        socket.on("alcohol", handleDataEvent);

        socket.on("camera", (data) => {
            console.log("📡 Camera Data Received:", data);
            
            if (data.cameraStatus === "failed") {
                if (currentStateRef.current !== "TEMPERATURE") {
                    updateState({ currentState: "TEMPERATURE" });
                }

                toast.error("⚠️ Face ID failed. Please try again.", {
                    duration: 3000,
                    style: { background: "#ff4d4d", color: "#fff", borderRadius: "8px" },
                });

                return;
            }

            if (data.cameraStatus === "success") {
                if (currentStateRef.current !== "TEMPERATURE") {
                    updateState({ currentState: "TEMPERATURE" });
                    setTimeout(() => {
                        navigate("/temperature-check");
                    }, 500);
                }
            }
        });

        return () => {
            socket.disconnect();
            refs.socket = null;
        };
    }, [handleTimeout, handleDataEvent, navigate]);

    // ✅ Обработчик завершения проверки
    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Checking state sequence...");

        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        console.log("🔍 Current Index:", currentIndex, "State:", state.currentState);

        if (currentIndex < STATE_SEQUENCE.length - 1) {
            console.log("⏭️ Moving to next state:", STATE_SEQUENCE[currentIndex + 1]);

            updateState({
                currentState: STATE_SEQUENCE[currentIndex + 1],
                stabilityTime: 0,
            });

            refs.isSubmitting = false;
            return;
        }

        try {
            refs.socket?.disconnect();
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");

            console.log("✅ All states completed, submitting final data...");

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

            console.log("✅ Submission successful, navigating to complete authentication...");
            localStorage.setItem(
                "results",
                JSON.stringify({
                    temperature: state.temperatureData.temperature,
                    alcohol: state.alcoholData.alcoholLevel,
                })
            );

            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            console.error("❌ Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate, refs, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState: React.SetStateAction<StateKey>) =>
            updateState({
                currentState: typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};
