import { useHealthCheck } from "../lib/hooks/useHealthCheck";
import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { LoadingCircle } from "../components/LoadingCircle";
import { STATES } from "../lib/constants";
import { motion, AnimatePresence } from "framer-motion";

const MAX_STABILITY_TIME = 7;

export default function HealthCheck() {
    const {
        currentState,
        stabilityTime,
        temperatureData,
        alcoholData,
        sensorReady,
        secondsLeft,
        handleComplete,
    } = useHealthCheck();

    const state = STATES[currentState];

    // ✅ Отображаемое значение (в реальном времени)
    const [displayValue, setDisplayValue] = useState<string | number>("loading");

    useEffect(() => {
        if (currentState === "TEMPERATURE" && temperatureData.temperature !== undefined) {
            setDisplayValue(Number(temperatureData.temperature).toFixed(1) + "°C");
        } else if (currentState === "ALCOHOL" && alcoholData?.alcoholLevel) {
            setDisplayValue(alcoholData.alcoholLevel);
        }
    }, [temperatureData.temperature, alcoholData.alcoholLevel, currentState]);

    // ✅ Логи для отладки данных
    useEffect(() => {
        console.log("🌡️ UI обновил температуру:", temperatureData.temperature);
        console.log("🍷 Alcohol Level:", alcoholData.alcoholLevel);
        console.log("🚦 Sensor Ready:", sensorReady);
    }, [temperatureData.temperature, alcoholData.alcoholLevel, sensorReady]);

    // 🆕 Локальный таймер для обратного отсчета
    const [countdown, setCountdown] = useState(secondsLeft);
    const [countdownStarted, setCountdownStarted] = useState(false);

    useEffect(() => {
        if (currentState === "ALCOHOL" && sensorReady && !countdownStarted) {
            setCountdownStarted(true);
            setCountdown(secondsLeft);

            const timer = setInterval(() => {
                setCountdown((prev) => {
                    if (prev > 0) return prev - 1;
                    clearInterval(timer);
                    return 0;
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [sensorReady, countdownStarted, currentState, secondsLeft]);

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <Header />
            <motion.div className="flex-1 flex flex-col items-center justify-center p-6">
                <AnimatePresence mode="wait">
                    <motion.div key={currentState} className="text-center">
                        {currentState === "ALCOHOL" && !sensorReady ? (
                            <>
                                <motion.h1 className="text-xl md:text-2xl font-medium mb-2">
                                    Ожидание сенсора...
                                </motion.h1>
                                <motion.p className="text-gray-400 mb-12">
                                    Пожалуйста, подождите...
                                </motion.p>
                            </>
                        ) : (
                            <>
                                <motion.h1 className="text-xl md:text-2xl font-medium mb-2">
                                    {state.title}
                                </motion.h1>

                                {currentState === "ALCOHOL" && sensorReady && countdown > 0 ? (
                                    <motion.p className="text-lg text-yellow-400 mb-4">
                                        Осталось {countdown} секунд
                                    </motion.p>
                                ) : (
                                    <motion.p className="text-gray-400 mb-4">
                                        {currentState === "ALCOHOL"
                                            ? "Подуйте 3-4 секунды"
                                            : state.subtitle}
                                    </motion.p>
                                )}
                            </>
                        )}
                    </motion.div>
                </AnimatePresence>

                {/* ✅ Центрируем температуру внутри LoadingCircle */}
                <div className="relative flex items-center justify-center">
                    <LoadingCircle
                        key={currentState}
                        icon={state.icon}
                        value={displayValue}
                        unit={state.unit}
                        progress={
                            currentState === "TEMPERATURE" && temperatureData.temperature !== undefined
                                ? (stabilityTime / MAX_STABILITY_TIME) * 100
                                : currentState === "ALCOHOL" && alcoholData.alcoholLevel !== "Не определено"
                                ? 100
                                : 0
                        }
                        onComplete={handleComplete}
                    />
                    {/* ТЕМПЕРАТУРА БОЛЬШИМИ БУКВАМИ, ПО ЦЕНТРУ */}
                    <motion.p
                        className="absolute text-3xl md:text-5xl font-semibold text-white"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        {displayValue}
                    </motion.p>
                </div>
            </motion.div>
        </div>
    );
}
