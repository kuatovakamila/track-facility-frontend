import {
	// Heart,
	Thermometer,
	Wine,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

export const STATES = {
	// PULSE: {
	// 	title: "Измерение пульса",
	// 	subtitle: "Держите палец на месте",
	// 	icon: Heart as Icon,
	// 	value: "Загрузка...",
	// 	unit: "BPM",
	// },
	TEMPERATURE: {
		title: "Измерение температуры",
		subtitle: "Держите палец на месте",
		icon: Thermometer as Icon,
		value: "Загрузка...",
		unit: "°C",
	},
	ALCOHOL: {
		title: "Измерение уровня алкоголя",
		subtitle: "Дуйте в алкотестер 3-4 секунды",
		icon: Wine as Icon,
		value: "Загрузка...",
		unit: "MG",
	},
} as const;

export type StateKey = keyof typeof STATES;

export const ERROR_MESSAGES = {
	FACE_NOT_DETECTED:
		"Лицо не обнаружено в кадре. Пожалуйста, убедитесь, что ваше лицо находится в центре кадра и хорошо освещено.",
	FACE_NOT_MATCHED:
		"Не удалось подтвердить личность. Пожалуйста, убедитесь, что вы зарегистрированный пользователь или свяжитесь с администрацией.",
	FACE_RECOGNITION_ERROR:
		"Ошибка при проверке лица. Пожалуйста, попробуйте снова или свяжитесь с администрацией.",
} as const;
