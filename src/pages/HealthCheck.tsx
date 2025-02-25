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

    let displayValue: string | number | null = "loading";
    if (currentState === "TEMPERATURE" && temperatureData?.temperature !== undefined) {
        displayValue = Number(temperatureData.temperature).toFixed(1);
    } else if (currentState === "ALCOHOL" && alcoholData?.alcoholLevel) {
        displayValue = alcoholData.alcoholLevel;
    }

    // 🆕 Локальный таймер для обратного отсчета
    const [countdown, setCountdown] = useState(secondsLeft);
    const [countdownStarted, setCountdownStarted] = useState(false);

    // 🆕 Начинаем обратный отсчет только когда sensorReady === true
    useEffect(() => {
        if (currentState === "ALCOHOL" && sensorReady && !countdownStarted) {
            setCountdownStarted(true);
            const timer = setInterval(() => {
                setCountdown((prev) => {
                    if (prev > 0) return prev - 1;
                    clearInterval(timer);
                    return 0;
                });
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [sensorReady, countdownStarted, currentState]);

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <Header />
            <motion.div className="flex-1 flex flex-col items-center justify-center p-6">
                <AnimatePresence mode="wait">
                    <motion.div key={currentState} className="text-center">
                        {/* Ожидание готовности сенсора перед тестом на алкоголь */}
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
                                {/* Если сенсор готов, но есть таймер, показываем обратный отсчет */}
                                {currentState === "ALCOHOL" && sensorReady && countdown > 0 ? (
                                    <motion.p className="text-lg text-yellow-400 mb-4">
                                        Осталось {countdown} секунд
                                    </motion.p>
                                ) : (
                                    <motion.p className="text-gray-400 mb-4">
                                        {currentState === "ALCOHOL" ? "Подуйте 3-4 секунды" : state.subtitle}
                                    </motion.p>
                                )}
                            </>
                        )}
                    </motion.div>
                </AnimatePresence>

                {/* Индикатор загрузки */}
                <LoadingCircle
                    key={currentState}
                    icon={state.icon}
                    value={displayValue}
                    unit={state.unit}
                    progress={
                        currentState === "TEMPERATURE"
                            ? (stabilityTime / MAX_STABILITY_TIME) * 100
                            : sensorReady && countdown === 0
                            ? (stabilityTime / MAX_STABILITY_TIME) * 100
                            : 0 // Не начинать индикатор, пока сенсор не готов и таймер не завершился
                    }
                    onComplete={handleComplete}
                />
            </motion.div>
        </div>
    );
}
