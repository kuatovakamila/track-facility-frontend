import { useHealthCheck } from "../lib/hooks/useHealthCheck";
import { Header } from "../components/Header";
import { LoadingCircle } from "../components/LoadingCircle";
import { STATES } from "../lib/constants";
import { motion, AnimatePresence } from "framer-motion";

const MAX_STABILITY_TIME = 7;

export default function HealthCheck() {
    const {
        currentState, // ✅ Now correctly typed
        stabilityTime,
        temperatureData,
        alcoholData,
        secondsLeft,
        handleComplete,
        validAlcoholReceived,
    } = useHealthCheck();

    const state = STATES[currentState as "TEMPERATURE" | "ALCOHOL"];

    let displayValue: string | number | null = "loading";
    if (currentState === "TEMPERATURE" && temperatureData?.temperature !== undefined) {
        displayValue = Number(temperatureData.temperature).toFixed(1);
    } else if (currentState === "ALCOHOL" && alcoholData?.alcoholLevel) {
        displayValue = alcoholData.alcoholLevel;
        console.log("📡 Alcohol Level Displayed:", displayValue);
    }

    // ✅ Fix progress bar logic
    let progress = 0;
    if (currentState === "TEMPERATURE") {
        progress = (stabilityTime / MAX_STABILITY_TIME) * 100;
    } else if (currentState === "ALCOHOL") {
        progress = validAlcoholReceived ? 100 : 0; // ✅ Only move if valid data is received
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
                        key={currentState}
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
