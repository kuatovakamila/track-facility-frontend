import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import { db } from "./firebase";



// Constants
const MAX_STABILITY_TIME = 7;
const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

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
        lastDataTime: Date.now(),
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

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) {
                console.warn("⚠️ Received empty data packet");
                return;
            }

            console.log("📡 Sensor data received:", data);
            refs.lastDataTime = Date.now();

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            setState((prev) => {
                if (prev.currentState === "ALCOHOL") {
                    console.log("✅ Alcohol data received, completing progress.");
                    return {
                        ...prev,
                        stabilityTime: MAX_STABILITY_TIME,
                        alcoholData: { alcoholLevel: alcoholStatus },
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

            if (state.currentState === "ALCOHOL") {
                setTimeout(handleComplete, 300);
            }
        },
        []
    );

    useEffect(() => {
        if (state.currentState === "ALCOHOL") {
            const alcoholRef = ref(db, "sensorData/alcohol");
            const unsubscribe = onValue(alcoholRef, (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    handleDataEvent(data as SensorData);
                }
            });

            return () => unsubscribe();
        }
    }, [state.currentState, handleDataEvent]);

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

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            navigate("/complete-authentication", { state: { success: true } });

            setTimeout(() => {
                console.log("🔄 Starting new session #" + (refs.sessionCount + 1));
                updateState({
                    currentState: "TEMPERATURE",
                    stabilityTime: 0,
                    temperatureData: { temperature: 0 },
                    alcoholData: { alcoholLevel: "Не определено" },
                    secondsLeft: 15,
                });
            }, 4000);
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