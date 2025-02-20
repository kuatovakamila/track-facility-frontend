import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getDatabase, ref, onValue, off } from "firebase/database";
import { initializeApp } from "firebase/app";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// ✅ Load Firebase config from Environment Variables
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
    measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// ✅ Firebase initialization (prevent multiple initializations)
const firebaseAppRef = useRef<any>(null);
const dbRef = useRef<any>(null);

const useFirebase = () => {
    useEffect(() => {
        if (!firebaseAppRef.current) {
            firebaseAppRef.current = initializeApp(firebaseConfig);
            dbRef.current = getDatabase(firebaseAppRef.current);
        }
    }, []);
    return dbRef.current;
};

// ✅ Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

type SensorData = {
    power?: number;
    sober?: number;
    drunk?: number;
    relay?: number;
    ready?: number;
    status?: string;
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    validAlcoholReceived: boolean;
    secondsLeft: number;
};

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();
    const db = useFirebase();

    const [state, setState] = useState<HealthCheckState>({
        currentState: "TEMPERATURE",
        stabilityTime: 0,
        temperatureData: { temperature: 0 },
        alcoholData: { alcoholLevel: "Не определено" },
        validAlcoholReceived: false,
        secondsLeft: 15,
    });

    const refs = useRef({
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
    }).current;
    const updateState = useCallback(
        (updates: Partial<HealthCheckState> | ((prevState: HealthCheckState) => Partial<HealthCheckState>)) => {
            setState((prev) => ({
                ...prev,
                ...(typeof updates === "function" ? updates(prev) : updates),
            }));
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

        navigate("/");
    }, [navigate]);

    const listenToAlcoholData = useCallback(() => {
        if (!db) return; // ✅ Ensure Firebase is initialized

        const alcoholRef = ref(db, "alcohol_value");
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

            let alcoholStatus = "Не определено";
            if (data.sober === 0) alcoholStatus = "Трезвый";
            else if (data.drunk === 0) alcoholStatus = "Пьяный";

            const isValidAlcoholData = data.sober === 0 || data.drunk === 0;

            setState((prev) => ({
                ...prev,
                stabilityTime: prev.currentState === "TEMPERATURE"
                    ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                    : prev.stabilityTime,
                alcoholData: prev.currentState === "ALCOHOL"
                    ? { alcoholLevel: alcoholStatus }
                    : prev.alcoholData,
                validAlcoholReceived: isValidAlcoholData,
            }));

            if (isValidAlcoholData) {
                console.log("✅ Alcohol measurement finalized. Saving and navigating...");

                updateState((prev) => ({ ...prev, validAlcoholReceived: true }));

                localStorage.setItem("results", JSON.stringify({
                    temperature: state.temperatureData.temperature,
                    alcohol: alcoholStatus,
                }));

                if (refs.timeout) clearTimeout(refs.timeout);

                setTimeout(() => {
                    navigate("/complete-authentication", { state: { success: true } });
                }, 500);
            }
        });

        return () => {
            off(alcoholRef, "value", unsubscribe);
            if (refs.timeout) clearTimeout(refs.timeout);
        };
    }, [db, navigate, updateState, handleTimeout]);

    useEffect(() => {
        if (state.currentState === "ALCOHOL") {
            const cleanup = listenToAlcoholData();
            return cleanup;
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
