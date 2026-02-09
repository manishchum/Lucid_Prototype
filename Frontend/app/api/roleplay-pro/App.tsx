
// import React, { useState, useCallback } from 'react';
// import { AppScreen, Scenario, AssessmentReport, Message } from './types';
// import ScenarioSelection from './components/ScenarioSelection';
// import RolePlayScreen from './components/RolePlayScreen';
// import AssessmentReportComponent from './components/AssessmentReport';
// import { generateAssessmentReport } from './services/geminiService';
// import LoadingSpinner from './components/ui/LoadingSpinner';
// // FIX: Import Button component
// import Button from './components/ui/Button';

// const App: React.FC = () => {
//   const [currentScreen, setCurrentScreen] = useState<AppScreen>('scenarioSelection');
//   const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
//   const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
//   const [assessmentReport, setAssessmentReport] = useState<AssessmentReport | null>(null);
//   const [isGeneratingReport, setIsGeneratingReport] = useState(false);
//   const [reportError, setReportError] = useState<string | null>(null);

//   const handleScenarioSelect = useCallback((scenario: Scenario) => {
//     setSelectedScenario(scenario);
//     setCurrentScreen('rolePlay');
//     setReportError(null); // Clear previous errors
//   }, []);

//   const handleEndRolePlay = useCallback(async (history: Message[]) => {
//     setConversationHistory(history);
//     if (!selectedScenario) {
//         setReportError("No scenario selected for assessment.");
//         setCurrentScreen('assessmentReport');
//         return;
//     }
    
//     setIsGeneratingReport(true);
//     setReportError(null);
//     setAssessmentReport(null);

//     try {
//       const report = await generateAssessmentReport(history, selectedScenario.title);
//       setAssessmentReport(report);
//     } catch (error) {
//       console.error("Error generating assessment report in App:", error);
//       setReportError(`Failed to generate assessment report: ${error instanceof Error ? error.message : String(error)}`);
//     } finally {
//       setIsGeneratingReport(false);
//       setCurrentScreen('assessmentReport');
//     }
//   }, [selectedScenario]);

//   const handleStartNewRolePlay = useCallback(() => {
//     setSelectedScenario(null);
//     setConversationHistory([]);
//     setAssessmentReport(null);
//     setCurrentScreen('scenarioSelection');
//     setReportError(null);
//   }, []);

//   return (
//     <div className="min-h-screen flex flex-col justify-center items-center">
//       {currentScreen === 'scenarioSelection' && (
//         <ScenarioSelection onScenarioSelect={handleScenarioSelect} />
//       )}

//       {currentScreen === 'rolePlay' && selectedScenario && (
//         <RolePlayScreen
//           scenario={selectedScenario}
//           onEndRolePlay={handleEndRolePlay}
//         />
//       )}

//       {currentScreen === 'assessmentReport' && (
//         isGeneratingReport ? (
//           <LoadingSpinner message="Analyzing Role-Play and Generating Assessment..." className="py-20" />
//         ) : reportError ? (
//           <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative w-full max-w-3xl text-center">
//             <strong className="font-bold">Assessment Error:</strong>
//             <span className="block sm:inline ml-2">{reportError}</span>
//             <div className="mt-4">
//               {/* FIX: Add Button component */}
//               <Button onClick={handleStartNewRolePlay} variant="secondary">Start New Role-Play</Button>
//             </div>
//           </div>
//         ) : assessmentReport && selectedScenario ? (
//           <AssessmentReportComponent
//             report={assessmentReport}
//             scenario={selectedScenario}
//             onStartNewRolePlay={handleStartNewRolePlay}
//           />
//         ) : (
//              <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded relative w-full max-w-3xl text-center">
//                 <strong className="font-bold">No Assessment Data:</strong>
//                 <span className="block sm:inline ml-2">Something went wrong or no report was generated.</span>
//                  <div className="mt-4">
//                      {/* FIX: Add Button component */}
//                      <Button onClick={handleStartNewRolePlay} variant="secondary">Start New Role-Play</Button>
//                  </div>
//             </div>
//         )
//       )}
//     </div>
//   );
// };

// export default App;
