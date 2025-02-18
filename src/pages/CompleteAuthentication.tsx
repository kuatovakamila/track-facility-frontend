import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle, XCircle, Thermometer, Wine } from "@phosphor-icons/react";
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

	// ✅ Ensure correct alcohol display
	const alcoholStatus =
		results.alcohol === "Трезвый"
			? "Трезвый"
			: results.alcohol === "Пьяный"
			? "Пьяный"
			: "н/a";

	const stats = [
		{ icon: Thermometer, value: results.temperature || "0", unit: "°C" },
		{ icon: Wine, value: alcoholStatus, unit: "" },
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
					<h1 className="text-xl sm:text-2xl font-medium mb-4">
						{isSuccess ? "Добро пожаловать!" : "Вход запрещен!"}
					</h1>

					<div className="w-full">
						<div className="flex flex-col gap-2">
							{stats.map(({ icon: Icon, value, unit }, index) => (
								<div key={index} className="w-full flex items-center gap-2">
									<Icon size={20} />
									<span className="text-md">{value}{unit}</span>
								</div>
							))}
						</div>
					</div>
				</motion.div>
			</div>
		</div>
	);
}
