import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { toast } from "react-hot-toast";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7; // 7 seconds for progress completion
const SOCKET_TIMEOUT = 30000; // 30 seconds timeout before showing an error

// Define sensor data types
type SensorData = {
    temperature?: string;
    alcoholLevel?: string | null;
    sensorReady?: boolean;
    sensorStatus?: "on" | "off";
    cameraStatus?: "failed" | "success";
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    sensorReady: boolean;
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
        sensorReady: false, // Сенсор не готов изначально
        secondsLeft: 7,
    });

    const refs = useRef({
        socket: null as Socket | null,
        temperatureTimeout: null as NodeJS.Timeout | null,
        alcoholTimeout: null as NodeJS.Timeout | null,
        hasTimedOutTemperature: false,
        hasTimedOutAlcohol: false,
        isSubmitting: false,
        finalAlcoholLevel: "",
        hasBeenReady: false, // Добавляем флаг для предотвращения отката sensorReady
    }).current;

    const updateState = useCallback(
        <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
            setState((prev) => ({ ...prev, ...updates }));
        },
        []
    );

    const handleTimeout = useCallback(
        (type: "TEMPERATURE" | "ALCOHOL") => {
            if (type === "TEMPERATURE" && refs.hasTimedOutTemperature) return;
            if (type === "ALCOHOL" && refs.hasTimedOutAlcohol) return;

            if (type === "TEMPERATURE") {
                refs.hasTimedOutTemperature = true;
                updateState({ currentState: "ALCOHOL", stabilityTime: 0 });
                clearTimeout(refs.temperatureTimeout!);
            } else if (type === "ALCOHOL") {
                if (refs.finalAlcoholLevel) return;
                refs.hasTimedOutAlcohol = true;
                toast.error("Вы неправильно подули, повторите попытку.");
                setTimeout(() => navigate("/", { replace: true }), 1000);
                clearTimeout(refs.alcoholTimeout!);
            }
        },
        [navigate]
    );

    const handleDataEvent = useCallback((data: SensorData) => {
        console.log("📡 Received sensor data:", JSON.stringify(data));

        if (!data || (!data.temperature && !data.alcoholLevel && data.sensorReady === undefined)) {
            console.warn("⚠️ No valid sensor data received");
            return;
        }

        if (data.sensorReady !== undefined && !refs.hasBeenReady) {
            console.log(`🚦 Sensor ready: ${data.sensorReady}`);
            if (data.sensorReady) refs.hasBeenReady = true; // Если sensorReady был true, больше не меняем
            updateState({ sensorReady: refs.hasBeenReady });
        }

        if (data.temperature) {
            const tempValue = parseFloat(Number(data.temperature).toFixed(2)) || 0;
            console.log(`🌡️ Temperature received: ${tempValue}°C`);
            
            setState((prev) => ({
                ...prev,
                stabilityTime: prev.stabilityTime + 1,
                temperatureData: { temperature: tempValue },
                currentState: prev.stabilityTime + 1 >= MAX_STABILITY_TIME ? "ALCOHOL" : prev.currentState,
            }));
            
            clearTimeout(refs.temperatureTimeout!);
            refs.temperatureTimeout = setTimeout(() => handleTimeout("TEMPERATURE"), SOCKET_TIMEOUT);
        }

        if (refs.hasBeenReady && data.alcoholLevel !== null && (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal")) {
            console.log("✅ Valid alcohol data received, updating state...");
            clearTimeout(refs.alcoholTimeout!);
            refs.finalAlcoholLevel = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            updateState({
                stabilityTime: MAX_STABILITY_TIME,
                alcoholData: { alcoholLevel: refs.finalAlcoholLevel },
            });
            handleComplete();
        }
    }, []);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || refs.hasTimedOutAlcohol || state.currentState !== "ALCOHOL") return;
        refs.isSubmitting = true;
        clearTimeout(refs.alcoholTimeout!);
        clearTimeout(refs.temperatureTimeout!);

        console.log("🚀 Submitting health check data:", state.temperatureData.temperature, refs.finalAlcoholLevel);
        try {
            localStorage.setItem("finalTemperature", JSON.stringify(state.temperatureData.temperature));
            localStorage.setItem("finalAlcoholLevel", JSON.stringify(refs.finalAlcoholLevel));
            navigate("/final-results", { replace: true });
        } catch (error) {
            console.error("❌ Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate]);

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io("http://localhost:3001", { transports: ["websocket"], reconnection: true });
        }
        refs.socket.off("temperature");
        refs.socket.off("alcohol");
        refs.socket.on("temperature", handleDataEvent);
        refs.socket.on("alcohol", handleDataEvent);
        refs.socket.on("sensorReady", handleDataEvent);

        return () => {
            refs.socket?.off("temperature");
            refs.socket?.off("alcohol");
            refs.socket?.off("sensorReady");
        };
    }, [handleDataEvent]);

    return { 
        ...state, 
        handleComplete, 
        setCurrentState: (newState) => updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }) 
    };
};

