import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface UseCameraProps {
	onFrame: (imageData: string) => Promise<void>;
}

export const useCamera = ({ onFrame }: UseCameraProps) => {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const socketRef = useRef<Socket | null>(null);
	const intervalRef = useRef<number | null>(null);

	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [lastFrame, setLastFrame] = useState<string | null>(null);
	const [isRaspberryPi, setIsRaspberryPi] = useState(false);

	// 📌 Function to Capture Frame from a Device Camera
	const captureFrame = useCallback(async () => {
		if (!canvasRef.current || !videoRef.current) return;
		const canvas = canvasRef.current;
		const video = videoRef.current;
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const context = canvas.getContext("2d");
		if (!context) return;
		context.drawImage(video, 0, 0, canvas.width, canvas.height);
		const imageData = canvas.toDataURL("image/jpeg", 0.6);
		await onFrame(imageData);
	}, [onFrame]);

	// 📌 Setup Raspberry Pi Camera
	const setupRaspberryPiCamera = async () => {
		try {
			setLoading(true);
			const socket = io( "http://localhost:3001");
			socketRef.current = socket;
			setIsRaspberryPi(true);

			socket.on("connect", () => {
				console.log("Connected to Raspberry Pi camera");
				socket.emit("start-camera");
			});

			socket.on("camera-frame", async (data) => {
				if (data.success) {
					setLastFrame(data.image);
					setLoading(false);
					await onFrame(data.image);
				}
			});

			socket.on("camera-error", (errorMessage) => {
				console.error("Camera error:", errorMessage);
				setError(errorMessage);
				setLoading(false);
			});

			socket.on("disconnect", () => {
				console.log("Disconnected from Raspberry Pi camera");
			});
		} catch (err) {
			console.error("Error setting up Raspberry Pi camera:", err);
			setError("Failed to connect to Raspberry Pi camera");
			setLoading(false);
		}
	};

	// 📌 Setup Device Camera
	const setupDeviceCamera = async () => {
		try {
			setLoading(true);
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
			});

			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				await new Promise((resolve) => {
					if (videoRef.current) {
						videoRef.current.onloadedmetadata = resolve;
					}
				});
				await videoRef.current.play();
			}

			// Start capturing frames
			intervalRef.current = window.setInterval(captureFrame, 1000);
			setLoading(false);
		} catch (err) {
			setError("Ошибка доступа к камере. Проверьте разрешения.");
			setLoading(false);
			console.error("Error accessing device camera:", err);
		}
	};

	// 📌 Automatically Detect and Setup the Correct Camera
	useEffect(() => {
		let mounted = true;

		// Try connecting to Raspberry Pi camera first
		fetch("http://localhost:3001")
			.then(() => {
				if (mounted) setupRaspberryPiCamera();
			})
			.catch(() => {
				// If the server is unavailable, use the device camera
				if (mounted) setupDeviceCamera();
			});

		return () => {
			mounted = false;

			// Cleanup Raspberry Pi camera connection
			if (socketRef.current) {
				socketRef.current.emit("stop-camera");
				socketRef.current.disconnect();
			}

			// Cleanup Device Camera
			if (intervalRef.current) clearInterval(intervalRef.current);
			if (videoRef.current?.srcObject) {
				const videoStream = videoRef.current.srcObject as MediaStream;
				videoStream.getTracks().forEach((track) => track.stop());
			}
		};
	}, [captureFrame]);

	return { videoRef, canvasRef, error, loading, lastFrame, isRaspberryPi };
};
