import { motion } from "framer-motion";

export const LoadingSpinner = () => {
	return (
		<div className="flex flex-col items-center gap-2 pt-4">
			<motion.div
				className="w-6 h-6 border-2 border-[#5096FF] border-t-transparent rounded-full"
				animate={{ rotate: 360 }}
				transition={{
					duration: 1,
					repeat: Infinity,
					ease: "linear",
				}}
			/>
		</div>
	);
};
