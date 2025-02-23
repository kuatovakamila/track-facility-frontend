import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Header } from "../components/Header";
import { VideoDisplay } from "../components/VideoDisplay";
import { useCamera } from "../lib/hooks/useCamera";
import toast from "react-hot-toast";
import { faceRecognitionService } from "../lib/services/faceRecognitionService";
import { ERROR_MESSAGES } from "../lib/constants";
import { FaRegSmileBeam, FaRegTimesCircle, FaFingerprint } from "react-icons/fa"; // Icons

export default function FaceIdentification() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [consecutiveErrors, setConsecutiveErrors] = useState(0);
    const navigate = useNavigate();

    /** 📌 Handle Errors */
    const handleError = useCallback(
        (errorMessage: string) => {
            setError(errorMessage);
            setConsecutiveErrors((prev) => {
                const newCount = prev + 1;
                if (newCount >= 3) {
                    toast.error(`Error: ${errorMessage}`, {
                        duration: 3000,
                        style: { background: "#272727", color: "#fff", borderRadius: "8px" },
                    });

                    setTimeout(() => navigate("/"), 1500); // Delay before exit
                }
                return newCount;
            });
        },
        [navigate]
    );

    /** 📌 Process Camera Frames */
    const handleFrame = useCallback(
        async (imageData: string) => {
            if (isProcessing) return;

            setIsProcessing(true);
            try {
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
                console.error("Error verifying face:", err);
                handleError(ERROR_MESSAGES.FACE_RECOGNITION_ERROR);
            } finally {
                setIsProcessing(false);
            }
        },
        [isProcessing, navigate, handleError]
    );

    /** 📌 Initialize Camera Hook */
    const { videoRef, canvasRef, error: cameraError, loading } = useCamera({
        onFrame: handleFrame,
    });

    /** 📌 Reset errors on mount */
    useEffect(() => {
        setError(null);
        setConsecutiveErrors(0);
    }, []);

    /** 📌 Dynamic Messages */
    const errorMessage = loading
        ? "📷 Connecting to camera..."
        : isProcessing
        ? "🔍 Verifying..."
        : cameraError || error || "📸 Scan your face to continue";

    /** 📌 Dynamic Face ID Icon */
    const renderStatusIcon = () => {
        if (loading) return <FaFingerprint className="text-blue-400 text-6xl animate-pulse" />;
        if (isProcessing) return <FaFingerprint className="text-yellow-400 text-6xl animate-spin" />;
        if (error || cameraError) return <FaRegTimesCircle className="text-red-500 text-6xl" />;
        return <FaRegSmileBeam className="text-green-500 text-6xl" />;
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 relative">
            <Header />

            {/* ✅ Face ID Glow Effect */}
            <motion.div
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1 }}
            >
                <div className="absolute w-[250px] h-[250px] border-4 border-green-500/50 rounded-2xl shadow-[0_0_30px_rgba(34,197,94,0.5)] animate-pulse" />
            </motion.div>

            <motion.h1
                className="text-3xl font-medium mb-4 relative z-10"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                🏆 Face Identification
            </motion.h1>

            {/* ✅ Animated Face ID Icon */}
            <motion.div
                className="mb-4 relative z-10"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
            >
                {renderStatusIcon()}
            </motion.div>

            {/* ✅ Status Message */}
            <motion.p
                className={`text-center text-gray-400 mb-8 text-lg ${isProcessing ? "text-yellow-400" : ""}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
            >
                {errorMessage}
            </motion.p>

            {/* ❗️ Warning for multiple errors */}
            {consecutiveErrors >= 2 && (
                <motion.p
                    className="text-center text-red-500 mb-6 text-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                >
                    ⚠️ Multiple errors detected. Try changing your lighting or position.
                </motion.p>
            )}

            <VideoDisplay videoRef={videoRef} canvasRef={canvasRef} isProcessing={isProcessing} />
        </div>
    );
}
