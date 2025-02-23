import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Header } from "../components/Header";
import { VideoDisplay } from "../components/VideoDisplay";
import { useCamera } from "../lib/hooks/useCamera";
import toast from "react-hot-toast";
import { faceRecognitionService } from "../lib/services/faceRecognitionService";
import { ERROR_MESSAGES } from "../lib/constants";
import { FaRegSmileBeam, FaRegTimesCircle, FaFingerprint } from "react-icons/fa"; // ✅ Иконки Face ID

export default function FaceIdentification() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [consecutiveErrors, setConsecutiveErrors] = useState(0);
    const navigate = useNavigate();

    /** 📌 Обработка ошибок */
    const handleError = useCallback(
        (errorMessage: string) => {
            setError(errorMessage);
            setConsecutiveErrors((prev) => {
                const newCount = prev + 1;
                if (newCount >= 3) {
                    toast.error(`Ошибка: ${errorMessage}`, {
                        duration: 3000,
                        style: { background: "#272727", color: "#fff", borderRadius: "8px" },
                    });

                    setTimeout(() => navigate("/"), 1500); // ⏳ Задержка перед выходом
                }
                return newCount;
            });
        },
        [navigate]
    );

    /** 📌 Обработка видеопотока */
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

    /** 📌 Подключение камеры */
    const { videoRef, canvasRef, error: cameraError, loading } = useCamera({
        onFrame: handleFrame,
    });

    /** 📌 Сброс ошибок при монтировании */
    useEffect(() => {
        setError(null);
        setConsecutiveErrors(0);
    }, []);

    /** 📌 Динамические сообщения */
    const errorMessage = loading
        ? "📷 Подключаемся к камере..."
        : isProcessing
        ? "🔍 Проверка..."
        : cameraError || error || "📸 Сканируйте своё лицо для подтверждения";

    /** 📌 Выбор иконки в зависимости от состояния */
    const renderStatusIcon = () => {
        if (loading) return <FaFingerprint className="text-blue-400 text-6xl animate-pulse" />;
        if (isProcessing) return <FaFingerprint className="text-yellow-400 text-6xl animate-spin" />;
        if (error || cameraError) return <FaRegTimesCircle className="text-red-500 text-6xl" />;
        return <FaRegSmileBeam className="text-green-500 text-6xl" />;
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <Header />

            <div className="flex-1 flex flex-col items-center justify-center p-6">
                <motion.h1
                    className="text-2xl font-medium mb-2"
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    🏆 Распознавание лица
                </motion.h1>

                {/* ✅ Анимация Face ID */}
                <motion.div
                    className="mb-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                >
                    {renderStatusIcon()}
                </motion.div>

                <motion.p
                    className={`text-center text-gray-400 mb-8 ${isProcessing ? "text-yellow-400" : ""}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                >
                    {errorMessage}
                </motion.p>

                {/* ❗️ Показывать предупреждение при повторных ошибках */}
                {consecutiveErrors >= 2 && (
                    <motion.p
                        className="text-center text-red-500 mb-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                    >
                        ⚠️ Несколько ошибок подряд. Попробуйте изменить освещение или положение лица.
                    </motion.p>
                )}

                <VideoDisplay videoRef={videoRef} canvasRef={canvasRef} isProcessing={isProcessing} />
            </div>
        </div>
    );
}
