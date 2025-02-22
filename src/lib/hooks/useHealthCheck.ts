import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import React from "react";

const MAX_STABILITY_TIME = 7; // ✅ Stability time needed for full progress
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
const COUNTDOWN_TIME = 15;

const TIMEOUT_MESSAGE =
	"Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

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
	progress: number;
};

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

export const useHealthCheck = (): HealthCheckState & {
	handleComplete: () => Promise<void>;
	setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
	const navigate = useNavigate();
	const [state, setState] = useState<Omit<HealthCheckState, "secondsLeft" | "progress">>({
		currentState: "TEMPERATURE",
		stabilityTime: 0,
		temperatureData: { temperature: 0 },
		alcoholData: { alcoholLevel: "Не определено" },
	});
	const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_TIME);
	const [progress, setProgress] = useState(0); // ✅ Track progress of stabilization
	const [processCompleted, setProcessCompleted] = useState(false); 

	const refs = useRef({
		socket: null as Socket | null,
		timeout: null as NodeJS.Timeout | null,
		lastDataTime: Date.now(),
		hasTimedOut: false,
		isSubmitting: false,
		alcoholMeasured: false,
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
			style: { background: "#272727", color: "#fff", borderRadius: "8px" },
		});
		navigate("/");
	}, [navigate]);

	const handleComplete = useCallback(async () => {
		if (refs.isSubmitting) return;
		refs.isSubmitting = true;

		const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
		if (currentIndex < STATE_SEQUENCE.length - 1) {
			updateState({ currentState: STATE_SEQUENCE[currentIndex + 1], stabilityTime: 0 });
			setSecondsLeft(COUNTDOWN_TIME);
			setProgress(0); // ✅ Reset progress when moving to next step
			refs.isSubmitting = false;
			return;
		}

		console.log("🎉 Health check complete! Navigating to /complete-authentication");
		setProcessCompleted(true);

		if (refs.socket) {
			console.log("🔌 Disconnecting WebSocket...");
			refs.socket.disconnect();
			refs.socket = null;
		}

		clearTimeout(refs.timeout!);
		refs.timeout = null;
		refs.hasTimedOut = true;

		setTimeout(() => navigate("/complete-authentication", { state: { success: true } }), 100);
	}, [state.currentState, navigate, updateState]);

	const handleDataEvent = useCallback(
		(data: SensorData) => {
			if (!data) return;
			refs.lastDataTime = Date.now();
			clearTimeout(refs.timeout!);
			refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

			if (state.currentState === "TEMPERATURE" && data.temperature) {
				const newTemperature = Number(data.temperature);

				// ✅ Use functional updates to ensure the correct latest stabilityTime
				setState((prev) => {
					const newStabilityTime = Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME);
					setProgress((newStabilityTime / MAX_STABILITY_TIME) * 100); // ✅ Update progress correctly

					// ✅ If stabilized, move to next step
					if (newStabilityTime >= MAX_STABILITY_TIME) {
						console.log("✅ Temperature stabilized! Moving to alcohol measurement...");
						handleComplete();
					}

					return {
						...prev,
						stabilityTime: newStabilityTime,
						temperatureData: { temperature: newTemperature },
					};
				});
			}
		},
		[state.currentState, handleTimeout, handleComplete]
	);

	useEffect(() => {
		if (processCompleted) return;

		refs.hasTimedOut = false;

		const socket = io("http://localhost:3001", { transports: ["websocket"], reconnection: false });

		refs.socket = socket;
		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		socket.on("temperature", handleDataEvent);

		// ✅ Decrease stability time if no data arrives, reducing progress
		const stabilityInterval = setInterval(() => {
			if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
				setState((prev) => {
					const decreasedStabilityTime = Math.max(prev.stabilityTime - 1, 0);
					setProgress((decreasedStabilityTime / MAX_STABILITY_TIME) * 100); // ✅ Decrease progress

					return { ...prev, stabilityTime: decreasedStabilityTime };
				});
			}
		}, STABILITY_UPDATE_INTERVAL);

		return () => {
			socket.disconnect();
			clearTimeout(refs.timeout!);
			clearInterval(stabilityInterval);
		};
	}, [processCompleted, state.currentState, handleTimeout]);

	// ✅ **Fix: Countdown Timer**
	useEffect(() => {
		setSecondsLeft(COUNTDOWN_TIME);
		const interval = setInterval(() => {
			setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
		}, 1000);

		return () => clearInterval(interval);
	}, [state.currentState]);

	return {
		...state,
		secondsLeft,
		progress, // ✅ Return progress to be used in UI
		handleComplete,
		setCurrentState: (newState: React.SetStateAction<StateKey>) =>
			updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
	};
};
