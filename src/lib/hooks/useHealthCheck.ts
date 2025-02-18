import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
const TIMEOUT_MESSAGE =
    "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// Type definitions
type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
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
    socket.removeAllListeners();
    socket.on("connect_error", handlers.onError);
    socket.on("error", handlers.onError);

    switch (currentState) {
        case "TEMPERATURE":
            socket.on("temperature", handlers.onData);
            break;
        case "ALCOHOL":
            socket.on("alcohol", handlers.onData);
            break;
    }
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
        socket: null as Socket | null,
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

    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;

        refs.hasTimedOut = true;
        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: {
                background: "#272727",
                color: "#fff",
                borderRadius: "8px",
            },
        });
        navigate("/");
    }, [navigate]);

    const handleDataEvent = useCallback(
		(data: SensorData) => {
			if (!data) return;
			refs.lastDataTime = Date.now();
			clearTimeout(refs.timeout!);
			refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
	
			let alcoholStatus = "Не определено"; // Default state
	
			if (data.alcoholLevel) {
				try {
					const alcoholData = JSON.parse(data.alcoholLevel);
					if (alcoholData.sober === 1) {
						alcoholStatus = "Трезвый";
					} else if (alcoholData.drunk === 1) {
						alcoholStatus = "Пьяный";
					}
				} catch (error) {
					console.error("Ошибка парсинга данных алкоголя:", error);
				}
			}
	
			updateState({
				stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
				temperatureData:
					state.currentState === "TEMPERATURE"
						? { temperature: Number(data.temperature) || 0 }
						: state.temperatureData,
				alcoholData:
					state.currentState === "ALCOHOL"
						? { alcoholLevel: alcoholStatus }
						: state.alcoholData,
			});
		},
		[state.currentState, state.stabilityTime, state.temperatureData, state.alcoholData, updateState, handleTimeout]
	);
	

    useEffect(() => {
        refs.hasTimedOut = false;
        const socket = io(import.meta.env.VITE_SERVER_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });

        refs.socket = socket;
        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
        configureSocketListeners(socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });

        const stabilityInterval = setInterval(() => {
            if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
                updateState({
                    stabilityTime: Math.max(state.stabilityTime - 1, 0),
                });
            }
        }, STABILITY_UPDATE_INTERVAL);

        return () => {
            socket.disconnect();
            clearTimeout(refs.timeout!);
            clearInterval(stabilityInterval);
        };
    }, [state.currentState, handleTimeout, handleDataEvent]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting) return;
        refs.isSubmitting = true;

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
            refs.socket?.disconnect();
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");

            localStorage.setItem(
                "results",
                JSON.stringify({
                    temperature: state.temperatureData.temperature ?? 0,
                    alcohol: state.alcoholData.alcoholLevel ?? "Не определено",
                })
            );

            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            console.error("Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate, updateState]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState: React.SetStateAction<StateKey>) =>
            updateState({
                currentState: typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};
