'use client'

import { useState } from 'react';
import EmployeeNavigation from '@/components/employee-navigation';
import ModuleSuggestions from '@/components/module-suggestions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { 
  Upload, 
  Sparkles,
  Loader2,
  FileText,
  TrendingUp,
  TrendingDown,
  BookOpen,
  Database,
  CheckCircle2,
  AlertCircle,
  Calculator,
  File,
  X
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface KPIIndicator {
  name: string;
  description: string;
  formula: string;
}

interface ParsedKPIData {
  leadIndicators: KPIIndicator[];
  lagIndicators: KPIIndicator[];
  learningStrategy: string;
  dataStrategy: string;
}

export default function KPIIntelligencePage() {
  const [roleName, setRoleName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedKPIData | null>(null);
  const [error, setError] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file type
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedTypes.includes(file.type)) {
      setError('Please upload a PDF or Word document');
      return;
    }

    setUploadedFile(file);
    setError('');
    setIsParsingFile(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/parse-file', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to parse file');
      }

      const data = await response.json();
      setJobDescription(data.text);
      
      // Auto-extract role name from filename if not set
      if (!roleName) {
        const filename = file.name.replace(/\.(pdf|docx?|doc)$/i, '');
        setRoleName(filename);
      }
    } catch (err) {
      setError('Failed to parse the uploaded file. Please try again.');
      console.error(err);
      setUploadedFile(null);
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    setJobDescription('');
  };

  const handleParseJD = async () => {
    if (!roleName.trim() || !jobDescription.trim()) {
      setError('Please provide both role name and job description');
      return;
    }

    setIsLoading(true);
    setError('');
    setParsedData(null);

    try {
      const response = await fetch('/api/parse-job-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roleName,
          jobDescription,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse job description');
      }

      const data = await response.json();
      setParsedData(data);
    } catch (err) {
      setError('Failed to parse job description. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setRoleName('');
    setJobDescription('');
    setParsedData(null);
    setError('');
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <EmployeeNavigation />
      
      <main className="flex-1 lg:ml-72 transition-all duration-300">
        <div className="p-8">
          {/* Header Section */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">KPI Intelligence</h1>
            <p className="text-gray-600 mt-1">Upload job descriptions to automatically extract KPIs, strategies, and indicators using AI</p>
          </div>

          {/* Input Section - Full Width */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Job Description Input
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="roleName">Role Name</Label>
                  <Input
                    id="roleName"
                    placeholder="e.g., Senior Sales Manager"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    disabled={isLoading || isParsingFile}
                  />
                </div>
              </div>

              {/* File Upload Section */}
              <div className="space-y-2">
                <Label>Upload Job Description (PDF or Word)</Label>
                <div className="flex items-center gap-3">
                  <label
                    htmlFor="file-upload"
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-8 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                      uploadedFile
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                    } ${isLoading || isParsingFile ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isParsingFile ? (
                      <>
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                        <span className="text-sm text-gray-600">Parsing file...</span>
                      </>
                    ) : uploadedFile ? (
                      <>
                        <File className="w-5 h-5 text-green-600" />
                        <span className="text-sm text-gray-700">{uploadedFile.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            handleRemoveFile();
                          }}
                          className="ml-2"
                        >
                          <X className="w-4 h-4 text-red-500" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          Click to upload or drag and drop
                        </span>
                        <span className="text-xs text-gray-500">PDF or Word document</span>
                      </>
                    )}
                  </label>
                  <input
                    id="file-upload"
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleFileUpload}
                    disabled={isLoading || isParsingFile}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-gray-300"></div>
                <span className="text-xs text-gray-500 uppercase">Or paste manually</span>
                <div className="flex-1 border-t border-gray-300"></div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jobDescription">Job Description</Label>
                <Textarea
                  id="jobDescription"
                  placeholder="Paste the complete job description here..."
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  disabled={isLoading || isParsingFile}
                  rows={8}
                  className="resize-none"
                />
                <p className="text-xs text-gray-500">
                  Include responsibilities, requirements, and key performance expectations
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button 
                  onClick={handleParseJD} 
                  disabled={isLoading || isParsingFile || !roleName.trim() || !jobDescription.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Intelligence
                    </>
                  )}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleReset}
                  disabled={isLoading || isParsingFile}
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Loading State */}
          {isLoading && (
            <Card>
              <CardContent className="py-16">
                <div className="flex flex-col items-center justify-center">
                  <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                  <p className="text-gray-600 font-medium">Analyzing job description...</p>
                  <p className="text-sm text-gray-500 mt-1">This may take a few moments</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results Section - Full Width */}
          {parsedData && (
            <>
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                   Analysis Results
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="indicators" className="w-full">
                    <TabsList className="grid w-full grid-cols-1">
                      <TabsTrigger value="indicators">Indicators</TabsTrigger>
                      {/* <TabsTrigger value="strategies">Strategies</TabsTrigger> */}
                    </TabsList>
                    
                    <TabsContent value="indicators" className="space-y-6 mt-4">
                      {/* Lead Indicators */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b-2 border-green-200">
                          <TrendingUp className="w-5 h-5 text-green-600" />
                          <h3 className="font-semibold text-lg text-gray-900">Lead Indicators</h3>
                          <span className="text-xs text-gray-500 ml-2">(Predictive Metrics)</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {parsedData.leadIndicators.map((indicator, index) => (
                            <Card 
                              key={index}
                              className="border-l-4 border-l-green-500 hover:shadow-lg transition-shadow"
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                  <h4 className="font-semibold text-gray-900">{indicator.name}</h4>
                                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                    Lead
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mb-3">{indicator.description}</p>
                                {indicator.formula && (
                                  <div className="mt-3 pt-3 border-t border-gray-100">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <Calculator className="w-3.5 h-3.5 text-gray-500" />
                                      <span className="text-xs font-medium text-gray-700">Formula:</span>
                                    </div>
                                    <code className="text-xs bg-gray-50 text-gray-800 px-2 py-1 rounded block">
                                      {indicator.formula}
                                    </code>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>

                      {/* Lag Indicators */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b-2 border-blue-200">
                          <TrendingDown className="w-5 h-5 text-blue-600" />
                          <h3 className="font-semibold text-lg text-gray-900">Lag Indicators</h3>
                          <span className="text-xs text-gray-500 ml-2">(Outcome Metrics)</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {parsedData.lagIndicators.map((indicator, index) => (
                            <Card 
                              key={index}
                              className="border-l-4 border-l-blue-500 hover:shadow-lg transition-shadow"
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                  <h4 className="font-semibold text-gray-900">{indicator.name}</h4>
                                  <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                                    Lag
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mb-3">{indicator.description}</p>
                                {indicator.formula && (
                                  <div className="mt-3 pt-3 border-t border-gray-100">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <Calculator className="w-3.5 h-3.5 text-gray-500" />
                                      <span className="text-xs font-medium text-gray-700">Formula:</span>
                                    </div>
                                    <code className="text-xs bg-gray-50 text-gray-800 px-2 py-1 rounded block">
                                      {indicator.formula}
                                    </code>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </TabsContent>

                    {/* <TabsContent value="strategies" className="space-y-4 mt-4"> */}
                      {/* Learning Strategy */}
                      {/* <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                          <BookOpen className="w-5 h-5 text-purple-600" />
                          <h3 className="font-semibold text-gray-900">Learning Strategy</h3>
                        </div>
                        <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                          <p className="text-sm text-gray-800 whitespace-pre-line">{parsedData.learningStrategy}</p>
                        </div>
                      </div> */}

                      {/* Data Strategy */}
                      {/* <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Database className="w-5 h-5 text-orange-600" />
                          <h3 className="font-semibold text-gray-900">Data Strategy</h3>
                        </div>
                        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                          <p className="text-sm text-gray-800 whitespace-pre-line">{parsedData.dataStrategy}</p>
                        </div>
                      </div>
                    </TabsContent> */}
                  </Tabs>
                </CardContent>
              </Card>

              {/* Module Suggestions Section */}
              <ModuleSuggestions
                leadIndicators={parsedData?.leadIndicators.map(ind => ind.name)}
                lagIndicators={parsedData?.lagIndicators.map(ind => ind.name)}
                roleName={roleName}
              />

              {/* Action Buttons */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Save KPI Configuration</h3>
                      <p className="text-sm text-gray-600">Save these indicators and strategies for {roleName}</p>
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline">
                        Export as PDF
                      </Button>
                      <Button className="bg-green-600 hover:bg-green-700">
                        Save Configuration
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
