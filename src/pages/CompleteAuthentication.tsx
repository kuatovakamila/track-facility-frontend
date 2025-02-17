import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
	CheckCircle,
	XCircle,
	Heart,
	Thermometer,
	Wine,
} from "@phosphor-icons/react";
import { Header } from "../components/Header";
import { useLocation, useNavigate } from "react-router-dom";

export default function CompleteAuthentication() {
	const navigate = useNavigate();
	const location = useLocation();
	const [isSuccess, setIsSuccess] = useState(location.state?.success ?? true);

	const results = JSON.parse(localStorage.getItem("results") || "{}");

	useEffect(() => {
		const timer = setTimeout(() => {
			navigate("/");
		}, 5000);

		return () => clearTimeout(timer);
	}, [navigate]);

	const stats = [
		{ icon: Heart, value: results.bpm || "0", unit: "уд/м" },
		{ icon: Thermometer, value: results.temperature || "0", unit: "°C" },
		{ icon: Wine, value: results.alcohol || "н/a", unit: "" },
	];

	return (
		<div className="min-h-screen bg-black text-white flex flex-col">
			<Header />

			<div className="flex-1 flex flex-col items-center justify-center p-6">
				<motion.div
					className="bg-[#272727] rounded-3xl p-6 md:p-8 w-full max-w-md flex flex-col items-center"
					initial={{ scale: 0.9, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
				>
					{isSuccess ? (
						<CheckCircle
							size={64}
							className="text-green-500 mb-4"
							weight="fill"
						/>
					) : (
						<XCircle
							size={64}
							className="text-red-500 mb-4"
							weight="fill"
						/>
					)}

					<h1 className="text-xl sm:text-2xl font-medium mb-4">
						{isSuccess ? "Добро пожаловать!" : "Вход запрещен!"}
					</h1>

					<div className="w-full">
						<p className="text-gray-400 mb-2 md:mb-4">
							Ваша статистика
						</p>
						<div className="flex flex-col sm:flex-row justify-between gap-2">
							{stats.map(({ icon: Icon, value, unit }, index) => (
								<motion.div
									key={index}
									className="w-full flex items-center gap-2 bg-black/50 rounded-full px-4 py-2"
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: 0.2 + index * 0.1 }}
								>
									<Icon size={20} />
									<span className="text-md">
										{value}
										{unit && (
											<span className="text-gray-400 ml-1">
												{unit}
											</span>
										)}
									</span>
								</motion.div>
							))}
						</div>
					</div>

					<motion.button
						className="mt-8 px-6 py-2 bg-[#5096FF] rounded-full text-white"
						onClick={() => setIsSuccess(!isSuccess)}
						whileHover={{ scale: 1.05 }}
						whileTap={{ scale: 0.95 }}
					>
						Toggle Result
					</motion.button>
				</motion.div>
			</div>
		</div>
	);
}
