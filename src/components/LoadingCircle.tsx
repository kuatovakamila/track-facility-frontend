import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Icon } from "@phosphor-icons/react";
import { LoadingSpinner } from "./LoadingSpinner";

const circleVariants = {
	visible: (progress: number) => ({
		pathLength: progress / 100,
		opacity: 1,
		transition: {
			pathLength: {
				type: "spring",
				stiffness: 100,
				damping: 20,
				duration: 1,
			},
			opacity: { duration: 0.3 },
		},
	}),
};

type LoadingCircleProps = {
	icon: Icon;
	value: string | number | null;
	unit: string;
	progress: number;
	onComplete: () => void;
	isAlcohol?: boolean;
	hasReceivedFinalState?: boolean; // ✅ Detect if alcohol state has been received
};

export const LoadingCircle = ({
	icon: Icon,
	value,
	unit,
	progress,
	onComplete,
	isAlcohol = false,
	hasReceivedFinalState = true, // ✅ If false, circle stops waiting for data
}: LoadingCircleProps) => {
	const [finalValue, setFinalValue] = useState<string | number | null>(null);
	const [circleComplete, setCircleComplete] = useState(false);
	const [currentProgress, setCurrentProgress] = useState(progress);

	// ✅ Update progress, but for alcohol, stop if no final state is received
	useEffect(() => {
		if (!isAlcohol || hasReceivedFinalState) {
			setCurrentProgress(progress); // ✅ Normal update if not alcohol or final state exists
		}
	}, [progress, isAlcohol, hasReceivedFinalState]);

	// ✅ Show value immediately when received
	useEffect(() => {
		if (value && finalValue === null) {
			setFinalValue(value);
		}
	}, [value, finalValue]);

	// ✅ When progress reaches 100% AND alcohol state is confirmed, mark completion
	useEffect(() => {
		if (currentProgress >= 100 && !circleComplete && hasReceivedFinalState) {
			setCircleComplete(true);
			setTimeout(() => {
				onComplete();
			}, 1000); // ✅ Wait briefly before transitioning
		}
	}, [currentProgress, circleComplete, onComplete, hasReceivedFinalState]);

	return (
		<motion.div className="relative w-48 h-48 md:w-56 md:h-56">
			<svg className="w-full h-full" viewBox="0 0 100 100">
				<motion.circle cx="50" cy="50" r="45" fill="none" stroke="#272727" strokeWidth="5" />
				<motion.circle
					cx="50"
					cy="50"
					r="45"
					fill="none"
					stroke={hasReceivedFinalState ? "#5096FF" : "#FF4D4D"} // ✅ Turns red if waiting
					strokeWidth="5"
					variants={circleVariants}
					custom={currentProgress}
					initial={{ pathLength: 0, opacity: 0 }}
					animate="visible"
					style={{ rotate: -90 }}
				/>
			</svg>

			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<Icon weight="bold" className="w-10 h-10 md:w-12 md:h-12 mb-2" />

				{/* ✅ Show result immediately but let the animation continue */}
				{finalValue !== null ? (
					<>
						<span className="text-3xl md:text-4xl font-bold">{finalValue}</span>
						<span className="text-sm md:text-base">{unit}</span>
					</>
				) : (
					<LoadingSpinner />
				)}
			</div>
		</motion.div>
	);
};
