import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";
const SERVER_URL = import.meta.env.VITE_SERVER_URL;

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
    setCurrentState: (newState: StateKey) => void; // ✅ Fix Type Here
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
        isConnected: false,
    }).current;

    // ✅ General State Updater
    const updateState = useCallback(
        <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
            setState((prev) => ({ ...prev, ...updates }));
        },
        []
    );

    // ✅ Fix `setCurrentState` Type Error
    const setCurrentState = useCallback((newState: StateKey) => {
        setState((prev) => ({ ...prev, currentState: newState }));
    }, []);

    // ✅ Handle timeout to prevent infinite waiting
    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut || refs.isSubmitting) return;
        refs.hasTimedOut = true;

        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: { background: "#272727", color: "#fff", borderRadius: "8px" },
        });

        navigate("/");
    }, [navigate]);

    // ✅ Handle WebSocket Data
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

            // 🔥 Handle Camera Face ID events
            if (data.cameraStatus) {
                if (data.cameraStatus === "failed") {
                    toast.error("⚠️ Face ID failed. Please try again.", {
                        duration: 3000,
                        style: { background: "#ff4d4d", color: "#fff", borderRadius: "8px" },
                    });
                    return;
                }

                if (data.cameraStatus === "success" && state.currentState === "TEMPERATURE") {
                    console.log("✅ Face ID recognized, moving to temperature check...");
                    setCurrentState("TEMPERATURE");

                    setTimeout(() => {
                        navigate("/temperature-check");
                    }, 500);
                }
                return;
            }

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
        [state.currentState, state.stabilityTime, state.temperatureData, state.alcoholData, updateState, handleTimeout, setCurrentState]
    );

    // ✅ WebSocket Connection Setup
    useEffect(() => {
        if (refs.socket) return; // Prevent duplicate sockets
        refs.hasTimedOut = false;

        const socket = io(SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 5000,
        });

        socket.on("connect", () => {
            console.log("✅ WebSocket connected successfully.");
            refs.socket = socket;
            refs.isConnected = true;
        });

        socket.on("disconnect", (reason) => {
            console.warn("⚠️ WebSocket disconnected:", reason);
            refs.isConnected = false;
        });

        socket.on("connect_error", handleTimeout);
        socket.on("error", handleTimeout);

        socket.on("temperature", handleDataEvent);
        socket.on("alcohol", handleDataEvent);
        socket.on("camera", handleDataEvent);

        return () => {
            if (refs.socket) {
                refs.socket.disconnect();
                refs.socket = null;
                refs.isConnected = false;
            }
        };
    }, [handleTimeout, handleDataEvent]);

    // ✅ Handle Final Submission to Firebase
    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Checking state sequence...");
        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);

        if (currentIndex < STATE_SEQUENCE.length - 1) {
            console.log("⏭️ Moving to next state:", STATE_SEQUENCE[currentIndex + 1]);
            setCurrentState(STATE_SEQUENCE[currentIndex + 1]);
            refs.isSubmitting = false;
            return;
        }

        try {
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");

            console.log("✅ Submitting data to Firebase...");

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
                throw new Error(`Firebase request failed: ${await response.text()}`);
            }

            console.log("✅ Firebase submission successful!");

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            console.error("❌ Firebase Submission error:", error);
            toast.error("Ошибка отправки данных. Попробуйте снова.");
        } finally {
            refs.isSubmitting = false;
            refs.socket?.disconnect();
        }
    }, [state, navigate, setCurrentState]);

    return {
        ...state,
        handleComplete,
        setCurrentState, // ✅ Fix Type Issue
    };
};
