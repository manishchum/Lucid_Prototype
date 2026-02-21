import React from 'react';

interface LoadingProgressProps {
    label: string;
    progress: number;
}

const LoadingProgress: React.FC<LoadingProgressProps> = ({ label, progress }) => {
    return (
        <div className="min-h-[70vh] flex items-center justify-center px-4">
            <div className="w-full max-w-xl bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-100 p-8 space-y-6">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-600 uppercase tracking-wider">{label}</span>
                    <span className="text-slate-900 text-2xl font-black">{Math.round(progress)}%</span>
                </div>


                <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-50">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-[#2563EB] via-[#6366F1] to-[#9333EA] transition-all duration-500 ease-out shadow-sm"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

export default LoadingProgress;
