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

    // ✅ Реалтайм-обновление значения (температура + алкоголь)
    const displayValue =
        currentState === "TEMPERATURE" && temperatureData.temperature !== undefined
            ? Number(temperatureData.temperature).toFixed(1) + "°C"
            : currentState === "ALCOHOL" && alcoholData?.alcoholLevel
            ? alcoholData.alcoholLevel
            : "Нет данных";

    // ✅ Логи для отладки данных
    useEffect(() => {
        console.log("🌡️ Температура обновлена:", temperatureData.temperature);
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
                                    Пожалуйста не дуйте, подождите прогрев датчика...
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

                {/* ✅ Центрируем температуру внутри LoadingCircle, ЧУТЬ НИЖЕ ИКОНКИ */}
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
                    {/* ✅ Температура чуть ниже иконки */}
                    <motion.p
                        className="absolute bottom-2 md:bottom-4 text-sm md:text-base font-medium text-white"
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
