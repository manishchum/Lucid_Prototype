
import React from 'react';

interface GaugeProps {
  percentage: number;
}

const Gauge: React.FC<GaugeProps> = ({ percentage = 0 }) => {
  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  const angle = (clampedPercentage / 100) * 180;
  const radians = (angle - 90) * (Math.PI / 180);
  const x = 50 + 40 * Math.cos(radians);
  const y = 50 + 40 * Math.sin(radians);
  
  const getArcColor = (p: number) => {
    if (p <= 40) return '#10B981'; // Green
    if (p <= 70) return '#F59E0B'; // Yellow
    return '#EF4444'; // Red
  };
  
  const needleColor = getArcColor(clampedPercentage);

  return (
    <div className="relative w-40 h-24 mx-auto">
      <svg viewBox="0 0 100 55" className="w-full h-full">
        <path d="M10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#10B981" strokeWidth="10" />
        <path d="M10 50 A 40 40 0 0 1 50 10" fill="none" stroke="#F59E0B" strokeWidth="10" />
        <path d="M50 10 A 40 40 0 0 1 90 50" fill="none" stroke="#EF4444" strokeWidth="10" />
        <line x1="50" y1="50" x2={x} y2={y} stroke={needleColor} strokeWidth="3" strokeLinecap="round" />
        <circle cx="50" cy="50" r="5" fill={needleColor} />
      </svg>
      <div className="absolute bottom-0 w-full text-center">
        <span className="text-2xl font-bold" style={{ color: needleColor }}>{clampedPercentage}%</span>
      </div>
    </div>
  );
};

export default Gauge;
