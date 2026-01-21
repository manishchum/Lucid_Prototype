
import React, { useRef, useState } from 'react';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Set the worker source for pdf.js to enable parsing in a separate thread.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs`;

interface FileUploadProps {
  onFileRead: (content: string) => void;
  onSubmit: () => void;
  hasFile: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileRead, onSubmit, hasFile }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setFileName(file.name);
    setIsParsing(true);
    setParseError(null);
    onFileRead(''); // Reset content while parsing new file

    try {
      let textContent = '';
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      
      if (fileExtension === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        textContent = result.value;
      } else if (fileExtension === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          // Join text items with a space and separate pages with newlines
          const pageText = textContent.items.map(item => (item as any).str).join(' ');
          fullText += pageText + '\n\n';
        }
        textContent = fullText;
      } else {
        // Fallback for text-based files
        textContent = await file.text();
      }
      onFileRead(textContent);

    } catch (error) {
      console.error('Error parsing file:', error);
      setParseError(`Failed to read content from ${file.name}. The file might be corrupted or unsupported.`);
      setFileName('');
    } finally {
      setIsParsing(false);
    }
  };

  const handleButtonClick = () => {
    // Reset state before opening file dialog for a better UX
    setFileName('');
    setParseError(null);
    onFileRead('');
    fileInputRef.current?.click();
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-lg border border-slate-200">
      <div className="text-center">
        <div 
            onClick={!isParsing ? handleButtonClick : undefined}
            className={`group border-2 border-dashed border-slate-300 rounded-lg p-10 transition-colors duration-300 ${isParsing ? 'cursor-wait bg-slate-50' : 'cursor-pointer hover:border-blue-500'}`}
            aria-disabled={isParsing}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept=".txt,.md,.json,.csv,.docx,.pdf"
            disabled={isParsing}
          />
          <svg className="mx-auto h-12 w-12 text-slate-400 group-hover:text-blue-500" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4V12a4 4 0 014-4h12l4-4h12a4 4 0 014 4v4m-8-4h-8m8 4h-8m-8 8h16m-16 4h16m-16 4h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-semibold text-blue-600">Click to upload a document</span>
          </p>
          <p className="text-xs text-slate-500">DOCX, PDF, TXT, MD, JSON, or CSV</p>
          
          {isParsing && <p className="text-sm mt-4 text-blue-600 font-medium animate-pulse">Reading {fileName}...</p>}
          
          {!isParsing && fileName && !parseError && <p className="text-sm mt-4 text-green-600 font-medium">Selected: {fileName}</p>}

          {parseError && <p className="text-sm mt-4 text-red-600 font-medium">{parseError}</p>}
        </div>
      </div>
      <div className="mt-6">
        <button
          onClick={onSubmit}
          disabled={!hasFile || isParsing}
          className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors duration-300 disabled:bg-slate-400 disabled:cursor-not-allowed shadow-md"
        >
          {isParsing ? 'Processing File...' : 'Generate Infographic'}
        </button>
      </div>
    </div>
  );
};

export default FileUpload;
