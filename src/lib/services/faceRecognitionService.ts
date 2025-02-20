interface VerifyFaceResponse {
	matched: boolean;
	faceId?: string;
	error?: string;
}

class FaceRecognitionService {
	async verifyFace(imageData: string): Promise<VerifyFaceResponse> {
		const response = await fetch(
			`http://localhost:3001/api/verify-face`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ image: imageData }),
			},
		);
		return response.json();
	}
}

export const faceRecognitionService = new FaceRecognitionService();
