
import React from 'react';
import { SubSection } from '../types';
import { IconMap } from './icons/IconMap';

interface InfoCardProps {
  subSection: SubSection;
}

const colorClasses = {
  blue: 'bg-blue-600',
  green: 'bg-green-600',
  yellow: 'bg-yellow-500',
};

const InfoCard: React.FC<InfoCardProps> = ({ subSection }) => {
  const CardIcon = IconMap[subSection.icon] || IconMap.default;
  const bgColor = colorClasses[subSection.color] || 'bg-gray-500';

  return (
    <div className={`text-white p-5 rounded-xl shadow-lg relative overflow-hidden ${bgColor}`}>
       <div className="absolute -top-2 -right-2 text-white/20">
        <CardIcon className="w-20 h-20" />
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-4 mb-3">
            <div className="bg-white/90 p-2 rounded-full">
                <CardIcon className={`w-8 h-8 ${subSection.color === 'blue' ? 'text-blue-600' : subSection.color === 'green' ? 'text-green-600' : 'text-yellow-500'}`} />
            </div>
            <h3 className="text-xl font-bold">{subSection.title}</h3>
        </div>
        <div className="space-y-2 text-white/90">
            {subSection.points.map((point, index) => (
                <div key={index}>
                    <p><span className="font-semibold">{point.title}:</span> {point.text}</p>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default InfoCard;
