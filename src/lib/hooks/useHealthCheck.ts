import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue, off } from "firebase/database";
import { db } from "./firebase"; // ✅ Firebase instance
import { io } from "socket.io-client"; // ✅ WebSocket client
import toast from "react-hot-toast";

// ✅ Define type for `StateKey`
export type StateKey = "TEMPERATURE" | "ALCOHOL";

export type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    validAlcoholReceived: boolean;
    secondsLeft: number;
};

// ✅ WebSocket connection (Replace with your backend URL)
const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 5000,
});

const SOCKET_TIMEOUT = 15000;
const TIMEOUT_MESSAGE = "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
} => {
    const navigate = useNavigate();
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
        hasTimedOut: false,
    }).current;

    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;

        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: { background: "#272727", color: "#fff", borderRadius: "8px" },
        });

        navigate("/");
    }, [navigate]);

    const listenToTemperatureData = useCallback(() => {
        console.log("✅ Listening for temperature via WebSocket...");

        socket.on("connect", () => console.log("✅ WebSocket connected"));
        socket.on("disconnect", () => console.warn("⚠️ WebSocket disconnected"));
        
        socket.on("temperature", (data) => {
            console.log("📡 Temperature data received:", data);

            if (isMounted.current) {
                setState((prev) => ({
                    ...prev,
                    temperatureData: { temperature: Number(data.temperature) || 0 },
                }));
            }
        });

        return () => {
            socket.off("temperature");
        };
    }, []);

    const listenToAlcoholData = useCallback(() => {
        const alcoholRef = ref(db, "/alcohol_value");
        console.log("📡 Listening to Firebase alcohol data...");

        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

        const unsubscribe = onValue(alcoholRef, (snapshot) => {
            if (!snapshot.exists()) {
                console.warn("⚠️ No data at '/alcohol_value' path.");
                return;
            }

            const data = snapshot.val();
            console.log("📡 Alcohol data received from Firebase:", data);

            let alcoholStatus = "Не определено";
            if (data.sober === 0) alcoholStatus = "Трезвый";
            else if (data.drunk === 0) alcoholStatus = "Пьяный";

            const isValidAlcoholData = data.sober === 0 || data.drunk === 0;

            if (isMounted.current) {
                setState((prev) => ({
                    ...prev,
                    alcoholData: { alcoholLevel: alcoholStatus },
                    validAlcoholReceived: isValidAlcoholData,
                }));
            }

            if (isValidAlcoholData) {
                console.log("✅ Alcohol measurement finalized. Saving and navigating...");

                localStorage.setItem("results", JSON.stringify({
                    temperature: state.temperatureData.temperature,
                    alcohol: alcoholStatus,
                }));

                clearTimeout(refs.timeout!);
                setTimeout(() => navigate("/complete-authentication"), 500);
            }
        });

        return () => {
            off(alcoholRef, "value", unsubscribe);
            clearTimeout(refs.timeout!);
        };
    }, [navigate, handleTimeout]);

    useEffect(() => {
        const cleanupTemperature = listenToTemperatureData();
        const cleanupAlcohol = listenToAlcoholData();

        return () => {
            cleanupTemperature();
            cleanupAlcohol();
        };
    }, [listenToTemperatureData, listenToAlcoholData]);

    const handleComplete = useCallback(async (): Promise<void> => {
        return new Promise<void>((resolve) => {
            listenToAlcoholData();
            resolve();
        });
    }, [listenToAlcoholData]);

    return {
        ...state,
        handleComplete,
    };
};
