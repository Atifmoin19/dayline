
export const formatDuration = (hours?: number | string): string => {
    if (!hours) return "0 min";

    // Check for HH:MM format
    if (typeof hours === 'string' && hours.includes(':')) {
        const [h, m] = hours.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return "0 min";
        const totalMinutes = h * 60 + m;
        return formatMinutes(totalMinutes);
    }

    const h = Number(hours);
    if (isNaN(h)) return "0 min";

    const totalMinutes = Math.round(h * 60);
    return formatMinutes(totalMinutes);
};

const formatMinutes = (totalMinutes: number): string => {
    if (totalMinutes === 60) return "1 hr";
    if (totalMinutes < 60) return `${totalMinutes} min`;

    // Check if whole hour
    if (totalMinutes % 60 === 0) {
        return `${totalMinutes / 60} hr${totalMinutes / 60 > 1 ? 's' : ''}`;
    }

    const wholeHours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${wholeHours} hr ${mins} min`;
};

export const parseDurationToHours = (duration?: number | string): number => {
    if (!duration) return 0;
    if (typeof duration === 'string' && duration.includes(':')) {
        const [h, m] = duration.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return 0;
        return h + (m / 60);
    }
    return Number(duration);
};
