import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000; // ✅ NOW USED
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

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"]; // ✅ NOW USED

export const useHealthCheck = (): HealthCheckState & {
	handleComplete: () => Promise<void>;
	setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
	const navigate = useNavigate();
	const [state, setState] = useState<HealthCheckState>({
		currentState: STATE_SEQUENCE[0], // ✅ Start at first step
		stabilityTime: 0,
		temperatureData: { temperature: 0 },
		alcoholData: { alcoholLevel: "Не определено" },
		secondsLeft: COUNTDOWN_TIME,
		progress: 0,
	});

	/** ✅ FIX: Declare `hasTimedOut` in `refs` */
	const refs = useRef({
		socket: null as Socket | null,
		timeout: null as NodeJS.Timeout | null,
		lastDataTime: Date.now(),
		stopAll: false,
		hasTimedOut: false,
		stabilityInterval: null as NodeJS.Timeout | null, // ✅ NEW: Stability interval
	}).current;

	const updateState = useCallback(
		<K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
			setState((prev) => ({ ...prev, ...updates }));
		},
		[]
	);

	const handleTimeout = useCallback(() => {
		if (refs.stopAll || refs.hasTimedOut) return;
		refs.hasTimedOut = true;

		toast.error(TIMEOUT_MESSAGE, {
			duration: 3000,
			style: { background: "#272727", color: "#fff", borderRadius: "8px" },
		});
		navigate("/");
	}, [navigate]);

	const handleComplete = useCallback(async () => {
		if (refs.stopAll) return;
		refs.stopAll = true;

		console.log("🎉 Health check complete! Navigating to /complete-authentication");

		if (refs.socket) {
			console.log("🔌 Disconnecting WebSocket...");
			refs.socket.disconnect();
			refs.socket = null;
		}

		clearTimeout(refs.timeout!);
		refs.timeout = null;

		setTimeout(() => navigate("/complete-authentication", { state: { success: true } }), 100);
	}, [navigate]);

	const handleDataEvent = useCallback(
		(data: SensorData) => {
			if (!data || refs.stopAll) return;

			refs.lastDataTime = Date.now();
			clearTimeout(refs.timeout!);
			refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

			if (state.currentState === "TEMPERATURE" && data.temperature) {
				const newTemperature = Number(data.temperature);

				setState((prev) => {
					const newStabilityTime = Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME);
					const newProgress = (newStabilityTime / MAX_STABILITY_TIME) * 100;

					if (newStabilityTime >= MAX_STABILITY_TIME) {
						console.log("✅ Temperature stabilized! Moving to next state...");
						const nextStateIndex = STATE_SEQUENCE.indexOf(prev.currentState) + 1;
						if (nextStateIndex < STATE_SEQUENCE.length) {
							updateState({ currentState: STATE_SEQUENCE[nextStateIndex], stabilityTime: 0, progress: 0 });
						} else {
							handleComplete();
						}
					}

					return {
						...prev,
						stabilityTime: newStabilityTime,
						temperatureData: { temperature: newTemperature },
						progress: newProgress,
					};
				});
			}
		},
		[state.currentState, handleTimeout, updateState]
	);

	const listenToAlcoholData = useCallback(() => {
		if (refs.stopAll) return;

		const alcoholRef = ref(db, "alcohol_value");
		console.log("📡 Listening to Firebase alcohol data...");

		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		const unsubscribe = onValue(alcoholRef, (snapshot) => {
			if (refs.stopAll) return;

			const data = snapshot.val();
			if (!data) {
				console.warn("⚠️ No alcohol data received from Firebase.");
				return;
			}

			console.log("📡 Alcohol data received from Firebase:", data);

			let alcoholStatus = "Не определено";
			if (data.sober === 0) alcoholStatus = "Трезвый";
			else if (data.drunk === 0) alcoholStatus = "Пьяный";

			if (alcoholStatus !== "Не определено") {
				console.log("✅ Final alcohol status detected:", alcoholStatus);

				setState((prev) => ({
					...prev,
					alcoholData: { alcoholLevel: alcoholStatus },
				}));

				clearTimeout(refs.timeout!);
				unsubscribe();
                navigate("/complete-authentication", { state: { success: true } })

				// console.log("🚀 Executing handleComplete()");
				// handleComplete();
			}
		});

		return () => {
			console.log("❌ Stopping alcohol listener.");
			unsubscribe();
			clearTimeout(refs.timeout!);
		};
	}, [handleComplete, handleTimeout]);

	/** ✅ FIX: Use `STABILITY_UPDATE_INTERVAL` */
	useEffect(() => {
		refs.stabilityInterval = setInterval(() => {
			if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
				setState((prev) => {
					const decreasedStabilityTime = Math.max(prev.stabilityTime - 1, 0);
					return { ...prev, stabilityTime: decreasedStabilityTime };
				});
			}
		}, STABILITY_UPDATE_INTERVAL);

		return () => clearInterval(refs.stabilityInterval!);
	}, []);

	useEffect(() => {
		if (state.currentState === "ALCOHOL") {
			const cleanupAlcohol = listenToAlcoholData();
			return () => {
				if (cleanupAlcohol) cleanupAlcohol();
			};
		}
	}, [state.currentState, listenToAlcoholData]);

	useEffect(() => {
		if (refs.stopAll) return;

		refs.hasTimedOut = false;

		const socket = io("http://localhost:3001", { transports: ["websocket"], reconnection: false });

		refs.socket = socket;
		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		socket.on("temperature", handleDataEvent);

		return () => {
			console.log("🛑 Cleanup: Disconnecting WebSocket...");
			socket.disconnect();
			clearTimeout(refs.timeout!);
		};
	}, [state.currentState, handleTimeout]);

	return {
		...state,
		handleComplete,
		setCurrentState: (newState: React.SetStateAction<StateKey>) =>
			updateState({
				currentState: typeof newState === "function" ? newState(state.currentState) : newState,
			}),
	};
};
