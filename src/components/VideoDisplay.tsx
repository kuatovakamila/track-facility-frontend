import { forwardRef } from "react";
import { motion } from "framer-motion";

interface VideoDisplayProps {
	isProcessing: boolean;
	videoRef: React.RefObject<HTMLVideoElement>;
	canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const VideoDisplay = forwardRef<HTMLVideoElement, VideoDisplayProps>(
	({ isProcessing, videoRef, canvasRef }) => {
		return (
			<motion.div
				className="w-full aspect-[3/4] max-w-md border-2 border-[#5096FF] rounded-3xl overflow-hidden relative"
				initial={{ scale: 0.9, opacity: 0 }}
				animate={{ scale: 1, opacity: 1 }}
				transition={{ delay: 0.3 }}
			>
				<video
					ref={videoRef}
					className="w-full h-full object-cover"
					autoPlay
					playsInline
					muted
				/>
				<canvas ref={canvasRef} className="hidden" />
				{isProcessing && (
					<div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
						<div className="w-8 h-8 border-t-2 border-[#5096FF] rounded-full animate-spin" />
					</div>
				)}
			</motion.div>
		);
	},
);
