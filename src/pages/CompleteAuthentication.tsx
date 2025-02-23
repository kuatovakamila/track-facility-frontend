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
	} = useHealthCheck();

	const state = STATES[currentState];

	let displayValue: string | number | null = "loading";
	if (currentState === "TEMPERATURE" && temperatureData?.temperature !== undefined) {
		displayValue = Number(temperatureData.temperature).toFixed(1);
	} else if (currentState === "ALCOHOL" && alcoholData?.alcoholLevel) {
		displayValue = alcoholData.alcoholLevel;
		console.log("📡 Alcohol Level Displayed:", displayValue);
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
    progress={
        alcoholData.alcoholLevel !== "Не определено"
            ? 100 // ✅ Instantly set progress to 100% when alcohol is received
            : (stabilityTime / MAX_STABILITY_TIME) * 100
    }
    onComplete={handleComplete} // ✅ handleComplete will navigate only once
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
