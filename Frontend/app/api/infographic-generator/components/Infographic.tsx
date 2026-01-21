
import React from 'react';
import { InfographicData } from '../types';
import InfographicSection from './InfographicSection';
import RedFlagCard from './RedFlagCard';
import { IconMap } from './icons/IconMap';

interface InfographicProps {
  data: InfographicData;
}

const Infographic: React.FC<InfographicProps> = ({ data }) => {
  return (
    <div className="bg-white p-6 sm:p-10 rounded-2xl shadow-xl border border-slate-200">
      <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 text-center mb-10">{data.title}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-10 lg:divide-x lg:divide-slate-200">
        {data.sections.map((section, index) => (
          <div key={index} className={`py-4 ${index > 0 ? 'lg:pl-10' : 'lg:pr-10'}`}>
            <InfographicSection section={section} />
          </div>
        ))}
      </div>
      
      {data.criticalFlags && data.criticalFlags.flags.length > 0 && (
        <div className="mt-12 pt-8 border-t border-slate-200">
          <h2 className="text-2xl font-bold text-center mb-8 text-slate-800">{data.criticalFlags.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.criticalFlags.flags.map((flag, index) => (
              <RedFlagCard key={index} flag={flag} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Infographic;
