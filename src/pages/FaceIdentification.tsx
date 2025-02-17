import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Header } from "../components/Header";
import { VideoDisplay } from "../components/VideoDisplay";
import {
	// useDeviceCamera,
	useRaspberryCamera,
} from "../lib/hooks/useCamera";
import toast from "react-hot-toast";
import { faceRecognitionService } from "../lib/services/faceRecognitionService";
import { ERROR_MESSAGES } from "../lib/constants";

export default function FaceIdentification() {
	const [isProcessing, setIsProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [, setConsecutiveErrors] = useState(0);
	const navigate = useNavigate();

	const handleError = useCallback(
		(errorMessage: string) => {
			setError(errorMessage);
			setConsecutiveErrors((prev) => {
				const newCount = prev + 1;
				if (newCount >= 3) {
					toast.error(error, {
						duration: 3000,
						style: {
							background: "#272727",
							color: "#fff",
							borderRadius: "8px",
						},
					});
					navigate("/");
				}
				return newCount;
			});
		},
		[navigate, error],
	);

	const handleFrame = useCallback(
		async (imageData: string) => {
			if (isProcessing) return;

			try {
				setIsProcessing(true);
				const data = await faceRecognitionService.verifyFace(imageData);

				if (data.matched) {
					setConsecutiveErrors(0);
					localStorage.setItem("faceId", data.faceId!);
					navigate("/health-check");
				} else if (data.error === "No face detected in image") {
					handleError(ERROR_MESSAGES.FACE_NOT_DETECTED);
				} else {
					handleError(ERROR_MESSAGES.FACE_NOT_MATCHED);
				}
			} catch (err) {
				handleError(ERROR_MESSAGES.FACE_RECOGNITION_ERROR);
				console.error("Error verifying face:", err);
			} finally {
				setIsProcessing(false);
			}
		},
		[isProcessing, navigate, handleError],
	);

	const {
		videoRef,
		canvasRef,
		error: cameraError,
	} = useRaspberryCamera({
		onFrame: handleFrame,
	});

	const errorMessage = isProcessing
		? "Проверка..."
		: cameraError || error || "Сканируйте своё лицо для подтверждения";

	return (
		<div className="min-h-screen bg-black text-white flex flex-col">
			<Header />

			<div className="flex-1 flex flex-col items-center justify-center p-6">
				<motion.h1
					className="text-2xl font-medium mb-2"
					initial={{ opacity: 0, y: -20 }}
					animate={{ opacity: 1, y: 0 }}
				>
					Распознавание лица
				</motion.h1>

				<motion.p
					className="text-center text-gray-400 mb-8"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ delay: 0.2 }}
				>
					{errorMessage}
				</motion.p>

				<VideoDisplay
					videoRef={videoRef}
					canvasRef={canvasRef}
					isProcessing={isProcessing}
				/>
			</div>
		</div>
	);
}
