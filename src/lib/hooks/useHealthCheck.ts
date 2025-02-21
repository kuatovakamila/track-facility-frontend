import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { ref, onValue, off } from "firebase/database";
import { db } from "./firebase";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
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

			const newStabilityTime = Math.min(state.stabilityTime + 1, MAX_STABILITY_TIME);

			updateState({
				stabilityTime: newStabilityTime,
				temperatureData:
					state.currentState === "TEMPERATURE"
						? { temperature: Number(data.temperature!) }
						: state.temperatureData,
			});

			// ✅ If temperature stabilizes, move to the next step (Alcohol)
			if (
				state.currentState === "TEMPERATURE" &&
				newStabilityTime >= MAX_STABILITY_TIME
			) {
				setTimeout(() => {
					const nextIndex = STATE_SEQUENCE.indexOf(state.currentState) + 1;
					if (nextIndex < STATE_SEQUENCE.length) {
						updateState({ currentState: STATE_SEQUENCE[nextIndex], stabilityTime: 0 });
					}
				}, 500);
			}
		},
		[state.currentState, state.stabilityTime, state.temperatureData, updateState, handleTimeout]
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

	const listenToAlcoholData = useCallback(() => {
		const alcoholRef = ref(db, "alcohol_value");
		console.log("📡 Listening to Firebase alcohol data...");

		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		const unsubscribe = onValue(alcoholRef, (snapshot) => {
			const data = snapshot.val();
			if (!data) {
				console.warn("⚠️ No alcohol data received from Firebase.");
				return;
			}

			console.log("📡 Alcohol data received from Firebase:", data);

			let alcoholStatus = "Не определено";
			if (data.sober === 0) alcoholStatus = "Трезвый";
			else if (data.drunk === 0) alcoholStatus = "Пьяный";

			updateState({
				alcoholData: { alcoholLevel: alcoholStatus },
			});

			clearTimeout(refs.timeout!);

			// ✅ After alcohol measurement, call handleComplete
			if (!refs.alcoholMeasured && (data.sober === 0 || data.drunk === 0)) {
				refs.alcoholMeasured = true;
				console.log("✅ Alcohol measurement finalized. Proceeding to completion...");
				setTimeout(handleComplete, 500);
			}
		});

		return () => {
			console.log("❌ Stopping alcohol listener.");
			off(alcoholRef, "value", unsubscribe);
			clearTimeout(refs.timeout!);
		};
	}, [handleTimeout]);

	useEffect(() => {
		refs.hasTimedOut = false;

		const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
			transports: ["websocket"],
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
		});

		refs.socket = socket;
		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

		setupSocketForState(socket, state.currentState);

		const stabilityInterval = setInterval(() => {
			if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
				updateState({
					stabilityTime: Math.max(state.stabilityTime - 1, 0),
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

	const handleComplete = useCallback(async () => {
		if (refs.isSubmitting) return;
		refs.isSubmitting = true;
		navigate("/complete-authentication", { state: { success: true } });
	}, [navigate]);

	return {
		...state,
		secondsLeft,
		handleComplete,
		setCurrentState: (newState) =>
			updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
	};
};

// import { useState, useEffect, useCallback, useRef } from "react";
// import { useNavigate } from "react-router-dom";
// import { io, type Socket } from "socket.io-client";
// import { ref, onValue, off } from "firebase/database"; // ✅ Firebase functions
// import { db } from "./firebase"; // ✅ Import Firebase instance
// import { StateKey } from "../constants";
// import toast from "react-hot-toast";

// // Constants
// const MAX_STABILITY_TIME = 7;
// const SOCKET_TIMEOUT = 15000;
// const STABILITY_UPDATE_INTERVAL = 1000;
// const TIMEOUT_MESSAGE =
// 	"Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// type SensorData = {
// 	temperature?: string;
// 	alcoholLevel?: string;
// };

// type HealthCheckState = {
// 	currentState: StateKey;
// 	stabilityTime: number;
// 	temperatureData: { temperature: number };
// 	alcoholData: { alcoholLevel: string };
// 	secondsLeft: number;
// };

// const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

// const configureSocketListeners = (
// 	socket: Socket,
// 	currentState: StateKey,
// 	handlers: {
// 		onData: (data: SensorData) => void;
// 		onError: () => void;
// 	},
// ) => {
// 	socket.removeAllListeners();
// 	socket.on("connect_error", handlers.onError);
// 	socket.on("error", handlers.onError);

// 	switch (currentState) {
// 		case "TEMPERATURE":
// 			socket.on("temperature", handlers.onData);
// 			break;
// 	}
// };

// export const useHealthCheck = (): HealthCheckState & {
// 	handleComplete: () => Promise<void>;
// 	setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
// } => {
// 	const navigate = useNavigate();
// 	const [state, setState] = useState<Omit<HealthCheckState, "secondsLeft">>({
// 		currentState: "TEMPERATURE",
// 		stabilityTime: 0,
// 		temperatureData: { temperature: 0 },
// 		alcoholData: { alcoholLevel: "Не определено" },
// 	});
// 	const [secondsLeft, setSecondsLeft] = useState(15);

// 	const refs = useRef({
// 		socket: null as Socket | null,
// 		timeout: null as NodeJS.Timeout | null,
// 		lastDataTime: Date.now(),
// 		hasTimedOut: false,
// 		isSubmitting: false,
// 		alcoholMeasured: false, // ✅ Prevents re-navigation after the first measurement
// 	}).current;

// 	const updateState = useCallback(
// 		<K extends keyof HealthCheckState>(
// 			updates: Pick<HealthCheckState, K>,
// 		) => {
// 			setState((prev) => ({ ...prev, ...updates }));
// 		},
// 		[],
// 	);

// 	const handleTimeout = useCallback(() => {
// 		if (refs.hasTimedOut) return;

// 		refs.hasTimedOut = true;
// 		toast.error(TIMEOUT_MESSAGE, {
// 			duration: 3000,
// 			style: {
// 				background: "#272727",
// 				color: "#fff",
// 				borderRadius: "8px",
// 			},
// 		});
// 		navigate("/");
// 	}, [navigate]);

// 	const handleDataEvent = useCallback(
// 		(data: SensorData) => {
// 			if (!data) return;
// 			refs.lastDataTime = Date.now();
// 			clearTimeout(refs.timeout!);
// 			refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

// 			updateState({
// 				stabilityTime: Math.min(
// 					state.stabilityTime + 1,
// 					MAX_STABILITY_TIME,
// 				),
// 				temperatureData:
// 					state.currentState === "TEMPERATURE"
// 						? { temperature: Number(data.temperature!) }
// 						: state.temperatureData,
// 			});
// 		},
// 		[state.currentState, state.stabilityTime, state.temperatureData, updateState, handleTimeout],
// 	);

// 	const setupSocketForState = useCallback(
// 		(socket: Socket, currentState: StateKey) => {
// 			configureSocketListeners(socket, currentState, {
// 				onData: handleDataEvent,
// 				onError: handleTimeout,
// 			});
// 		},
// 		[handleDataEvent, handleTimeout],
// 	);

// 	// ✅ Use Firebase for Alcohol Data Instead of WebSockets
// 	const listenToAlcoholData = useCallback(() => {
// 		const alcoholRef = ref(db, "alcohol_value");
// 		console.log("📡 Listening to Firebase alcohol data...");

// 		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

// 		const unsubscribe = onValue(alcoholRef, (snapshot) => {
// 			const data = snapshot.val();
// 			if (!data) {
// 				console.warn("⚠️ No alcohol data received from Firebase.");
// 				return;
// 			}

// 			console.log("📡 Alcohol data received from Firebase:", data);

// 			let alcoholStatus = "Не определено";
// 			if (data.sober === 0) alcoholStatus = "Трезвый";
// 			else if (data.drunk === 0) alcoholStatus = "Пьяный";

// 			updateState({
// 				alcoholData: { alcoholLevel: alcoholStatus },
// 			});

// 			clearTimeout(refs.timeout!);

// 			// ✅ Prevents re-navigation after first valid alcohol data
// 			if (!refs.alcoholMeasured && (data.sober === 0 || data.drunk === 0)) {
// 				refs.alcoholMeasured = true;
// 				console.log("✅ Alcohol measurement finalized. Navigating...");
// 				setTimeout(() => {
// 					navigate("/complete-authentication");
// 				}, 500);
// 			}
// 		});

// 		return () => {
// 			console.log("❌ Stopping alcohol listener.");
// 			off(alcoholRef, "value", unsubscribe);
// 			clearTimeout(refs.timeout!);
// 		};
// 	}, [navigate, handleTimeout]);

// 	useEffect(() => {
// 		refs.hasTimedOut = false;

// 		const socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001', {
// 			transports: ["websocket"],
// 			reconnection: true,
// 			reconnectionAttempts: 5,
// 			reconnectionDelay: 1000,
// 		});

// 		refs.socket = socket;
// 		refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

// 		setupSocketForState(socket, state.currentState);

// 		const stabilityInterval = setInterval(() => {
// 			if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
// 				updateState({
// 					stabilityTime: Math.max(state.stabilityTime - 1, 0),
// 				});
// 			}
// 		}, STABILITY_UPDATE_INTERVAL);

// 		let cleanupAlcohol: (() => void) | undefined;
// 		if (state.currentState === "ALCOHOL") {
// 			cleanupAlcohol = listenToAlcoholData();
// 		}

// 		return () => {
// 			socket.disconnect();
// 			clearTimeout(refs.timeout!);
// 			clearInterval(stabilityInterval);
// 			if (cleanupAlcohol) cleanupAlcohol();
// 		};
// 	}, [
// 		state.currentState,
// 		state.stabilityTime,
// 		handleTimeout,
// 		handleDataEvent,
// 		setupSocketForState,
// 		listenToAlcoholData,
// 		updateState,
// 	]);

// 	useEffect(() => {
// 		setSecondsLeft(15);
// 		const interval = setInterval(() => {
// 			setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
// 		}, 1000);
// 		return () => clearInterval(interval);
// 	}, [state.currentState]);

// 	const handleComplete = useCallback(async () => {
// 		if (refs.isSubmitting) return;
// 		refs.isSubmitting = true;

// 		const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
// 		if (currentIndex < STATE_SEQUENCE.length - 1) {
// 			updateState({
// 				currentState: STATE_SEQUENCE[currentIndex + 1],
// 				stabilityTime: 0,
// 			});
// 			refs.isSubmitting = false;
// 			return;
// 		}
// 		navigate("/complete-authentication", { state: { success: true } });
// 	}, [state, navigate, updateState]);

// 	return {
// 		...state,
// 		secondsLeft,
// 		handleComplete,
// 		setCurrentState: (newState: React.SetStateAction<StateKey>) =>
// 			updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
// 	};
// };