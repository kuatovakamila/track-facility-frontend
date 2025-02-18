
		
		import { useState, useEffect, useCallback, useRef } from "react";
		import { useNavigate } from "react-router-dom";
		import { io, type Socket } from "socket.io-client";
		import { StateKey } from "../constants";
		import toast from "react-hot-toast";
		
		// Константы
		const MAX_STABILITY_TIME = 7;
		const SOCKET_TIMEOUT = 15000;
		const STABILITY_UPDATE_INTERVAL = 1000;
		const TIMEOUT_MESSAGE =
			"Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";
		
		// Определение типов данных сенсоров
		type SensorData = {
			temperature?: string;
			sober?: number;
			drunk?: number;
			power?: number;
			ready?: number;
			relay?: number;
		};
		
		// Тип состояния хука useHealthCheck
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
				alcoholData: { alcoholLevel: "Ожидание..." },
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
		
			// ✅ Обновленный WebSocket подписчик
			const configureSocketListeners = useCallback(
				(socket: Socket, currentState: StateKey) => {
					socket.removeAllListeners();
					socket.on("connect_error", () => {
						toast.error("Ошибка соединения с сервером");
					});
		
					switch (currentState) {
						case "TEMPERATURE":
							socket.on("temperature", (data) => {
								console.log("📡 Температурные данные:", data);
								handleDataEvent(data);
							});
							break;
						case "ALCOHOL":
							socket.on("alcohol", (data) => {
								console.log("📡 Данные алкоголя:", data);
								handleDataEvent(data);
							});
							break;
					}
				},
				[]
			);
		
			// ✅ Гарантированное обновление final state для алкоголя
			const handleDataEvent = useCallback(
				(data: SensorData) => {
					if (!data) return;
					refs.lastDataTime = Date.now();
					clearTimeout(refs.timeout!);
					refs.timeout = setTimeout(() => navigate("/"), SOCKET_TIMEOUT);
		
					const temperatureValue =
						data.temperature !== undefined ? Number(data.temperature) : state.temperatureData.temperature;
		
					// 🔹 Проверяем, есть ли финальный статус
					let alcoholStatus = state.alcoholData.alcoholLevel;
					if (data.sober === 0) {
						alcoholStatus = "Трезвый";
					} else if (data.drunk === 0) {
						alcoholStatus = "Пьяный";
					} else {
						console.log("⏳ Ожидание точного статуса алкоголя...");
						return;
					}
		
					// ✅ Сохраняем финальный статус алкоголя
					localStorage.setItem(
						"alcoholFinalState",
						JSON.stringify({ alcoholLevel: alcoholStatus })
					);
		
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
		
					console.log("✅ Сохраненный финальный статус алкоголя:", alcoholStatus);
				},
				[state, updateState, navigate]
			);
		
			useEffect(() => {
				console.log("🔗 Подключение к WebSocket:", import.meta.env.VITE_SERVER_URL);
		
				refs.hasTimedOut = false;
				const socket = io(import.meta.env.VITE_SERVER_URL, {
					transports: ["websocket"],
					reconnection: true,
					reconnectionAttempts: 5,
					reconnectionDelay: 1000,
				});
		
				refs.socket = socket;
				refs.timeout = setTimeout(() => navigate("/"), SOCKET_TIMEOUT);
		
				socket.on("connect", () => {
					console.log("✅ WebSocket подключен!");
				});
		
				socket.on("disconnect", () => {
					console.log("❌ WebSocket отключен!");
				});
		
				configureSocketListeners(socket, state.currentState);
		
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
				configureSocketListeners,
				updateState,
				navigate,
			]);
		
			// ✅ Используем сохраненное значение алкоголя в handleComplete
			const handleComplete = useCallback(async () => {
				if (refs.isSubmitting) return;
				refs.isSubmitting = true;
		
				const alcoholFinalState = JSON.parse(localStorage.getItem("alcoholFinalState") || "{}");
		
				localStorage.setItem(
					"results",
					JSON.stringify({
						temperature: state.temperatureData.temperature,
						alcohol: alcoholFinalState.alcoholLevel || "Ошибка",
					}),
				);
		
				console.log("✅ Финальное состояние:", {
					temperature: state.temperatureData.temperature,
					alcohol: alcoholFinalState.alcoholLevel || "Ошибка",
				});
		
				navigate("/complete-authentication", { state: { success: true } });
			}, [state, navigate]);
		
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
		
	