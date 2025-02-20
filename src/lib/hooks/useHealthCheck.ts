import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import toast from "react-hot-toast";

// Константы
const MAX_STABILITY_TIME = 7;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";
const SERVER_URL = import.meta.env.VITE_SERVER_URL;

// Типы данных
type HealthCheckState = {
    currentState: "TEMPERATURE" | "ALCOHOL";
    stabilityTime: number;
    temperatureData: { temperature: number | null };
    alcoholData: { alcoholLevel: string | null };
};

// Последовательность этапов проверки
const STATE_SEQUENCE: ("TEMPERATURE" | "ALCOHOL")[] = ["TEMPERATURE", "ALCOHOL"];

export const useHealthCheck = (): HealthCheckState & {
    startCheck: () => void;
    isLoading: boolean;
    handleComplete: () => Promise<void>;
} => {
    const navigate = useNavigate();
    const [state, setState] = useState<HealthCheckState>({
        currentState: "TEMPERATURE",
        stabilityTime: 0,
        temperatureData: { temperature: null },
        alcoholData: { alcoholLevel: null },
    });

    const [isLoading, setIsLoading] = useState(false);
    const refs = useRef({
        socket: null as Socket | null,
        isSubmitting: false,
        isConnected: false,
        timeout: null as NodeJS.Timeout | null,
    }).current;

    useEffect(() => {
        if (refs.socket) return;

        const socket = io(SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 5000,
            query: { faceId: localStorage.getItem("faceId") },
        });

        refs.socket = socket;

        socket.on("connect", () => {
            console.log("✅ WebSocket подключен.");
            refs.isConnected = true;
        });

        socket.on("disconnect", () => {
            console.warn("⚠️ WebSocket отключен.");
            refs.isConnected = false;
        });

        socket.on("health-data", (data) => {
            console.log("📡 Данные от сенсоров:", data);
            setState((prev) => ({
                ...prev,
                stabilityTime: data.stabilityTime,
                temperatureData: data.temperatureData,
                alcoholData: data.alcoholData,
            }));

            if (data.stabilityTime >= MAX_STABILITY_TIME) {
                advanceState();
            }
        });

        socket.on("state-update", ({ currentState }) => {
            console.log(`⏭️ Переход на следующий этап: ${currentState}`);
            setState((prev) => ({ ...prev, currentState }));
        });

        socket.on("completion", ({ success, temperatureData, alcoholData }) => {
            if (success) {
                console.log("✅ Проверка завершена!");
                localStorage.setItem("results", JSON.stringify({ temperatureData, alcoholData }));
                navigate("/complete-authentication", { state: { success: true } });
            }
        });

        socket.on("error", (message) => {
            console.error("💥 Ошибка сокета:", message);
            toast.error(message);
            navigate("/");
        });

        refs.timeout = setTimeout(() => {
            if (!refs.isConnected) {
                console.warn("⏳ Истекло время ожидания.");
                toast.error(TIMEOUT_MESSAGE);
                navigate("/");
            }
        }, 15000);

        return () => {
            if (refs.socket) {
                refs.socket.disconnect();
                refs.socket = null;
                refs.isConnected = false;
            }
            if (refs.timeout) clearTimeout(refs.timeout);
        };
    }, [navigate]);

    const startCheck = useCallback(() => {
        if (!refs.socket) return;
        console.log("🔄 Начинаем проверку здоровья...");
        setIsLoading(true);
        refs.socket.emit("start-check");
    }, []);

    const advanceState = useCallback(() => {
        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            const nextState = STATE_SEQUENCE[currentIndex + 1];
            console.log(`⏭️ Переход к ${nextState}`);
            setState((prev) => ({ ...prev, currentState: nextState }));
            refs.socket?.emit("state-update", { currentState: nextState });
        }
    }, [state.currentState]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        try {
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID не найден");

            console.log("✅ Отправляем данные...");

            const response = await fetch(`${SERVER_URL}/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    temperatureData: state.temperatureData,
                    alcoholData: state.alcoholData,
                    faceId,
                }),
            });

            if (!response.ok) {
                throw new Error(`Ошибка при отправке: ${await response.text()}`);
            }

            console.log("✅ Данные успешно отправлены!");

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            console.error("❌ Ошибка при отправке:", error);
            toast.error("Ошибка отправки данных. Попробуйте снова.");
        } finally {
            refs.isSubmitting = false;
            refs.socket?.disconnect();
        }
    }, [state, navigate]);

    return {
        ...state,
        startCheck,
        handleComplete,
        isLoading,
    };
};
