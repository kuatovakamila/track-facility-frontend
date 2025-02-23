import { useLocation } from "react-router-dom";
import { Header } from "../components/Header";
import { motion } from "framer-motion";

export default function FinalResults() {
    const location = useLocation();


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

               
            </motion.div>
        </div>
    );
}
