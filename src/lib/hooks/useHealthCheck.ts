import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
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

	if (currentState === "TEMPERATURE") {
		socket.on("temperature", handlers.onData);
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

			updateState({
				stabilityTime: Math.min(
					state.stabilityTime + 1,
					MAX_STABILITY_TIME
				),
				temperatureData:
					state.currentState === "TEMPERATURE"
						? { temperature: Number(data.temperature!) }
						: state.temperatureData,
			});
		},
		[
			state.currentState,
			state.stabilityTime,
			state.temperatureData,
			updateState,
			handleTimeout,
		]
	);

	const setupSocketForState = useCallback(
		(socket: Socket, currentState: StateKey) => {
			configureSocketListeners(socket, currentState, {
				onData: handleDataEvent,
				onError: handleTimeout,
			});
		},
		[handleDataEvent, handleTimeout]
	);

	// ✅ Handle when alcohol test completes
	const handleComplete = useCallback(async () => {
		if (refs.isSubmitting) return;
		refs.isSubmitting = true;

		if (state.currentState === "ALCOHOL") {
			console.log("🚀 Alcohol test complete. Navigating to authentication...");
			navigate("/complete-authentication", { state: { success: true } });
			return;
		}

		const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
		if (currentIndex < STATE_SEQUENCE.length - 1) {
			updateState({
				currentState: STATE_SEQUENCE[currentIndex + 1],
				stabilityTime: 0,
			});
			refs.isSubmitting = false;
			return;
		}
	}, [state, navigate, updateState]);

	// ✅ Listen to alcohol data properly
	const listenToAlcoholData = useCallback(() => {
		const alcoholRef = ref(db, "alcohol_value");
		console.log("📡 Listening to Firebase alcohol data...");

		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		const unsubscribe = onValue(alcoholRef, async (snapshot) => {
			const data = snapshot.val();
			if (!data) return;

			let alcoholStatus = "Не определено";
			if (data.sober === 0) alcoholStatus = "Трезвый";
			else if (data.drunk === 0) alcoholStatus = "Пьяный";

			if (alcoholStatus !== "Не определено") {
				console.log("✅ Final alcohol status detected:", alcoholStatus);
				refs.alcoholMeasured = true;
				
				updateState({
					alcoholData: { alcoholLevel: alcoholStatus },
				});

				clearTimeout(refs.timeout!);
				unsubscribe();

				console.log("🚀 Triggering handleComplete()");
				await handleComplete();
			}
		});

		return () => {
			console.log("❌ Stopping alcohol listener.");
			unsubscribe();
			clearTimeout(refs.timeout!);
		};
	}, [handleComplete, handleTimeout]);

	useEffect(() => {
		refs.hasTimedOut = false;

		const socket = io("http://localhost:3001", {
			transports: ["websocket"],
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
		});

		refs.socket = socket;
		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		setupSocketForState(socket, state.currentState);

		// ✅ Progress Bar Fix: Ensure stabilityTime increases
		const stabilityInterval = setInterval(() => {
			if (state.stabilityTime < MAX_STABILITY_TIME) {
				updateState({
					stabilityTime: state.stabilityTime + 1,
				});
			}
		}, STABILITY_UPDATE_INTERVAL);

		let cleanupAlcohol: (() => void) | undefined;
		if (state.currentState === "ALCOHOL") {
			cleanupAlcohol = listenToAlcoholData();
		}

		return () => {
			socket.disconnect();
			clearTimeout(refs.timeout!);
			clearInterval(stabilityInterval);
			if (cleanupAlcohol) cleanupAlcohol();
		};
	}, [
		state.currentState,
		state.stabilityTime,
		handleTimeout,
		handleDataEvent,
		setupSocketForState,
		listenToAlcoholData,
		updateState,
	]);

	useEffect(() => {
		setSecondsLeft(15);
		const interval = setInterval(() => {
			setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
		}, 1000);
		return () => clearInterval(interval);
	}, [state.currentState]);

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
