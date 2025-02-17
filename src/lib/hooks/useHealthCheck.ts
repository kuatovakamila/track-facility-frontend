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
	// bpm?: string;
	temperature?: string;
	alcoholLevel?: string;
};

type HealthCheckState = {
	currentState: StateKey;
	stabilityTime: number;
	// bpmData: { bpm: number };
	temperatureData: { temperature: number };
	alcoholData: { alcoholLevel: string };
	secondsLeft: number;
};

const STATE_SEQUENCE: StateKey[] = [
	// "PULSE",
	"TEMPERATURE",
	"ALCOHOL",
];

const configureSocketListeners = (
	socket: Socket,
	currentState: StateKey,
	handlers: {
		onData: (data: SensorData) => void;
		onError: () => void;
	},
) => {
	// Remove any existing listeners
	socket.removeAllListeners();
	socket.on("connect_error", handlers.onError);
	socket.on("error", handlers.onError);

	// Add only the listener for current state
	switch (currentState) {
		// case "PULSE":
		// 	socket.on("heartbeat", handlers.onData);
		// 	break;
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
	const [state, setState] = useState<Omit<HealthCheckState, "secondsLeft">>({
		currentState: "TEMPERATURE",
		stabilityTime: 0,
		// bpmData: { bpm: 0 },
		temperatureData: { temperature: 0 },
		alcoholData: { alcoholLevel: "undefined" },
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
			if (!data) return;
			refs.lastDataTime = Date.now();
			clearTimeout(refs.timeout!);
			refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

			updateState({
				stabilityTime: Math.min(
					state.stabilityTime + 1,
					MAX_STABILITY_TIME,
				),
				// bpmData:
				// 	state.currentState === "PULSE"
				// 		? { bpm: Number(data.bpm!) }
				// 		: state.bpmData,
				temperatureData:
					state.currentState === "TEMPERATURE"
						? { temperature: Number(data.temperature!) }
						: state.temperatureData,
				alcoholData:
					state.currentState === "ALCOHOL"
						? { alcoholLevel: data.alcoholLevel! }
						: state.alcoholData,
			});
		},
		[
			state.currentState,
			state.stabilityTime,
			// state.bpmData,
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
		// Reset timeout flag when state changes
		refs.hasTimedOut = false;

		const socket = io(import.meta.env.VITE_SERVER_URL, {
			transports: ["websocket"],
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
		});

		refs.socket = socket;
		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		// Setup socket listeners for current state only
		setupSocketForState(socket, state.currentState);

		const stabilityInterval = setInterval(() => {
			if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
				updateState({
					stabilityTime: Math.max(state.stabilityTime - 1, 0),
				});
			}
		}, STABILITY_UPDATE_INTERVAL);

		// Cleanup function
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
						bpmData: 0,
						// state.bpmData,
						temperatureData: state.temperatureData,
						alcoholData: state.alcoholData,
						faceId,
					}),
				},
			);

			if (!response.ok) throw new Error("Request failed");

			localStorage.setItem(
				"results",
				JSON.stringify({
					bpm: 0,
					// state.bpmData.bpm,
					temperature: state.temperatureData.temperature,
					alcohol: state.alcoholData.alcoholLevel,
				}),
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
