import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getDatabase, ref, onValue, off } from "firebase/database"; // ✅ Firebase Import
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import { initializeApp } from "firebase/app";

// ✅ Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyD7rMYKCWP71TJ5t7sl_wdlDzel8aGvMPQ",
    authDomain: "automated-monitoring-solutions.firebaseapp.com",
    databaseURL: "https://automated-monitoring-solutions-default-rtdb.firebaseio.com",
    projectId: "automated-monitoring-solutions",
    storageBucket: "automated-monitoring-solutions.firebasestorage.app",
    messagingSenderId: "404798850665",
    appId: "1:404798850665:web:10e8f83154e4a9a5e144f8",
    measurementId: "G-LEG72SFNW6"
  };
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000; // ✅ Timeout before redirecting to home
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

type SensorData = {
    power?: number;
    sober?: number; // ✅ If 0, user is sober
    drunk?: number; // ✅ If 0, user is drunk
    relay?: number;
    ready?: number;
    status?: string;
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    validAlcoholReceived: boolean; // ✅ Tracks if valid alcohol data is received
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
        validAlcoholReceived: false, // ✅ Initially false
        secondsLeft: 15,
    });

    const refs = useRef({
        timeout: null as NodeJS.Timeout | null,
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

    // ✅ Handles timeout and redirects the user to home
    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;

        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: { background: "#272727", color: "#fff", borderRadius: "8px" },
        });
        navigate("/"); // ✅ Redirects user to home page
    }, [navigate]);

    const listenToAlcoholData = useCallback(() => {
        const alcoholRef = ref(db, "alcohol_value"); // ✅ Path to alcohol data in Firebase
        console.log("📡 Listening to Firebase alcohol data...");

        // ✅ Set a timeout to navigate home if no valid alcohol data is received
        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        const unsubscribe = onValue(alcoholRef, (snapshot) => {
            const data: SensorData | null = snapshot.val();
            if (!data) {
                console.warn("⚠️ No alcohol data received from Firebase.");
                return;
            }

            console.log("📡 Alcohol data received from Firebase:", data);

            // ✅ Check if valid alcohol data is received
            let alcoholStatus = "Не определено";
            if (data.sober === 0) {
                alcoholStatus = "Трезвый"; // ✅ Sober
            } else if (data.drunk === 0) {
                alcoholStatus = "Пьяный"; // ✅ Drunk
            }

            const isValidAlcoholData = data.sober === 0 || data.drunk === 0;

            setState((prev) => ({
                ...prev,
                stabilityTime: prev.currentState === "TEMPERATURE"
                    ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                    : prev.stabilityTime,
                alcoholData: prev.currentState === "ALCOHOL"
                    ? { alcoholLevel: alcoholStatus }
                    : prev.alcoholData,
                validAlcoholReceived: isValidAlcoholData, // ✅ Enables progress bar when valid data is received
            }));

            // ✅ If valid alcohol data is received, store and navigate
            if (isValidAlcoholData && !state.validAlcoholReceived) {
                console.log("✅ Alcohol measurement finalized. Saving and navigating...");

                updateState({ validAlcoholReceived: true });

                localStorage.setItem("results", JSON.stringify({
                    temperature: state.temperatureData.temperature,
                    alcohol: alcoholStatus,
                }));

                // ✅ Clear timeout since valid data was received
                clearTimeout(refs.timeout!);

                setTimeout(() => {
                    navigate("/complete-authentication", { state: { success: true } });
                }, 500); // Small delay to ensure UI updates
            }
        });

        return () => {
            off(alcoholRef, "value", unsubscribe); // ✅ Cleanup listener
            clearTimeout(refs.timeout!); // ✅ Cleanup timeout when unmounting
        };
    }, [navigate, updateState, handleTimeout]);

    useEffect(() => {
        // ✅ Start listening to alcohol data when in ALCOHOL state
        if (state.currentState === "ALCOHOL") {
            const cleanup = listenToAlcoholData();
            return cleanup; // ✅ Cleanup Firebase listener when component unmounts
        }
    }, [state.currentState, listenToAlcoholData]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

        console.log("🚀 Checking state sequence...");

        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            updateState({ currentState: STATE_SEQUENCE[currentIndex + 1], stabilityTime: 0 });

            refs.isSubmitting = false;
            return;
        }
    }, [state, navigate, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) =>
            updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
