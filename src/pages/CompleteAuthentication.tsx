import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle, Thermometer, Wine } from "@phosphor-icons/react";
import { Header } from "../components/Header";
import { useNavigate } from "react-router-dom";

export default function CompleteAuthentication() {
    const navigate = useNavigate();
    const [results, setResults] = useState({ temperature: "Не определено", alcohol: "Не определено" });

    // ✅ Load results AFTER component mounts to ensure updates
    useEffect(() => {
        const storedResults = localStorage.getItem("results");
        if (storedResults) {
            console.log("🔄 Updating results from LocalStorage:", storedResults);
            setResults(JSON.parse(storedResults));
        }
    }, []); // Ensures latest localStorage data is used

    // ✅ Prevent navigation until correct values are received
    useEffect(() => {
        if (results.alcohol !== "Не определено" && results.temperature !== "Не определено") {
            console.log("✅ Correct alcohol status received:", results.alcohol);
            const timer = setTimeout(() => {
                navigate("/");
            }, 5000);
            return () => clearTimeout(timer);
        } else {
            console.warn("⚠️ Incomplete results received, waiting for update...");
        }
    }, [navigate, results]);

    const alcoholStatus = results.alcohol;
    const temperatureValue = results.temperature;

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <Header />
            <div className="flex-1 flex flex-col items-center justify-center p-6">
                <motion.div
                    className="bg-[#272727] rounded-3xl p-6 md:p-8 w-full max-w-md flex flex-col items-center"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                >
                    <CheckCircle size={64} className="text-green-500 mb-4" weight="fill" />

                    <h1 className="text-xl sm:text-2xl font-medium mb-4">Добро пожаловать!</h1>

                    <div className="w-full">
                        <p className="text-gray-400 mb-2 md:mb-4">Ваша статистика</p>
                        <div className="flex flex-col sm:flex-row justify-between gap-2">
                            <motion.div
                                className="w-full flex items-center gap-2 bg-black/50 rounded-full px-4 py-2"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                            >
                                <Thermometer size={20} />
                                <span className="text-md">{temperatureValue}°C</span>
                            </motion.div>
                            <motion.div
                                className="w-full flex items-center gap-2 bg-black/50 rounded-full px-4 py-2"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                            >
                                <Wine size={20} />
                                <span className="text-md">{alcoholStatus}</span>
                            </motion.div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
