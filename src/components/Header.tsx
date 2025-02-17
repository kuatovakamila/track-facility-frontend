import { format } from "date-fns";
import { ru } from "date-fns/locale";

export const Header = () => {
	const now = new Date();
	return (
		<div className="flex justify-between items-center">
			<span className="text-sm">{format(now, "HH:mm")}</span>
			<span className="text-sm">
				{format(now, "d MMMM", { locale: ru })}
			</span>
		</div>
	);
};
