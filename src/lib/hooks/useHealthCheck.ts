import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const ALCOHOL_TIMEOUT = 15000; // Timeout for alcohol state
const TIMEOUT_MESSAGE =
	"Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

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
    errorMessage?: string;
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
        socket.on("temperature", handlers.onData);
    } else if (currentState === "ALCOHOL") {
        socket.on("alcohol", handlers.onData);
    }

    socket.on("camera", handlers.onData);
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
        errorMessage: ""
    });

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        alcoholTimeout: null as NodeJS.Timeout | null,
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
        console.warn("⏳ Timeout reached");
        if (state.currentState === "ALCOHOL") {
            updateState({ errorMessage: "⏳ Ошибка: Не удалось определить уровень алкоголя." });
            navigate("/");
        }
    }, [navigate, updateState, state.currentState]);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) return;
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel !== undefined) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
                clearTimeout(refs.alcoholTimeout!); // Clear timeout when valid alcohol data is received
            }

            setState((prev) => {
                const isTemperatureStable = prev.currentState === "TEMPERATURE" && prev.stabilityTime + 1 >= MAX_STABILITY_TIME;
                const nextState = isTemperatureStable ? "ALCOHOL" : prev.currentState;

                if (nextState === "ALCOHOL" && prev.currentState !== "ALCOHOL") {
                    refs.alcoholTimeout = setTimeout(() => {
                        console.warn("⏳ Alcohol data timeout reached");
                        updateState({ errorMessage: "⏳ Ошибка: Не удалось определить уровень алкоголя." });
						toast.error(TIMEOUT_MESSAGE, {
							duration: 3000,
							style: {
								background: "#272727",
								color: "#fff",
								borderRadius: "8px",
							},
						});
                        navigate("/");
                    }, ALCOHOL_TIMEOUT);
                }

                return {
                    ...prev,
                    stabilityTime: isTemperatureStable ? 0 : Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME),
                    temperatureData: prev.currentState === "TEMPERATURE" ? { temperature: parseFloat(Number(data.temperature).toFixed(2)) || 0 } : prev.temperatureData,
                    alcoholData: prev.currentState === "ALCOHOL" ? { alcoholLevel: alcoholStatus } : prev.alcoholData,
                    currentState: nextState,
                };
            });
        },
        [handleTimeout, navigate, updateState]
    );

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL, {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
            });
        }
        configureSocketListeners(refs.socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });
    }, [state.currentState, handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || state.currentState !== "ALCOHOL") return;
        refs.isSubmitting = true;

        try {
            refs.socket?.disconnect();
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");

            const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    temperatureData: state.temperatureData,
                    alcoholData: state.alcoholData,
                    faceId,
                }),
            });

            if (!response.ok) throw new Error("Request failed");

            navigate("/complete-authentication", { replace: true });
        } catch (error) {
            console.error("Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate, refs]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) => updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
