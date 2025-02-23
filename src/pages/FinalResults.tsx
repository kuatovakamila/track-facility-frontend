import { useLocation, useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { motion } from "framer-motion";

export default function FinalResults() {
    const location = useLocation();
    const navigate = useNavigate();

    // Extract data passed via navigation state
    const { temperature, alcoholLevel } = location.state || {
        temperature: "Неизвестно",
        alcoholLevel: "Неизвестно",
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <Header />
            <motion.div className="flex-1 flex flex-col items-center justify-center p-6">
                <motion.h1 className="text-2xl font-semibold mb-6">Результаты проверки</motion.h1>

                <div className="w-full max-w-md bg-gray-900 p-6 rounded-lg shadow-md text-center">
                    <div className="mb-4">
                        <p className="text-lg text-gray-400">Температура:</p>
                        <p className="text-3xl font-bold">{temperature}°C</p>
                    </div>
                    <div className="mb-4">
                        <p className="text-lg text-gray-400">Уровень алкоголя:</p>
                        <p className={`text-3xl font-bold ${alcoholLevel === "Пьяный" ? "text-red-500" : "text-green-500"}`}>
                            {alcoholLevel}
                        </p>
                    </div>
                </div>

                <div className="mt-8 flex gap-4">
                    <button
                        onClick={() => navigate("/")}
                        className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-lg transition"
                    >
                        На главную
                    </button>
                    <button
                        onClick={() => navigate("/health-check")}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg transition"
                    >
                        Повторить проверку
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
