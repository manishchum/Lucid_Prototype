
import React, { useState, useCallback } from 'react';
import { InfographicData } from './types';
import { generateInfographicData } from './services/geminiService';
import FileUpload from './components/FileUpload';
import LoadingSpinner from './components/LoadingSpinner';
import Infographic from './components/Infographic';
import ErrorDisplay from './components/ErrorDisplay';

const App: React.FC = () => {
  const [infographicData, setInfographicData] = useState<InfographicData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  const handleFile = (content: string) => {
    setFileContent(content);
  };

  const handleSubmit = useCallback(async () => {
    if (!fileContent) {
      setError('Please upload a file first.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setInfographicData(null);

    try {
      const data = await generateInfographicData(fileContent);
      setInfographicData(data);
    } catch (e) {
      console.error(e);
      setError('Failed to generate infographic. The AI model may be unable to process this document. Please try a different one.');
    } finally {
      setIsLoading(false);
    }
  }, [fileContent]);

  const handleReset = () => {
    setInfographicData(null);
    setError(null);
    setFileContent(null);
    setIsLoading(false);
  };

  return (
    <div className="bg-slate-50 min-h-screen font-sans text-slate-800 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight">Infographic Generator</h1>
          <p className="mt-2 text-lg text-slate-600 max-w-2xl mx-auto">Upload a document to automatically generate a professional summary infographic.</p>
        </header>

        <main>
          {!infographicData && !isLoading && !error && (
            <FileUpload onFileRead={handleFile} onSubmit={handleSubmit} hasFile={!!fileContent} />
          )}

          {isLoading && (
             <div className="text-center">
              <LoadingSpinner />
              <p className="mt-4 text-slate-600 animate-pulse">Analyzing document and designing your infographic...</p>
            </div>
          )}

          {error && <ErrorDisplay message={error} onRetry={handleSubmit} />}
          
          {infographicData && (
            <div>
              <Infographic data={infographicData} />
              <div className="text-center mt-12">
                <button
                  onClick={handleReset}
                  className="bg-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors duration-300 shadow-md"
                >
                  Create Another Infographic
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
