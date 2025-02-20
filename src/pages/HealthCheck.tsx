import { useEffect, useState } from "react";
import { useHealthCheck } from "../lib/hooks/useHealthCheck";
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
        secondsLeft,
        handleComplete,
        validAlcoholReceived,
    } = useHealthCheck();

    const state = STATES[currentState as "TEMPERATURE" | "ALCOHOL"];

    // Force re-render if updates are missed
    const [renderTrigger, setRenderTrigger] = useState(0);

    useEffect(() => {
        setRenderTrigger((prev) => prev + 1);
    }, [temperatureData.temperature, stabilityTime]);

    let displayValue: string | number | null = "loading";
    if (currentState === "TEMPERATURE") {
        displayValue = temperatureData?.temperature
            ? Number(temperatureData.temperature).toFixed(1)
            : "loading";
    } else if (currentState === "ALCOHOL") {
        displayValue = alcoholData?.alcoholLevel || "loading";
    }

    let progress = 0;
    if (currentState === "TEMPERATURE" && stabilityTime > 0) {
        progress = Math.min((stabilityTime / MAX_STABILITY_TIME) * 100, 100);
    } else if (currentState === "ALCOHOL") {
        progress = validAlcoholReceived ? 100 : 0;
    }

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <Header />
            <motion.div className="flex-1 flex flex-col items-center justify-center p-6">
                <AnimatePresence mode="wait">
                    <motion.div key={currentState} className="text-center">
                        <motion.h1 className="text-xl md:text-2xl font-medium mb-2">
                            {state.title}
                        </motion.h1>
                        <motion.p className="text-gray-400 mb-12">{state.subtitle}</motion.p>
                    </motion.div>
                </AnimatePresence>

                <div className="flex flex-col items-center gap-4">
                    <LoadingCircle
                        key={renderTrigger} // ✅ Forces UI re-render
                        icon={state.icon}
                        value={displayValue}
                        unit={state.unit}
                        progress={progress}
                        onComplete={handleComplete}
                    />
                    {displayValue === "loading" && (
                        <span className="text-sm text-gray-400">
                            {`Осталось ${secondsLeft} секунд`}
                        </span>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
