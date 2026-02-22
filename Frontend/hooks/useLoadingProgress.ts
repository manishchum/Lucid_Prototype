import { useState, useEffect } from 'react';

export function useLoadingProgress(active: boolean) {
    const [progress, setProgress] = useState(15);
    const [show, setShow] = useState(false); // Default to false to allow for delay

    useEffect(() => {
        if (!active) {
            setProgress(100);
            const timeout = setTimeout(() => setShow(false), 200);
            return () => clearTimeout(timeout);
        }

        // Show after a tiny delay to prevent flickering for fast loads
        const showTimeout = setTimeout(() => setShow(true), 250);

        setProgress(Math.min(30, 12 + Math.round(Math.random() * 10)));

        const id = setInterval(() => {
            setProgress((prev) => {
                const hold = prev > 70 ? Math.random() < 0.5 : Math.random() < 0.3;
                if (hold) return prev;

                const increment = Math.max(1, Math.round(Math.random() * 7));
                return Math.min(prev + increment, 96);
            });
        }, 400 + Math.round(Math.random() * 300));

        return () => {
            clearTimeout(showTimeout);
            clearInterval(id);
        };
    }, [active]);

    return { progress: Math.min(progress, 100), show };
}
