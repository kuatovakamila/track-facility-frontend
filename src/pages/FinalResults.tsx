import { useNavigate, useLocation } from "react-router-dom";
import { Header } from "../components/Header";
import { motion } from "framer-motion";
import { useEffect } from "react";

export default function FinalResults() {
    const navigate = useNavigate();
    const location = useLocation();

    // Retrieve data from location.state or localStorage (as a fallback)
    const storedTemperature = JSON.parse(localStorage.getItem("finalTemperature") || "null");
    const storedAlcoholLevel = JSON.parse(localStorage.getItem("finalAlcoholLevel") || "null");

    const { temperature, alcoholLevel } = location.state || {
        temperature: storedTemperature ?? "Неизвестно",
        alcoholLevel: storedAlcoholLevel ?? "Неизвестно",
    };

    useEffect(() => {
        console.log("📡 Final Results - received state:", { temperature, alcoholLevel });

        const timeout = setTimeout(() => {
            console.log("🔄 Auto-navigating to home after 7 seconds...");
            navigate("/", { replace: true });
        }, 7000);

        return () => clearTimeout(timeout);
    }, [navigate, temperature, alcoholLevel]);

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <Header />
            <motion.div className="flex-1 flex flex-col items-center justify-center p-6">
                <motion.h1 className="text-2xl font-semibold mb-6">Результаты проверки</motion.h1>

                <div className="w-full max-w-md bg-gray-900 p-6 rounded-lg shadow-md text-center">
                    <div className="mb-4">
                        <p className="text-lg text-gray-400">Температура:</p>
                        <p className="text-3xl font-bold">{temperature !== "Неизвестно" ? `${temperature}°C` : "Нет данных"}</p>
                    </div>
                    <div className="mb-4">
                        <p className="text-lg text-gray-400">Уровень алкоголя:</p>
                        <p className={`text-3xl font-bold ${alcoholLevel === "Пьяный" ? "text-red-500" : "text-green-500"}`}>
                            {alcoholLevel !== "Неизвестно" ? alcoholLevel : "Нет данных"}
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
