
import React from 'react';

interface ErrorDisplayProps {
  message: string;
  onRetry: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ message, onRetry }) => {
  return (
    <div className="max-w-2xl mx-auto bg-red-50 border border-red-200 text-red-800 p-6 rounded-lg shadow-md text-center">
      <h3 className="text-lg font-semibold mb-2">An Error Occurred</h3>
      <p>{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 bg-red-600 text-white font-bold py-2 px-5 rounded-lg hover:bg-red-700 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
};

export default ErrorDisplay;
