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
    cameraStatus?: 'failed' | 'success';
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string | null }; // ✅ `null`, а не `undefined`
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
        alcoholData: { alcoholLevel: null }, // ✅ null вместо undefined
        secondsLeft: 15,
    });

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false, // ✅ Исправлена ошибка отсутствия isSubmitting
        isAlcoholMeasured: false,
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
    
            console.log("📡 Full sensor data received:", data);
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
    
            let newAlcoholStatus = state.alcoholData.alcoholLevel;
            let isValidAlcoholLevel = false;
    
            // ✅ Если пришло normal или abnormal - фиксируем
            if (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal") {
                newAlcoholStatus = data.alcoholLevel;
                isValidAlcoholLevel = true;
                refs.isAlcoholMeasured = true;
    
                // ✅ Сохраняем в localStorage сразу
                localStorage.setItem("alcoholResult", JSON.stringify({ alcoholLevel: newAlcoholStatus }));
                console.log("💾 Saved to localStorage:", newAlcoholStatus);
            }
    
            setState((prev) => {
                if (prev.currentState === "ALCOHOL" && isValidAlcoholLevel) {
                    console.log("✅ Alcohol data received, stopping measurement.");
                    return {
                        ...prev,
                        stabilityTime: MAX_STABILITY_TIME, // 🔥 Завершаем прогресс-бар
                        alcoholData: { alcoholLevel: newAlcoholStatus },
                    };
                }
    
                return {
                    ...prev,
                    stabilityTime: prev.currentState === "TEMPERATURE"
                        ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                        : prev.stabilityTime,
                    temperatureData: prev.currentState === "TEMPERATURE"
                        ? { temperature: Number(data.temperature) || 0 }
                        : prev.temperatureData,
                };
            });
    
            // ✅ После завершения прогресса - уходим на complete-authentication
            if (isValidAlcoholLevel) {
                setTimeout(() => {
                    console.log("🚀 Navigating to complete-authentication...");
                    navigate("/complete-authentication", { state: { success: true } });
                }, 1000); // ✅ Ждем 1 сек, чтобы UI успел показать финальный статус
            }
        },
        [handleTimeout, state.alcoholData.alcoholLevel, navigate]
    );
    
    useEffect(() => {
        if (refs.socket) {
            refs.socket.off("temperature");
            refs.socket.off("alcohol");
            refs.socket.off("camera");
        }

        refs.hasTimedOut = false;

        const SERVER_URL =  "http://localhost:3001"; // ✅ Теперь `process.env`
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
        socket.on("camera", handleDataEvent);

        refs.socket = socket;

        return () => {
            socket.off("temperature");
            socket.off("alcohol");
            socket.off("camera");
        };
    }, [handleDataEvent, navigate]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Checking state sequence...");

        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            updateState({
                currentState: STATE_SEQUENCE[currentIndex + 1],
                stabilityTime: 0,
            });

            refs.isSubmitting = false;
            return;
        }

        try {
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("❌ Face ID not found");

            const finalData = {
                temperatureData: state.temperatureData,
                alcoholData: state.alcoholData.alcoholLevel
                    ? state.alcoholData
                    : undefined, // ✅ Не отправляем undefined
                faceId,
            };

            console.log("📡 Sending final data:", finalData);

            const response = await fetch(`${process.env.VITE_SERVER_URL}/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(finalData),
            });

            if (!response.ok) {
                throw new Error(`❌ Server responded with status: ${response.status}`);
            }

            console.log("✅ Submission successful, navigating to complete authentication...");

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel ?? "undefined",
            }));

            if (refs.socket) {
                refs.socket.disconnect();
                refs.socket = null;
            }

            navigate("/complete-authentication", { state: { success: true } });

        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.");
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
