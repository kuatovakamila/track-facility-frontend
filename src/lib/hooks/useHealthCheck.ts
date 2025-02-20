import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;

// Define sensor data types
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
    faceIdVerified: boolean;
    errorMessage?: string;
};

// WebSocket Listener Setup
const configureSocketListeners = (
    socket: Socket,
    handlers: {
        onData: (data: SensorData) => void;
        onError: () => void;
    }
) => {
    socket.off("temperature");
    socket.off("alcohol");
    socket.off("camera");
    socket.off("faceId");

    console.log(`🔄 Setting up WebSocket listeners`);

    // Always listen to these events
    socket.on("temperature", handlers.onData);
    socket.on("alcohol", handlers.onData);
    socket.on("camera", handlers.onData);
    socket.on("faceId", handlers.onData);
};

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();

    // Load state from localStorage
    const [state, setState] = useState<HealthCheckState>(() => {
        const savedState = localStorage.getItem("healthCheckState");
        return savedState
            ? JSON.parse(savedState)
            : {
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
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
    }).current;

    // Update state and persist
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

    // Handle timeout
    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;
        console.warn("⏳ Timeout reached");

        localStorage.setItem("healthCheckState", JSON.stringify(state));

        if (state.currentState !== "ALCOHOL") {
            navigate("/", { replace: true });
        }
    }, [navigate, state]);

    // Handle incoming WebSocket data
    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) return;
            refs.lastDataTime = Date.now();

            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(() => {
                if (Date.now() - refs.lastDataTime > SOCKET_TIMEOUT) {
                    handleTimeout();
                }
            }, SOCKET_TIMEOUT);

            let alcoholStatus = state.alcoholData.alcoholLevel;
            if (data.alcoholLevel !== undefined) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            let isFaceIdVerified = state.faceIdVerified;
            if (data.cameraStatus === "success") {
                isFaceIdVerified = true;
            }

            setState((prev) => {
                const isTemperatureStable =
                    prev.currentState === "TEMPERATURE" &&
                    prev.stabilityTime + 1 >= MAX_STABILITY_TIME;
                const nextState = isTemperatureStable ? "ALCOHOL" : prev.currentState;

                const updatedState = {
                    ...prev,
                    stabilityTime: isTemperatureStable ? 0 : prev.stabilityTime + 1,
                    temperatureData:
                        prev.currentState === "TEMPERATURE" && data.temperature !== undefined
                            ? { temperature: parseFloat(Number(data.temperature).toFixed(2)) || 0 }
                            : prev.temperatureData,
                    alcoholData:
                        nextState === "ALCOHOL" && data.alcoholLevel !== undefined
                            ? { alcoholLevel: alcoholStatus }
                            : prev.alcoholData,
                    faceIdVerified: isFaceIdVerified,
                    currentState: nextState,
                };

                localStorage.setItem("healthCheckState", JSON.stringify(updatedState));
                return updatedState;
            });
        },
        [handleTimeout, state]
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

        configureSocketListeners(refs.socket, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });
    }, [handleTimeout, handleDataEvent]);

    // Handle completion
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
    }, [state, navigate]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({
                currentState:
                    typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};
