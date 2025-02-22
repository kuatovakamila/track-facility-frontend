import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;

type SensorData = {
    temperature?: string;
    cameraStatus?: 'failed' | 'success';
};

type FirebaseAlcoholData = {
    power: number;
    sober: number;
    drunk: number;
    relay: number;
    ready: number;
    status: string;
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
        hasNavigated: false,
        sessionCount: 0,
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

        console.warn("⏳ Timeout reached: No valid alcohol data received.");
        navigate("/");
    }, [navigate]);

    const handleTemperatureData = useCallback(
        (data: SensorData) => {
            if (!data || !data.temperature) return;

            console.log("📡 Temperature data received:", data);
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            setState((prev) => ({
                ...prev,
                stabilityTime: prev.currentState === "TEMPERATURE"
                    ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                    : prev.stabilityTime,
                temperatureData: { temperature: Number(data.temperature) || 0 },
            }));
        },
        [handleTimeout]
    );

    const listenToAlcoholData = useCallback(() => {
        const alcoholRef = ref(db, "alcohol_value");

        console.log("🔄 Listening for alcohol data from Firebase...");

        const unsubscribe = onValue(alcoholRef, (snapshot) => {
            const data: FirebaseAlcoholData | null = snapshot.val();

            if (!data) {
                console.warn("⚠️ No alcohol data received.");
                return;
            }

            console.log("📡 Alcohol data received from Firebase:", data);

            let alcoholStatus = "Не определено";
            if (data.sober === 0) {
                alcoholStatus = "Трезвый";
            } else if (data.drunk === 0) {
                alcoholStatus = "Пьяный";
            } else {
                return; // ⏳ Continue waiting until one becomes 0
            }

            console.log(`✅ Valid alcohol data received: ${alcoholStatus}`);

            setState((prev) => ({
                ...prev,
                stabilityTime: MAX_STABILITY_TIME,
                alcoholData: { alcoholLevel: alcoholStatus },
            }));

            unsubscribe(); // ✅ Automatically stop listening once valid data is received
            setTimeout(handleComplete, 300);
        });

        refs.timeout = setTimeout(() => {
            console.warn("⏳ Timeout: No valid alcohol data received.");
            unsubscribe();
            handleTimeout();
        }, SOCKET_TIMEOUT);

        return unsubscribe;
    }, [handleTimeout]);

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001', {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: 20,
                reconnectionDelay: 10000,
            });

            refs.socket.on("connect", () => {
                console.log("✅ WebSocket connected.");
            });

            refs.socket.on("disconnect", (reason) => {
                console.warn("⚠️ WebSocket disconnected:", reason);
                refs.socket = null;
            });

            refs.socket.on("temperature", handleTemperatureData);
        }

        if (state.currentState === "ALCOHOL") {
            listenToAlcoholData();
        }

        return () => {
            console.log("🛑 Cleanup function, but not stopping Firebase listener.");
        };
    }, [state.currentState, handleTemperatureData, listenToAlcoholData]);

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

        // ✅ Instead of resetting, go to `/complete-authentication`
        try {
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("❌ Face ID not found");

            console.log("📡 Sending final data...");

            refs.hasNavigated = true;
            refs.sessionCount += 1;

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

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
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
