import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";
const ALCOHOL_WAIT_MESSAGE = "Ожидание данных об уровне алкоголя...";

// Types
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

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

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
    reconnectSocket: () => void;
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
        sessionCount: 0,
    }).current;

    const updateState = useCallback(
        <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
            setState((prev) => ({ ...prev, ...updates }));
        },
        []
    );

    // ✅ Timeout handler with retry logic
    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;

        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: { background: "#272727", color: "#fff", borderRadius: "8px" },
        });

        refs.socket?.emit("retry");

        setTimeout(() => {
            if (!refs.hasNavigated) {
                updateState({ currentState: "TEMPERATURE", stabilityTime: 0 });
            }
        }, 5000);
    }, [navigate]);

    // ✅ Handle incoming sensor data (prevents progress until valid alcohol data)
    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) {
                console.warn("⚠️ Received empty data packet");
                return;
            }

            console.log("📡 Sensor data received:", data);
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            setState((prev) => {
                const isAlcoholStage = prev.currentState === "ALCOHOL";
                const isTemperatureStage = prev.currentState === "TEMPERATURE";

                let newAlcoholLevel = prev.alcoholData.alcoholLevel;
                if (data.alcoholLevel) {
                    newAlcoholLevel = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
                }

                const newState = {
                    ...prev,
                    stabilityTime: isTemperatureStage
                        ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                        : prev.stabilityTime, // ✅ Stability should not increase if alcohol data is missing
                    temperatureData: isTemperatureStage
                        ? { temperature: Number(data.temperature) || 0 }
                        : prev.temperatureData,
                    alcoholData: isAlcoholStage && data.alcoholLevel
                        ? { alcoholLevel: newAlcoholLevel }
                        : prev.alcoholData,
                };

                // ✅ Ensure alcohol progress does not start unless alcohol level is received
                if (isAlcoholStage && data.alcoholLevel) {
                    console.log("✅ Alcohol data received, triggering completion...");
                    newState.stabilityTime = MAX_STABILITY_TIME; // Mark stability as complete
                    setTimeout(handleComplete, 300);
                } else if (isAlcoholStage && !data.alcoholLevel) {
                    console.warn("⚠️ Waiting for valid alcohol data...");
                    toast.loading(ALCOHOL_WAIT_MESSAGE, { duration: 3000 });
                }

                return newState;
            });
        },
        [handleTimeout]
    );

    // ✅ WebSocket Connection
    const reconnectSocket = useCallback(() => {
        if (refs.socket) return;

        refs.socket = io(import.meta.env.VITE_SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 50,
            reconnectionDelay: 5000,
        });

        refs.socket.on("connect", () => {
            console.log("✅ WebSocket connected.");
        });

        refs.socket.on("disconnect", (reason) => {
            console.warn("⚠️ WebSocket disconnected:", reason);
            if (!refs.hasNavigated) {
                refs.socket?.connect();
            }
        });

        configureSocketListeners(refs.socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });
    }, [handleTimeout, handleDataEvent]);

    // ✅ Disconnect WebSocket after authentication
    const disconnectSocket = useCallback(() => {
        if (refs.socket) {
            console.log("🛑 Disconnecting WebSocket...");
            refs.socket.disconnect();
            refs.socket = null;
        }
    }, []);

    // ✅ WebSocket setup
    useEffect(() => {
        reconnectSocket();
        return () => {
            console.log("🛑 Keeping WebSocket alive during authentication...");
        };
    }, [reconnectSocket]);

    // ✅ Handle authentication completion
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
            console.log("📡 Sending final data...");

            refs.hasNavigated = true;
            refs.sessionCount += 1;

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            navigate("/complete-authentication", { state: { success: true } });

            setTimeout(() => {
                disconnectSocket();
                navigate("/");
                setTimeout(() => {
                    updateState({
                        currentState: "TEMPERATURE",
                        stabilityTime: 0,
                        temperatureData: { temperature: 0 },
                        alcoholData: { alcoholLevel: "Не определено" },
                        secondsLeft: 15,
                    });
                }, 1000);
            }, 4000);
        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.");
            refs.isSubmitting = false;
        }
    }, [state, navigate, updateState, disconnectSocket]);

    return { 
        ...state, 
        handleComplete, 
		setCurrentState: (newState) =>
	    updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
        reconnectSocket 
    };
};


// setCurrentState: (newState) =>
//updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),