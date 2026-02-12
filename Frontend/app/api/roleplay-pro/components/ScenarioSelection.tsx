
// import React from 'react';
// import { Scenario } from '../types';
// import { SCENARIOS } from '../constants';
// import Button from './ui/Button';
// import Card from './ui/Card';

// interface ScenarioSelectionProps {
//   onScenarioSelect: (scenario: Scenario) => void;
// }

// const ScenarioSelection: React.FC<ScenarioSelectionProps> = ({ onScenarioSelect }) => {
//   const [selectedScenario, setSelectedScenario] = React.useState<Scenario | null>(null);

//   return (
//     <div className="flex flex-col items-center p-4">
//       <h1 className="text-4xl md:text-5xl font-extrabold text-gray-800 mb-8 text-center leading-tight">
//         Choose Your <span className="text-purple-600">Role-Play</span> Scenario
//       </h1>

//       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8 w-full">
//         {SCENARIOS.map((scenario) => (
//           <Card
//             key={scenario.id}
//             className={`cursor-pointer border-4 transition-all duration-300 ${
//               selectedScenario?.id === scenario.id
//                 ? 'border-indigo-500 shadow-xl scale-105 transform'
//                 : 'border-transparent hover:border-gray-200 hover:shadow-md'
//             }`}
//             onClick={() => setSelectedScenario(scenario)}
//           >
//             <h2 className="text-2xl font-semibold text-gray-800 mb-3">{scenario.title}</h2>
//             <p className="text-gray-600 mb-4">{scenario.description}</p>
//             <div className="flex justify-between items-center text-sm font-medium">
//               <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full">{scenario.role}</span>
//               <span className={`px-3 py-1 rounded-full ${
//                 scenario.difficulty === 'Easy' ? 'bg-green-100 text-green-800' :
//                 scenario.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
//                 'bg-red-100 text-red-800'
//               }`}>
//                 {scenario.difficulty}
//               </span>
//             </div>
//           </Card>
//         ))}
//       </div>

//       <div className="w-full flex justify-center">
//         <Button
//           onClick={() => selectedScenario && onScenarioSelect(selectedScenario)}
//           disabled={!selectedScenario}
//           size="lg"
//           className="w-full max-w-sm"
//         >
//           {selectedScenario ? `Start Role-Play: ${selectedScenario.title}` : 'Select a Scenario to Start'}
//         </Button>
//       </div>

//       {!selectedScenario && (
//         <p className="text-gray-500 mt-4 text-center">Please select a scenario above to begin your practice session.</p>
//       )}
//     </div>
//   );
// };

// export default ScenarioSelection;
