"use client"
import { useAuth } from '@/contexts/auth-context';
import React, { useState, useEffect } from 'react'
import { ArrowLeft, Sparkles, Upload, FileText, ChevronDown, Check, Copy, RefreshCw, Compass, FileUp, Clock, ChevronRight, BookOpen } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { supabase } from '@/lib/supabase'


const MOCK_DOCUMENTS = [
  {
    id: 'doc-1',
    name: 'The Blueprint for Hospitality Excellence',
    category: 'SOP TOOLKIT',
    icon: <FileText className="w-5 h-5 text-[#5B3DF8]" />,
    modules: [
      {
        title: 'Operation Execution Checklist',
        content: (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-bold text-[#2A2B4D] mb-4">The Blueprint for Hospitality Excellence</h1>
              <h2 className="text-xl font-bold text-[#2A2B4D] mb-4">Operation Execution Checklist</h2>
              {/* <p className="text-slate-600 leading-relaxed">
                This checklist outlines the mandatory phases for staging, validating, and deploying Natural Language Processing (NLP) models (including syntactic parsers, semantic analyzers, and transformer-based pipelines) into production.
              </p> */}
            </div>
            <div className="space-y-6">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold text-[#2A2B4D] mb-4">
                  <Sparkles className="w-5 h-5 text-[#5B3DF8]" />
                  Front of House (FOH)
                </h3>
                <ul className="space-y-3">
                  {['Greet guests within 30 seconds.',
                    'Take drink/appetizer orders within 2 minutes.',
                    'Perform 2-bite check-back after food delivery.',
                    'Clear tables continuously (pre-bussing).',
                    'Offer dessert/coffee before billing.',
                    'Process payment quickly and thank guests warmly.',
                  ].map((item, i) => (
                    <li key={i} className="flex gap-3 text-slate-600">
                      <span className="font-mono text-[#5B3DF8]">[ ]</span>
                      <span><strong className="text-slate-800">{item.split(':')[0]}:</strong>{item.split(':')[1]}</span>
                    </li>
                  ))}
                </ul>
              </div>

            </div>
            <div className="space-y-6">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold text-[#2A2B4D] mb-4">
                  <Sparkles className="w-5 h-5 text-[#5B3DF8]" />
                  Back of House (FOH)
                </h3>
                <ul className="space-y-3">
                  {['Complete mise en place 15 minutes before service.',
                    'Ensure all stations are fully stocked and sanitized.',
                    'Monitor food holding temperatures regularly.',
                    'Follow cooking temperature standards for all proteins.',
                    'Execute allergy protocol immediately upon alert.',
                    'Maintain clean tools, towels, and workstations throughout service.',
                  ].map((item, i) => (
                    <li key={i} className="flex gap-3 text-slate-600">
                      <span className="font-mono text-[#5B3DF8]">[ ]</span>
                      <span><strong className="text-slate-800">{item.split(':')[0]}:</strong>{item.split(':')[1]}</span>
                    </li>
                  ))}
                </ul>
              </div>

            </div>
          </div>
        )
      },
      {
        title: "Critical Do's and Don'ts",
        content: (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-bold text-[#2A2B4D] mb-4">Critical Do's and Don'ts</h1>
              <p className="text-slate-600 leading-relaxed">These are the do's and don'ts which are to be followed.</p>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div className="bg-green-50 rounded-xl p-6 border border-green-100">
                <h3 className="text-lg font-bold text-green-800 mb-4 flex items-center gap-2"><Check className="w-5 h-5"/> Do's</h3>
                <ul className="space-y-3">
                  <li className="text-green-700 text-sm">Maintain fast and friendly guest interaction.</li>
                  <li className="text-green-700 text-sm">Keep food out of the temperature danger zone.</li>
                  <li className = "text-green-700 text-sm">Sanitize tools and hands before allergy orders.</li>


                </ul>
              </div>
              <div className="bg-red-50 rounded-xl p-6 border border-red-100">
                <h3 className="text-lg font-bold text-red-800 mb-4 flex items-center gap-2"><ChevronDown className="w-5 h-5"/> Don'ts</h3>
                <ul className="space-y-3">
                  <li className="text-red-700 text-sm">Do not leave dirty dishes on guest tables.</li>
                  <li className ="text-red-700 text-sm">Do not serve food below required cooking temperatures. </li>
                  <li className="text-red-700 text-sm">Do not delay greeting or order-taking.</li>


                </ul>
              </div>
            </div>
          </div>
        )
      },
      {
        title: 'System Incident Escalation Metrics',
        content: (
          <div className="space-y-8">
             <h1 className="text-2xl font-bold text-[#2A2B4D] mb-4">System Incident Escalation Metrics</h1>
             <div className="overflow-hidden rounded-xl border border-slate-200">
               <table className="w-full text-sm text-left">
                 <thead className="bg-[#EEECF9] text-[#5B3DF8] font-bold">
                   <tr><th className="px-6 py-4">Incident Type</th><th className="px-6 py-4">	Escalation Trigger</th><th className="px-6 py-4">Action Required</th></tr>
                 </thead>
                 <tbody className="divide-y divide-slate-200">
                   <tr><td className="px-6 py-4 font-bold text-red-500">Guest Greeting Delay</td><td className="px-6 py-4">Over 30 seconds</td><td className="px-6 py-4">Notify Floor Manager</td></tr>
                   <tr><td className="px-6 py-4 font-bold text-orange-500">Drink Order Delay</td><td className="px-6 py-4">Over 2 minutes</td><td className="px-6 py-4">Server performance review</td></tr>
                   <tr><td className="px-6 py-4 font-bold text-yellow-500">Food Temperature Violation</td><td className="px-6 py-4">Outside safe range</td><td className="px-6 py-4">Immediate corrective action</td></tr>

                 </tbody>
               </table>
             </div>
          </div>
        )
      }
    ]
  },
  // {
  //   id: 'doc-2',
  //   name: 'Acme Q3 Sales Specs.docx',
  //   category: 'PRODUCT BROCHURE',
  //   icon: <Compass className="w-5 h-5 text-[#5B3DF8]" />,
  //   modules: [
  //     {
  //       title: 'Competitive Sales Battle Card',
  //       content: (
  //         <div className="space-y-8">
  //           <div>
  //              <h1 className="text-2xl font-bold text-[#2A2B4D] mb-4">Acme Q3 Competitive Battle Card</h1>
  //              <p className="text-slate-600">Positioning against competitors X and Y.</p>
  //           </div>
  //           <div className="bg-slate-50 border border-slate-200 p-6 rounded-xl">
  //              <h3 className="font-bold text-[#5B3DF8] mb-2 uppercase tracking-wider text-xs">Our Unique Value</h3>
  //              <p className="text-slate-700">Seamless integration with over 40+ HR systems natively, reducing setup time by 90%.</p>
  //           </div>
  //           <div className="bg-slate-50 border border-slate-200 p-6 rounded-xl">
  //              <h3 className="font-bold text-[#5B3DF8] mb-2 uppercase tracking-wider text-xs">Competitor FUD (Fear, Uncertainty, Doubt)</h3>
  //              <p className="text-slate-700">Competitor X locks you into a rigid ecosystem and requires custom APex code for simple triggers.</p>
  //           </div>
  //         </div>
  //       )
  //     },
  //     {
  //       title: 'Elevator & Long-Form Sales Pitch',
  //       content: (
  //         <div className="space-y-8">
  //            <h1 className="text-2xl font-bold text-[#2A2B4D] mb-4">Pitch Scripts</h1>
  //            <div className="space-y-4">
  //               <h3 className="font-bold text-lg text-slate-800">15-Second Elevator Pitch</h3>
  //               <p className="p-4 bg-[#F2EDFF] text-[#5B3DF8] rounded-xl italic font-medium">"Acme automates your entire knowledge base into actionable tools. Upload your sluggish manuals, and watch them become interactive checklists and playbooks instantly."</p>
  //            </div>
  //         </div>
  //       )
  //     }
  //   ]
  // }
];

export default function LucidToolsPage() {
  const router = useRouter()
 const {
  employeeData,
  loading
} = useAuth();

const userId = employeeData?.user_id;
const companyId = employeeData?.company_id;
  const [step, setStep] = useState<'upload' | 'generating' | 'results'>('upload')
  const [activeDocIndex, setActiveDocIndex] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState('')
  const [contextText, setContextText] = useState('')
  const [categories, setCategories] = useState<{ name: string }[]>([]);
  
  const activeDoc = MOCK_DOCUMENTS[activeDocIndex]
  const [selectedModule, setSelectedModule] = useState(activeDoc.modules[0].title)
  useEffect(() => {
    console.log("employeeData", employeeData)
  }, [employeeData])

  useEffect(() => {
    const fetchCategories = async () => {
      const { data, error } = await supabase
        .from('salestool_categories')
        .select('name');
      if (data) {
        setCategories(data);
      }
    };
    fetchCategories();
  }, []);

  const handleGenerate = async () => {
    console.log("employeeData:", employeeData);
    console.log("userId:", userId);
    console.log("companyId:", companyId);
    if (!file) {
      alert('Please select a file to upload.');
      return;
    }

    setStep('generating');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('contextText', contextText);
    console.log("Upload Request", {
        userId,
        companyId,
        employeeData
      });
    try {
      const response = await fetch('/api/lucid_tool_upload', {
        method: 'POST',
        headers: {
          'X-User-ID': String(userId),
          'X-Company-ID': String(companyId),
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(error);
        throw new Error('error');
        
      }
      

      const result = await response.json();
      console.log('Upload successful:', result);

      // Mocking the results view for now
      setTimeout(() => {
        setStep('results');
      }, 1000);
    } catch (error) {
      console.error('Error uploading file:', error);
      setStep('upload'); // Go back to upload step on error
      alert('File upload failed.');
    }
  }

  const handleViewHistory = (index: number) => {
    setActiveDocIndex(index);
    setSelectedModule(MOCK_DOCUMENTS[index].modules[0].title);
    setStep('results');
  }

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 font-sans text-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="text-slate-500 hover:text-slate-700">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-[#5B3DF8]" />
              <h1 className="text-2xl font-bold text-[#1E293B]">Lucid Tools</h1>
            </div>
            <p className="text-sm text-slate-500 font-mono mt-1">Enterprise Document Intelligence Hub & AI Toolkit Builder</p>
          </div>
        </div>
        {step === 'results' && (
          <Button onClick={() => setStep('upload')} className="bg-[#EEECF9] text-[#5B3DF8] hover:bg-[#E2DEFF] font-medium rounded-full px-6">
            Create New Toolkit
          </Button>
        )}
      </div>

      {step === 'upload' && (
        <div className="max-w-6xl mx-auto space-y-8">
          <Card className="border-0 shadow-sm rounded-2xl overflow-hidden bg-white">
            <CardContent className="p-8">
              <div className="flex items-center gap-2 mb-2">
                <FileUp className="w-5 h-5 text-[#5B3DF8]" />
                <h2 className="text-xl font-bold">Generate Your AI Toolkit</h2>
              </div>
              <p className="text-slate-500 text-sm mb-8">Upload a company manual, product specification, spreadsheet, or report to extract a full custom productivity suite.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Upload Area */}
                <div 
                  className="border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center p-12 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  onClick={() => document.getElementById('file-upload')?.click()}
                >
                  <input 
                    type="file" 
                    id="file-upload" 
                    className="hidden" 
                    onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} 
                  />
                  <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
                    <Upload className="w-5 h-5 text-[#5B3DF8]" />
                  </div>
                  <h3 className="font-semibold text-slate-700 mb-1">
                    {file ? file.name : <>Drag & Drop or <span className="text-[#5B3DF8] cursor-pointer">Click to Upload</span></>}
                  </h3>
                  <p className="text-xs text-slate-400">Supports PDF, TXT, DOCX</p>
                </div>

                {/* Form Area */}
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select a Document Category</label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger className="w-full bg-slate-50/50 border-slate-200 rounded-xl py-6">
                        <SelectValue placeholder="-- Choose Category --" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.name} value={cat.name}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fine-Tune Document Context (Optional)</label>
                      <span className="text-xs text-slate-400">{contextText.length} characters</span>
                    </div>
                    <Textarea 
                      placeholder="Enter explicit background details or copy-paste core reports elements here to refine generation accuracy..."
                      className="min-h-[140px] resize-none bg-slate-50/50 border-slate-200 rounded-xl"
                      value={contextText}
                      onChange={(e) => setContextText(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-8">
                <Button 
                  onClick={handleGenerate}
                  className="bg-[#F1F5F9] text-slate-400 font-semibold px-8 py-6 rounded-xl hover:bg-slate-200"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Tools
                </Button>
              </div>
            </CardContent>
          </Card>

          <div>
            <h2 className="text-2xl font-bold text-slate-800 mb-6">What Can You Build?</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-0 shadow-sm rounded-2xl hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-6">
                    <h3 className="font-bold text-[#5B3DF8] text-sm tracking-wider uppercase">SOP</h3>
                    <div className="w-8 h-8 rounded-full bg-[#F2EDFF] flex items-center justify-center">
                      <FileText className="w-4 h-4 text-[#5B3DF8]" />
                    </div>
                  </div>
                  <ul className="space-y-5">
                    {[
                      { title: 'Operation Execution Checklist', desc: 'Interactive standard operating procedure checklists complete with multi-phase gates and safety checkoffs.' },
                      { title: "Critical Do's and Don'ts", desc: 'Rigid compliance rules, safety matrices, positive/negative guidelines, and anti-pattern warnings.' },
                      { title: 'System Incident Escalation Metrics', desc: 'Structured severity index targets, multi-tier responder paths, and continuous quality timeline charts.' }
                    ].map((item, idx) => (
                      <li key={idx}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#5B3DF8]" />
                          <h4 className="font-bold text-slate-800 text-sm">{item.title}</h4>
                        </div>
                        <p className="text-sm text-slate-400 pl-3.5 leading-relaxed">{item.desc}</p>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 text-right">
                    <span className="text-[#5B3DF8] font-semibold text-sm">Click to select</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm rounded-2xl hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-6">
                    <h3 className="font-bold text-[#5B3DF8] text-sm tracking-wider uppercase">Product Brochure</h3>
                    <div className="w-8 h-8 rounded-full bg-[#F2EDFF] flex items-center justify-center">
                      <Compass className="w-4 h-4 text-[#5B3DF8]" />
                    </div>
                  </div>
                  <ul className="space-y-5">
                    {[
                      { title: 'Competitive Sales Battle Card', desc: 'Positioning hooks, competitor direct feature gaps, and strategic defensive argument pivots.' },
                      { title: "Elevator & Long-Form Sales Pitch", desc: 'Compelling core value scripts, dynamic opening hooks, and clear, high-converting client CTA flows.' },
                      { title: 'Objection Handling Playbook', desc: 'Actionable response playbooks targeting pricing friction, timelines, and change aversion objections.' }
                    ].map((item, idx) => (
                      <li key={idx}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#5B3DF8]" />
                          <h4 className="font-bold text-slate-800 text-sm">{item.title}</h4>
                        </div>
                        <p className="text-sm text-slate-400 pl-3.5 leading-relaxed">{item.desc}</p>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 text-right">
                    <span className="text-[#5B3DF8] font-semibold text-sm">Click to select</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="mt-12">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
              <Clock className="w-5 h-5 text-slate-400" />
              Recent Toolkits
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {MOCK_DOCUMENTS.map((doc, idx) => (
                <Card key={doc.id} className="border-slate-200 shadow-sm rounded-xl hover:border-[#5B3DF8] hover:shadow-md transition-all cursor-pointer" onClick={() => handleViewHistory(idx)}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-[#EEECF9] flex items-center justify-center">
                        {doc.icon}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-[#5B3DF8] uppercase tracking-wider mb-0.5">{doc.category}</div>
                        <h4 className="font-bold text-slate-800">{doc.name}</h4>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-slate-400 hover:text-[#5B3DF8]">
                      View Tools <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'generating' && (
        <div className="max-w-3xl mx-auto mt-20">
          <Card className="border-0 shadow-sm rounded-2xl py-20 px-8 text-center bg-white">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 border-4 border-[#EEECF9] rounded-full" />
              <div className="absolute inset-0 border-4 border-[#5B3DF8] rounded-full border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-[#5B3DF8]" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-3">Generating AI Toolkit</h2>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              Please wait while our enterprise NLP integration models summarize document contexts and build active modules.
            </p>
          </Card>
        </div>
      )}

      {step === 'results' && (
        <div className="max-w-7xl mx-auto space-y-6">
          <Card className="border-0 shadow-sm rounded-2xl bg-white">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#EEECF9] flex items-center justify-center">
                  {activeDoc.icon}
                </div>
                <div>
                  <div className="inline-block px-2 py-1 rounded bg-[#EEECF9] text-[#5B3DF8] text-[10px] font-bold tracking-wider mb-1">{activeDoc.category}</div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Lucid Tools for:</h2>
                    <span className="text-[#5B3DF8] font-semibold">{activeDoc.name}</span>
                  </div>
                </div>
              </div>
              <Button variant="outline" onClick={() => setStep('upload')} className="border-slate-200 text-slate-600 rounded-full px-6 bg-white hover:bg-slate-50">
                Upload Different File
              </Button>
            </CardContent>
          </Card>

          <div className="flex gap-6 items-start">
            <Card className="w-1/3 border-0 shadow-sm rounded-2xl bg-white shrink-0 sticky top-6">
              <CardContent className="p-6">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Generated Modules</h3>
                <div className="space-y-3">
                  {activeDoc.modules.map((mod) => (
                    <button
                      key={mod.title}
                      onClick={() => setSelectedModule(mod.title)}
                      className={`w-full flex items-center gap-3 p-4 rounded-xl text-left transition-colors ${
                        selectedModule === mod.title
                          ? 'bg-[#5B3DF8] text-white shadow-md' 
                          : 'bg-slate-50/50 hover:bg-slate-100 text-slate-700 font-semibold'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                        selectedModule === mod.title ? 'bg-white/20' : 'bg-white text-[#5B3DF8]'
                      }`}>T</div>
                      <span className="text-sm font-bold truncate">{mod.title}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-8 text-xs text-slate-400 text-center px-4">
                  Toggle between the generated assets to customize, review checkpoints, or export individual narrative summaries.
                </p>
              </CardContent>
            </Card>

            <Card className="flex-1 border-0 shadow-sm rounded-2xl bg-white min-h-[600px]">
              <CardContent className="p-8">
                <div className="flex justify-between items-start mb-10 pb-6 border-b border-slate-100">
                  <div>
                    <h3 className="text-[10px] font-bold text-[#5B3DF8] uppercase tracking-wider mb-2">OUTPUT WINDOW</h3>
                    <h2 className="text-2xl font-bold text-slate-800">{selectedModule}</h2>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" size="sm" className="rounded-full text-slate-600 border-slate-200">
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Text
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-full text-[#5B3DF8] border-slate-200">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Regenerate
                    </Button>
                  </div>
                </div>

                <div className="prose prose-slate max-w-none">
                  {activeDoc.modules.find(m => m.title === selectedModule)?.content}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
