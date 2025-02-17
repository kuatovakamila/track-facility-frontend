import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface UseCameraProps {
	onFrame: (imageData: string) => Promise<void>;
}

export const useRaspberryCamera = ({ onFrame }: UseCameraProps) => {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const socketRef = useRef<Socket | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [lastFrame, setLastFrame] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;

		async function setupCamera() {
			try {
				const socket = io(import.meta.env.VITE_SERVER_URL);
				socketRef.current = socket;

				socket.on("connect", () => {
					console.log("Connected to camera socket");
					socket.emit("start-camera");
				});

				socket.on("camera-frame", async (data) => {
					if (!mounted) return;

					if (data.success) {
						setLastFrame(data.image);
						await onFrame(data.image);
					}
				});

				socket.on("camera-error", (errorMessage) => {
					if (!mounted) return;
					console.error("Camera error:", errorMessage);
					setError(errorMessage);
				});

				socket.on("disconnect", () => {
					console.log("Disconnected from camera socket");
				});
			} catch (err) {
				console.error("Error setting up camera:", err);
				setError("Failed to connect to camera");
			}
		}

		setupCamera();

		return () => {
			mounted = false;
			if (socketRef.current) {
				socketRef.current.emit("stop-camera");
				socketRef.current.disconnect();
			}
		};
	}, [onFrame]);

	return {
		videoRef,
		canvasRef,
		error,
		isRpiCamera: true,
		lastFrame,
	};
};

export const useDeviceCamera = ({ onFrame }: UseCameraProps) => {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const intervalRef = useRef<number | null>(null);
	const [error, setError] = useState<string | null>(null);

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

	useEffect(() => {
		let mounted = true;
		const currentVideo = videoRef.current; // Store ref value

		async function setupCamera() {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: {
						facingMode: "user",
						width: { ideal: 640 },
						height: { ideal: 480 },
					},
				});

				if (videoRef.current && mounted) {
					videoRef.current.srcObject = stream;
					// Wait for video to be ready
					await new Promise((resolve) => {
						if (videoRef.current) {
							videoRef.current.onloadedmetadata = resolve;
						}
					});
					await videoRef.current.play();
				}

				if (mounted) {
					// Start capturing frames after video is playing
					intervalRef.current = window.setInterval(
						captureFrame,
						1000,
					);
				}
			} catch (err) {
				if (mounted) {
					setError(
						"Ошибка доступа к камере. Пожалуйста, проверьте разрешения.",
					);
					console.error("Error accessing camera:", err);
				}
			}
		}

		setupCamera();

		return () => {
			mounted = false;
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
			if (currentVideo?.srcObject) {
				// Use stored ref
				const videoStream = currentVideo.srcObject as MediaStream;
				videoStream.getTracks().forEach((track) => track.stop());
			}
		};
	}, [captureFrame]);

	return {
		videoRef,
		canvasRef,
		error,
	};
};
