import { FC } from "react";
import { BookOpen, GitBranch, Database, Cpu, Layers, Lightbulb } from "lucide-react";

const icons = [BookOpen, GitBranch, Database, Cpu, Layers, Lightbulb];

interface Section {
  heading: string;
  points: string[];
}

const InfographicGemini: FC<{ sections: Section[] }> = ({ sections }) => {
  return (
    <div className="flex flex-col items-center w-full p-6">
      <h2 className="text-2xl font-extrabold mb-6 text-gray-900">Study Infographic</h2>

      <div className="flex justify-center gap-6 flex-wrap max-w-5xl">
        {sections.map((section, i) => {
          const Icon = icons[i % icons.length];
          return (
            <div key={i} className="flex flex-col items-center w-60">
              <div className="w-14 h-14 bg-white border border-gray-200 shadow-sm rounded-full flex items-center justify-center mb-3">
                <Icon size={24} />
              </div>

              <h3 className="text-lg font-bold text-gray-800 text-center mb-2">
                {section.heading}
              </h3>

              <ul className="text-sm text-gray-600 text-center space-y-1">
                {section.points.map((point, j) => (
                  <li key={j}>{point}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InfographicGemini;
