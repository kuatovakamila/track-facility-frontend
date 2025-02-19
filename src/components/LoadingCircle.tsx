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
	onComplete: () => void;
	isAlcohol?: boolean; // ✅ Detect if it's alcohol measurement
};

export const LoadingCircle = ({
	icon: Icon,
	value,
	unit,
	onComplete,
	isAlcohol = false, // ✅ Default is false (temperature works instantly)
}: LoadingCircleProps) => {
	const [progress, setProgress] = useState(0);
	const [finalValue, setFinalValue] = useState<string | number | null>(null);
	const [circleComplete, setCircleComplete] = useState(false);

	// ✅ Ensure the circle continues running even after the result is shown
	useEffect(() => {
		let duration = isAlcohol ? 4000 : 1000; // ✅ 4 seconds for alcohol, 1 second for temperature
		let step = isAlcohol ? 4 : 20; // ✅ Smooth transition

		const interval = setInterval(() => {
			setProgress((prev) => {
				if (prev >= 100) {
					clearInterval(interval);
					setCircleComplete(true); // ✅ Mark the circle as fully completed
					return 100;
				}
				return prev + step;
			});
		}, duration / 25); // ✅ Progress in 25 steps

		return () => clearInterval(interval);
	}, [isAlcohol]);

	// ✅ Show result immediately but wait for the full circle to complete before finishing
	useEffect(() => {
		if (value && finalValue === null) {
			setFinalValue(value);
		}

		if (circleComplete) {
			setTimeout(() => {
				onComplete();
			}, isAlcohol ? 1000 : 0); // ✅ Small delay after full circle
		}
	}, [value, finalValue, circleComplete, onComplete, isAlcohol]);

	return (
		<motion.div className="relative w-48 h-48 md:w-56 md:h-56">
			<svg className="w-full h-full" viewBox="0 0 100 100">
				<motion.circle
					cx="50"
					cy="50"
					r="45"
					fill="none"
					stroke="#272727"
					strokeWidth="5"
				/>
				<motion.circle
					cx="50"
					cy="50"
					r="45"
					fill="none"
					stroke="#5096FF"
					strokeWidth="5"
					variants={circleVariants}
					custom={progress}
					initial={{ pathLength: 0, opacity: 0 }}
					animate="visible"
					style={{ rotate: -90 }}
				/>
			</svg>

			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<Icon weight="bold" className="w-10 h-10 md:w-12 md:h-12 mb-2" />

				{/* ✅ Show the result immediately but let the animation continue */}
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