//  import { useState, useEffect, useCallback, useRef } from "react";
// import { useNavigate } from "react-router-dom";
// import { io, type Socket } from "socket.io-client";
// import { toast } from "react-hot-toast";
// import { StateKey } from "../constants";

// // Constants
// const MAX_STABILITY_TIME = 7; // 7 seconds for progress completion
// const SOCKET_TIMEOUT = 30000; // 20 seconds timeout before showing an error

// // Define sensor data types
// type SensorData = {
//     temperature?: string;
//     alcoholLevel?: string;
//     cameraStatus?: "failed" | "success";
// };

// type HealthCheckState = {
//     currentState: StateKey;
//     stabilityTime: number;
//     temperatureData: { temperature: number };
//     alcoholData: { alcoholLevel: string };
//     secondsLeft: number;
// };

// export const useHealthCheck = (): HealthCheckState & {
//     handleComplete: () => Promise<void>;
//     setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
// } => {
//     const navigate = useNavigate();
//     const [state, setState] = useState<HealthCheckState>({
//         currentState: "TEMPERATURE",
//         stabilityTime: 0,
//         temperatureData: { temperature: 0 },
//         alcoholData: { alcoholLevel: "Не определено" },
//         secondsLeft: 7,
//     });

//     const refs = useRef({
//         socket: null as Socket | null,
//         temperatureTimeout: null as NodeJS.Timeout | null,
//         alcoholTimeout: null as NodeJS.Timeout | null,
//         hasTimedOutTemperature: false,
//         hasTimedOutAlcohol: false,
//         isSubmitting: false,
//         finalAlcoholLevel: "", // Store the final alcohol level
//     }).current;

//     const updateState = useCallback(
//         <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
//             setState((prev) => ({ ...prev, ...updates }));
//         },
//         []
//     );

//     const handleTimeout = useCallback(
//         (type: "TEMPERATURE" | "ALCOHOL") => {
//             if (type === "TEMPERATURE" && refs.hasTimedOutTemperature) return;
//             if (type === "ALCOHOL" && refs.hasTimedOutAlcohol) return;

//             if (type === "TEMPERATURE") {
//                 refs.hasTimedOutTemperature = true;
//                 console.warn("⏳ Timeout для TEMPERATURE, переход в ALCOHOL...");
//                 updateState({ currentState: "ALCOHOL", stabilityTime: 0 });

//                 clearTimeout(refs.temperatureTimeout!);
//             } else if (type === "ALCOHOL") {
//                 // 🚀 FIX: Prevent `toast.error` if alcohol was detected!
//                 if (refs.finalAlcoholLevel) return;

//                 refs.hasTimedOutAlcohol = true;
//                 console.warn("⏳ Timeout для ALCOHOL, показываем ошибку...");
//                 toast.error("Вы неправильно подули, повторите попытку.");
//                 setTimeout(() => navigate("/", { replace: true }), 1000);

//                 clearTimeout(refs.alcoholTimeout!);
//             }
//         },
//         [navigate]
//     );

//     const handleDataEvent = useCallback((data: SensorData) => {
//         console.log("📡 Received sensor data:", JSON.stringify(data));

//         if (!data || (!data.temperature && !data.alcoholLevel)) {
//             console.warn("⚠️ No valid sensor data received");
//             return;
//         }

