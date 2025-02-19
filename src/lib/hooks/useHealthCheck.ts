import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const ALCOHOL_TIMEOUT = 10000;
const FACEID_TIMEOUT = 20000; // Timeout for Face ID verification

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
    faceIdVerified: boolean;
    errorMessage?: string;
};

// WebSocket Listener Setup
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
    socket.off("faceId");

    console.log(`🔄 Setting up WebSocket listeners for state: ${currentState}`);

    if (currentState === "TEMPERATURE") {
        socket.on("temperature", handlers.onData);
    } else if (currentState === "ALCOHOL") {
        socket.on("alcohol", handlers.onData);
    }

    socket.on("camera", handlers.onData);
    socket.on("faceId", handlers.onData);
};

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();

    // Load state from localStorage to persist progress
    const [state, setState] = useState<HealthCheckState>(() => {
        const savedState = localStorage.getItem("healthCheckState");
        return savedState ? JSON.parse(savedState) : {
            currentState: "TEMPERATURE",
            stabilityTime: 0,
            temperatureData: { temperature: 0 },
            alcoholData: { alcoholLevel: "Не определено" },
            secondsLeft: 15,
            faceIdVerified: false,
            errorMessage: "",
        };
    });

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        alcoholTimeout: null as NodeJS.Timeout | null,
        faceIdTimeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
    }).current;

    // Update state and persist to localStorage
    const updateState = useCallback(
        <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
            setState((prev) => {
                const newState = { ...prev, ...updates };
                localStorage.setItem("healthCheckState", JSON.stringify(newState));
                return newState;
            });
        },
        []
    );

    // Handle WebSocket timeout for Temperature & Alcohol
    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;
        console.warn("⏳ Timeout reached");

        if (state.currentState !== "ALCOHOL") {
            navigate("/");
        }
    }, [navigate, state.currentState]);

    // Handle Alcohol Timeout
    const handleAlcoholTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;
        console.warn("⏳ Alcohol data timeout reached");
        updateState({ errorMessage: "⏳ Ошибка: Не удалось определить уровень алкоголя." });
        navigate("/");
    }, [navigate, updateState]);

    // Handle Face ID Timeout Separately
    const handleFaceIdTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;
        console.warn("⏳ Face ID timeout reached");
        updateState({ errorMessage: "⏳ Ошибка: Face ID не подтверждено." });
        navigate("/");
    }, [navigate, updateState]);

    // Handle incoming WebSocket data
    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) return;
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel !== undefined) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
                clearTimeout(refs.alcoholTimeout!);
            }

            let isFaceIdVerified = state.faceIdVerified;
            if (data.cameraStatus === "success") {
                isFaceIdVerified = true;
                clearTimeout(refs.faceIdTimeout!);
            }

            setState((prev) => {
                const isTemperatureStable = prev.currentState === "TEMPERATURE" && prev.stabilityTime + 1 >= MAX_STABILITY_TIME;
                const nextState = isTemperatureStable ? "ALCOHOL" : prev.currentState;

                if (nextState === "ALCOHOL" && prev.currentState !== "ALCOHOL") {
                    refs.alcoholTimeout = setTimeout(handleAlcoholTimeout, ALCOHOL_TIMEOUT);
                }

                if (!state.faceIdVerified) {
                    refs.faceIdTimeout = setTimeout(handleFaceIdTimeout, FACEID_TIMEOUT);
                }

                const newState = {
                    ...prev,
                    stabilityTime: isTemperatureStable ? 0 : Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME),
                    temperatureData: prev.currentState === "TEMPERATURE" ? { temperature: parseFloat(Number(data.temperature).toFixed(2)) || 0 } : prev.temperatureData,
                    alcoholData: prev.currentState === "ALCOHOL" ? { alcoholLevel: alcoholStatus } : prev.alcoholData,
                    faceIdVerified: isFaceIdVerified,
                    currentState: nextState,
                };

                localStorage.setItem("healthCheckState", JSON.stringify(newState));
                return newState;
            });
        },
        [handleTimeout, handleAlcoholTimeout, handleFaceIdTimeout, state.faceIdVerified]
    );

    // WebSocket Initialization
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

    // Handle completion and reset state
    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || state.currentState !== "ALCOHOL" || !state.faceIdVerified) return;
        refs.isSubmitting = true;

        try {
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

            localStorage.removeItem("healthCheckState");
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
