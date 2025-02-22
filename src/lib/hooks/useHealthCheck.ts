import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import React from "react";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
const COUNTDOWN_TIME = 15; // ✅ Countdown for each step

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
};

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

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
	const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_TIME); // ✅ Fix countdown timer
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
			setSecondsLeft(COUNTDOWN_TIME); // ✅ Reset countdown when transitioning
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
				const stabilityReached = state.stabilityTime + 1 >= MAX_STABILITY_TIME;

				updateState({
					stabilityTime: Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME),
					temperatureData: { temperature: newTemperature },
				});

				if (stabilityReached) {
					console.log("✅ Temperature stabilized! Moving to alcohol measurement...");
					handleComplete();
				}
			}
		},
		[state.currentState, state.stabilityTime, updateState, handleTimeout, handleComplete]
	);

	const listenToAlcoholData = useCallback(() => {
		const alcoholRef = ref(db, "alcohol_value");
		console.log("📡 Listening to Firebase alcohol data...");

		refs.timeout = setTimeout(() => {
			console.warn("⏳ No alcohol data received in time. Triggering timeout.");
			handleTimeout();
		}, SOCKET_TIMEOUT);

		const unsubscribe = onValue(alcoholRef, (snapshot) => {
			const data = snapshot.val();
			if (!data) {
				console.warn("⚠️ No valid alcohol data received from Firebase.");
				return;
			}

			console.log("📡 Alcohol data received from Firebase:", data);
			if (refs.alcoholMeasured) return;

			let alcoholStatus = "Не определено";
			if (data.sober === 0) alcoholStatus = "Трезвый";
			else if (data.drunk === 0) alcoholStatus = "Пьяный";

			if (alcoholStatus !== "Не определено") {
				updateState({ alcoholData: { alcoholLevel: alcoholStatus } });
				clearTimeout(refs.timeout!);
				refs.alcoholMeasured = true;
				unsubscribe();

				if (state.stabilityTime >= MAX_STABILITY_TIME) {
					console.log("🚀 Alcohol level stabilized! Executing handleComplete()");
					handleComplete();
				}
			}
		});

		return () => {
			unsubscribe();
			clearTimeout(refs.timeout!);
		};
	}, [handleComplete, handleTimeout]);

	useEffect(() => {
		if (processCompleted) return;

		refs.hasTimedOut = false;

		const socket = io("http://localhost:3001", { transports: ["websocket"], reconnection: false });

		refs.socket = socket;
		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		socket.on("temperature", handleDataEvent);

		const stabilityInterval = setInterval(() => {
			if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
				updateState({ stabilityTime: Math.max(state.stabilityTime - 1, 0) });
			}
		}, STABILITY_UPDATE_INTERVAL);

		let cleanupAlcohol: (() => void) | undefined;
		if (state.currentState === "ALCOHOL") cleanupAlcohol = listenToAlcoholData();

		return () => {
			socket.disconnect();
			clearTimeout(refs.timeout!);
			clearInterval(stabilityInterval);
			if (cleanupAlcohol) cleanupAlcohol();
		};
	}, [processCompleted, state.currentState, handleTimeout, listenToAlcoholData, updateState]);

	// ✅ **Fix: Countdown Timer**
	useEffect(() => {
		setSecondsLeft(COUNTDOWN_TIME);
		const interval = setInterval(() => {
			setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
		}, 1000);

		return () => clearInterval(interval);
	}, [state.currentState]); // ✅ Reset countdown when state changes

	return {
		...state,
		secondsLeft,
		handleComplete,
		setCurrentState: (newState: React.SetStateAction<StateKey>) =>
			updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
	};
};