//         // ✅ If temperature data is received, update it
//         if (data.temperature) {
//             const tempValue = parseFloat(Number(data.temperature).toFixed(2)) || 0;
//             console.log(`🌡️ Temperature received: ${tempValue}°C`);

//             setState((prev) => {
//                 let nextState = prev.currentState;
//                 let nextStabilityTime = prev.stabilityTime + 1;

//                 // ✅ Progress temperature stability time
//                 if (prev.currentState === "TEMPERATURE") {
//                     if (nextStabilityTime >= MAX_STABILITY_TIME) {
//                         nextState = "ALCOHOL";
//                         nextStabilityTime = 0;
//                         console.log("🔄 Switching to ALCOHOL...");
//                     }
//                 }

//                 return {
//                     ...prev,
//                     stabilityTime: nextStabilityTime,
//                     temperatureData: { temperature: tempValue },
//                     currentState: nextState,
//                 };
//             });

//             if (refs.temperatureTimeout !== null) {
//                 clearTimeout(refs.temperatureTimeout);
//             }
//             refs.temperatureTimeout = setTimeout(() => handleTimeout("TEMPERATURE"), SOCKET_TIMEOUT);
//         }

//         // ✅ If valid alcohol data is received, update state & clear timeout
//         if (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal") {
//             console.log("✅ Valid alcohol data received, updating state...");

//             if (refs.alcoholTimeout !== null) {
//                 clearTimeout(refs.alcoholTimeout);
//                 refs.alcoholTimeout = null;
//             }

//             refs.finalAlcoholLevel = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";

//             console.log("📡 Updated finalAlcoholLevel:", refs.finalAlcoholLevel);

//             setState((prev) => ({
//                 ...prev,
//                 stabilityTime: MAX_STABILITY_TIME,
//                 alcoholData: { alcoholLevel: refs.finalAlcoholLevel },
//             }));

//             handleComplete();
//             return;
//         }
//     }, []);

//     const handleComplete = useCallback(async () => {
//         if (refs.isSubmitting || refs.hasTimedOutAlcohol || state.currentState !== "ALCOHOL") return;
//         refs.isSubmitting = true;

//         // ✅ Ensure timeouts are cleared before submission
//         if (refs.alcoholTimeout !== null) {
//             clearTimeout(refs.alcoholTimeout);
//             refs.alcoholTimeout = null;
//         }

//         if (refs.temperatureTimeout !== null) {
//             clearTimeout(refs.temperatureTimeout);
//             refs.temperatureTimeout = null;
//         }

//         console.log("🚀 Submitting health check data with:", {
//             temperature: state.temperatureData.temperature,
//             alcoholLevel: refs.finalAlcoholLevel,
//         });

//         try {
//             // 🚀 FIX: Store values in `localStorage` to persist after navigation
//             localStorage.setItem("finalTemperature", JSON.stringify(state.temperatureData.temperature));
//             localStorage.setItem("finalAlcoholLevel", JSON.stringify(refs.finalAlcoholLevel));

//             navigate("/final-results", { replace: true });

//             return;
//         } catch (error) {
//             console.error("❌ Submission error:", error);
//             refs.isSubmitting = false;
//         }
//     }, [state, navigate]);

//     useEffect(() => {
//         if (!refs.socket) {
//             refs.socket = io("http://localhost:3001", {
//                 transports: ["websocket"],
//                 reconnection: true,
//                 reconnectionAttempts: Infinity,
//                 reconnectionDelay: 1000,
//             });
//         }

//         refs.socket.off("temperature");
//         refs.socket.off("alcohol");

//         if (state.currentState === "TEMPERATURE") {
//             refs.socket.on("temperature", handleDataEvent);
//         } else if (state.currentState === "ALCOHOL") {
//             refs.socket.on("alcohol", handleDataEvent);
//         }

//         refs.temperatureTimeout = setTimeout(() => handleTimeout("TEMPERATURE"), SOCKET_TIMEOUT);
//         refs.alcoholTimeout = setTimeout(() => handleTimeout("ALCOHOL"), SOCKET_TIMEOUT);
//     }, [state.currentState, handleTimeout, handleDataEvent]);

//     return {
//         ...state,
//         handleComplete,
//         setCurrentState: (newState) => updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
//     };
// };



 