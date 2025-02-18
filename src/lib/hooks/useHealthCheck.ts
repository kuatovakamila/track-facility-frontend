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
	sober?: number;
	drunk?: number;
	ready?: number;
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
	},
) => {
	socket.removeAllListeners();
	socket.on("connect_error", handlers.onError);
	socket.on("error", handlers.onError);

	switch (currentState) {
		case "TEMPERATURE":
			socket.on("temperature", (data) => {
				console.log("📡 Received TEMPERATURE data:", data);
				handlers.onData(data);
			});
			break;
		case "ALCOHOL":
			socket.on("alcohol", (data) => {
				console.log("📡 Received ALCOHOL data:", data);
				handlers.onData(data);
			});
			break;
	}
};

export const useHealthCheck = (): HealthCheckState & {
	handleComplete: () => Promise<void>;
	setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
	const navigate = useNavigate();
	const [state, setState] = useState<Omit<HealthCheckState, "secondsLeft">>({
		currentState: "TEMPERATURE",
		stabilityTime: 0,
		temperatureData: { temperature: 0 },
		alcoholData: { alcoholLevel: "Не определено" },
	});
	const [secondsLeft, setSecondsLeft] = useState(15);

	const refs = useRef({
		socket: null as Socket | null,
		timeout: null as NodeJS.Timeout | null,
		lastDataTime: Date.now(),
		hasTimedOut: false,
		isSubmitting: false,
	}).current;

	const updateState = useCallback(
		<K extends keyof HealthCheckState>(
			updates: Pick<HealthCheckState, K>,
		) => {
			setState((prev) => ({ ...prev, ...updates }));
		},
		[],
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
	}, [navigate, refs]);

	const handleDataEvent = useCallback(
		(data: SensorData) => {
			console.log("🔥 Received Sensor Data:", data);
			if (!data) return;

			refs.lastDataTime = Date.now();
			clearTimeout(refs.timeout!);
			refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

			// ✅ Ensure temperature data updates correctly
			const temperatureValue =
				data.temperature !== undefined ? Number(data.temperature) : state.temperatureData.temperature;

			// ✅ Ensure alcohol status is only updated when sober or drunk is 0
			let alcoholStatus = state.alcoholData.alcoholLevel; // Keep existing value
			if (data.sober === 0) {
				alcoholStatus = "Трезвый";
			} else if (data.drunk === 0) {
				alcoholStatus = "Пьяный";
			} else {
				console.log("🔄 Waiting for a valid alcohol status...");
			}

			updateState({
				stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
				temperatureData:
					state.currentState === "TEMPERATURE"
						? { temperature: temperatureValue }
						: state.temperatureData,
				alcoholData:
					state.currentState === "ALCOHOL"
						? { alcoholLevel: alcoholStatus }
						: state.alcoholData,
			});

			console.log("🌡️ Updated temperature data:", temperatureValue);
			console.log("🚀 Updated alcohol data:", alcoholStatus);
		},
		[
			state.currentState,
			state.stabilityTime,
			state.temperatureData,
			state.alcoholData,
			updateState,
			handleTimeout,
			refs,
		],
	);

	const setupSocketForState = useCallback(
		(socket: Socket, currentState: StateKey) => {
			configureSocketListeners(socket, currentState, {
				onData: handleDataEvent,
				onError: handleTimeout,
			});
		},
		[handleDataEvent, handleTimeout],
	);

	useEffect(() => {
		console.log("🔗 Connecting to WebSocket:", import.meta.env.VITE_SERVER_URL);

		refs.hasTimedOut = false;

		const socket = io(import.meta.env.VITE_SERVER_URL, {
			transports: ["websocket"],
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
		});

		refs.socket = socket;
		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		socket.on("connect", () => {
			console.log("✅ WebSocket connected!");
		});

		socket.on("disconnect", () => {
			console.log("❌ WebSocket disconnected!");
		});

		setupSocketForState(socket, state.currentState);

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
	}, [
		state.currentState,
		state.stabilityTime,
		handleTimeout,
		handleDataEvent,
		setupSocketForState,
		refs,
		updateState,
	]);

	useEffect(() => {
		setSecondsLeft(15);
		const interval = setInterval(() => {
			setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
		}, 1000);
		return () => clearInterval(interval);
	}, [state.currentState]);

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
	
			const response = await fetch(
				`${import.meta.env.VITE_SERVER_URL}/health`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						temperatureData: state.temperatureData,
						alcoholData: state.alcoholData,
						faceId,
					}),
				}
			);
	
			if (!response.ok) throw new Error("Request failed");
	
			// ✅ FIX: Ensure the final alcohol state is correctly stored in localStorage
			localStorage.setItem(
				"results",
				JSON.stringify({
					temperature: state.temperatureData.temperature,
					alcohol: state.alcoholData.alcoholLevel, // Ensures correct final alcohol state is saved
				})
			);
	
			navigate("/complete-authentication", { state: { success: true } });
		} catch (error) {
			console.error("Submission error:", error);
			refs.isSubmitting = false;
		}
	}, [state, navigate, refs, updateState]);
	

	return {
		...state,
		secondsLeft,
		handleComplete,
		setCurrentState: (newState: React.SetStateAction<StateKey>) =>
			updateState({
				currentState:
					typeof newState === "function"
						? newState(state.currentState)
						: newState,
			}),
		
	};
};
