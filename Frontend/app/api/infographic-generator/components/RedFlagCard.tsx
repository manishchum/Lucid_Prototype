
import React from 'react';
import { Flag } from '../types';
import { IconMap } from './icons/IconMap';
import Gauge from './Gauge';

interface RedFlagCardProps {
  flag: Flag;
}

const RedFlagCard: React.FC<RedFlagCardProps> = ({ flag }) => {
  const FlagIcon = IconMap[flag.icon] || IconMap.default;

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 flex flex-col p-6 text-center h-full">
      <div className="flex-grow">
        {flag.icon === 'gauge' && flag.value ? (
          <Gauge percentage={parseInt(flag.value, 10)} />
        ) : (
          <FlagIcon className="w-16 h-16 mx-auto text-red-500" />
        )}
        <h3 className="mt-4 text-xl font-bold text-slate-800">{flag.title}</h3>
        <p className="mt-2 text-slate-600">{flag.text}</p>
      </div>
      <div className="mt-4 pt-4 border-t-4 border-red-400 rounded-b-md"></div>
    </div>
  );
};

export default RedFlagCard;
