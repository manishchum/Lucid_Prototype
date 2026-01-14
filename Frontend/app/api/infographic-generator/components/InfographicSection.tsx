
import React from 'react';
import { Section } from '../types';
import { IconMap } from './icons/IconMap';
import InfoCard from './InfoCard';

interface InfographicSectionProps {
  section: Section;
}

const InfographicSection: React.FC<InfographicSectionProps> = ({ section }) => {
  const SectionIcon = IconMap[section.icon] || IconMap.default;

  return (
    <section>
      <div className="flex items-center gap-6 mb-6">
        <div className="flex-shrink-0">
          <SectionIcon className="w-20 h-20 text-blue-500" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-teal-600">{section.title}</h2>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {section.points.map((point, index) => (
          <div key={index}>
            <h3 className="text-xl font-bold text-slate-800">{point.title}</h3>
            <p className="text-slate-600 mt-1">{point.text}</p>
          </div>
        ))}
      </div>
      
      <div className="space-y-4">
        {section.subSections.map((sub, index) => (
          <InfoCard key={index} subSection={sub} />
        ))}
      </div>
    </section>
  );
};

export default InfographicSection;
