import { useEffect } from "react";
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
};

export const LoadingCircle = ({
	icon: Icon,
	value,
	unit,
	progress,
	onComplete,
}: LoadingCircleProps) => {
	useEffect(() => {
		if (progress >= 100) {
			setTimeout(onComplete, 500);
		}
	}, [progress, onComplete]);

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
				<Icon
					weight="bold"
					className="w-10 h-10 md:w-12 md:h-12 mb-2"
				/>
				{typeof value === "number" ? (
					<>
						<span className="text-3xl md:text-4xl font-bold">
							{value}
						</span>
						<span className="text-sm md:text-base">{unit}</span>
					</>
				) : (
					<LoadingSpinner />
				)}
			</div>
		</motion.div>
	);
};
