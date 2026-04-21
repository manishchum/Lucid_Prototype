'use client'

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { supabaseAdmin as supabase } from "@/lib/supabase"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Download, Filter, FileSpreadsheet, CheckCircle2, XCircle, Settings, TrendingUp, Target } from "lucide-react"
import * as XLSX from 'xlsx'
import { useIllusionProgress } from "@/hooks/useIllusionProgress";
import { Alert, AlertDescription } from "@/components/ui/alert"

interface KPI {
  kpi_id: string
  name: string
  description: string
  formula?: string
  target: number
  weight: number
  department?: string
  function_id?: string
  sub_function_id?: string
  title_id?: string
  function?: {
    function_name: string
  }
  sub_function?: {
    sub_function_name: string
  }
  titles?: {
    title_name: string
  }
}

interface ParsedKPI {
  name: string
  definition: string
  formula: string
  target: string
  weight: string
  function: string
  sub_function: string
  title: string
}
type KPIUploadResult = {
    created?: number;
    updated?: number;
    skipped?: { row: number; reason: string }[];
  };
  

interface FunctionData {
  function_id: string
  function_name: string
}

interface SubFunctionData {
  sub_function_id: string
  sub_function_name: string
  function_id: string
}


interface Admin {
  user_id: string
  email: string
  name: string | null
  company_id: string
}
interface TitleData {
  title_id: string
  title_name: string
  sub_function_id: string
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchUserByEmail = async (email: string | null) => {
  if (!email) return null;
  try{
    const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
    if(!res.ok) return null;
    const payload = await res.json();
    let u = payload?.user ?? payload;
    if (Array.isArray(u)) u = u[0];
    return u || null;
  } catch (e){
    console.error("Error fetching user by email:", e);
    return null;
  }
};

function KPIScoresUpload({ companyId, admin }: { companyId?: string; admin?: Admin | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<string[][]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ created?: number; updated?: number; skipped?: { row: number; reason: string }[]; affectedEmployees?: string[] } | null>(null);
  const [error, setError] = useState("");

  // Parse file for preview
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setResult(null);
    setError("");
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (!f) return setPreview([]);
    try {
      const arrayBuffer = await f.arrayBuffer();
      if (f.name.endsWith(".csv")) {
        const text = new TextDecoder().decode(arrayBuffer);
        const rows = text.split(/\r?\n/).map(line => line.split(",").map(cell => cell.trim()));
        setPreview(rows.slice(0, 10));
      } else if (f.name.endsWith(".xlsx")) {
        // Dynamically import xlsx for preview
        const xlsx = await import("xlsx");
        const workbook = xlsx.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        setPreview((rows as string[][]).slice(0, 10));
      } else {
        setError("Unsupported file type. Only CSV or XLSX allowed.");
        setPreview([]);
      }
    } catch (err) {
      setError("Failed to parse file for preview.");
      setPreview([]);
    }
  };

  const handleUpload = async () => {
    if (!file || !companyId) return;
    setUploading(true);
    setResult(null);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      // For prototype, send companyId in header (never in prod)
      const res = await fetchWithAuth("/api/admin/kpi/upload-scores", {
        method: "POST",
        body: formData,
        headers: {
          "x-company-id": companyId,
          ...(admin?.user_id ? { "x-admin-id": admin.user_id } : {})
        },
      });
      console.log(res)
      const json = await res.json();
      console.log(json)
      if (!res.ok) {
        setError(json.error || "Upload failed");
      } else {
        setResult(json);
        // Reset file input after successful upload
        setFile(null);
        setPreview([]);
        setFileInputKey(prev => prev + 1);
      }
    } catch (err) {
      setError("Upload failed.");
      // Reset file input after failed upload
      setFile(null);
      setPreview([]);
      setFileInputKey(prev => prev + 1);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
        {/* <Input key={fileInputKey} type="file" accept=".csv,.xlsx" onChange={handleFileChange} />
        <Button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? "Uploading..." : "Upload"}
        </Button> */}
  <Card>

                  <div className="space-y-4">
                    <label
                      htmlFor="file-upload"
                      className="flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all duration-300"
                    >
                      <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-3">
                        <Upload className="w-8 h-8 text-blue-600" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">Click to upload Excel file</span>
                      <span className="text-xs text-gray-500 mt-1">Supported: .xlsx, .xls</span>
                      <span className="text-xs text-gray-500 mt-1 text-center">Refer to the predefined data fields in the<br/> template before uploading the data</span>
                    </label>
                    <Input
                      id="file-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                      </Card>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {preview.length > 0 && (
        <div className="mb-2">
          <div className="font-semibold mb-1">Preview (first 10 rows):</div>
          <table className="text-sm border">
            <tbody>
              {preview.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className="border px-2 py-1">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && (
        <div className="mt-2">
          <div className="font-semibold">Upload Result:</div>
          <div>Created: {result.created || 0}, Updated: {result.updated || 0}</div>
          {result.skipped && result.skipped.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
            </div>
          )}
          {result.affectedEmployees && (
            <div className="mt-1 text-xs text-gray-500">
              Affected Employees:
              <ul>
                {result.affectedEmployees.map((id, i) => <li key={i}>{id}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function KPIConfigurationPage() {
const router = useRouter()
const { user,loading:authLoading } = useAuth()
const [kpis, setKpis] = useState<KPI[]>([])
const [filteredKpis, setFilteredKpis] = useState<KPI[]>([])
const [loading, setLoading] = useState(true)
const [uploading, setUploading] = useState(false)
const [parsedData, setParsedData] = useState<ParsedKPI[]>([])
const [showPreview, setShowPreview] = useState(false)
const [companyId, setCompanyId] = useState<string>("")

  // Filter data from database
  const [functions, setFunctions] = useState<FunctionData[]>([])
  const [subFunctions, setSubFunctions] = useState<SubFunctionData[]>([])
  const [titles, setTitles] = useState<TitleData[]>([])
  
  // Filters
  const [functionFilter, setFunctionFilter] = useState("All")
  const [subFunctionFilter, setSubFunctionFilter] = useState("All")
  const [titleFilter, setTitleFilter] = useState("All")
  const [searchTerm, setSearchTerm] = useState("")
  const [admin, setAdmin] = useState<Admin | null>(null);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
  useEffect(() => {
        if (!authLoading) {
          if (!user) router.push("/login");
          else fetchAdminId();
          
        }
      }, [user, authLoading, router]);

  const fetchAdminId = async () => {
    try {
      if (!user?.email) return;
      const employeeData = await fetchUserByEmail(user.email);
      if (!employeeData){
        throw new Error("Admin user not found.")
      }

    fetchCompanyAndKPIs()
    fetchFilterData()

    } catch (error) {
      console.error("Error fetching admin data:", error)
    }
  }

  const fetchFilterData = async () => {
    try {
      // Fetch functions
      const { data: functionsData, error: functionsError } = await supabase
        .from("function")
        .select("function_id, function_name")
        .eq("is_active", true)
        .order("function_name")

      if (functionsError) throw functionsError
      setFunctions(functionsData || [])

      // Fetch sub_functions
      const { data: subFunctionsData, error: subFunctionsError } = await supabase
        .from("sub_function")
        .select("sub_function_id, sub_function_name, function_id")
        .eq("is_active", true)
        .order("sub_function_name")

      if (subFunctionsError) throw subFunctionsError
      setSubFunctions(subFunctionsData || [])

      // Fetch titles
      const { data: titlesData, error: titlesError } = await supabase
        .from("titles")
        .select("title_id, title_name, sub_function_id")
        .eq("is_active", true)
        .order("title_name")

      if (titlesError) throw titlesError
      setTitles(titlesData || [])
    } catch (error) {
      console.error("Error fetching filter data:", error)
    }
  }

  const fetchCompanyAndKPIs = async () => {
    try {
      setLoading(true)
      
      // Fetch user's company
      if(!user?.email) {
        setLoading(false);
        return;
      }
        
      const employeeData = await fetchUserByEmail(user.email);
      if (!employeeData?.company_id) {
        setLoading(false);
        return;
      }

      setCompanyId(employeeData.company_id)
      
      // Fetch KPIs for the company with related data
      const { data: kpiData, error: kpiError } = await supabase
        .from("kpis")
        .select(`
          *,
          function:function_id (function_name),
          sub_function:sub_function_id (sub_function_name),
          titles:title_id (title_name)
        `)
        .eq("company_id", employeeData.company_id)
        .order("created_at", { ascending: false })

      if (kpiError) throw kpiError
      
      setKpis(kpiData || [])
      setFilteredKpis(kpiData || [])
    } catch (error) {
      console.error("Error fetching data:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[]

        const parsed: ParsedKPI[] = jsonData.map((row) => ({
          name: row['KPI Name'] || row['name'] || '',
          definition: row['Definition'] || row['definition'] || '',
          formula: row['Formula'] || row['formula'] || '',
          target: row['Target'] || row['target'] || '',
          weight: row['Weight %'] || row['weight'] || row['Weight'] || '',
          function: row['Function'] || row['function'] || '',
          sub_function: row['Sub Function'] || row['sub_function'] || row['Sub-Function'] || '',
          title: row['Title'] || row['title'] || ''
        }))

        setParsedData(parsed)
        setShowPreview(true)
      } catch (error) {
        console.error("Error parsing Excel file:", error)
        alert("Error parsing Excel file. Please check the format.")
      }
    }
    reader.readAsBinaryString(file)
  }

  const findOrCreateFunction = async (functionName: string): Promise<string | null> => {
    if (!functionName) return null

    try {
      // Check if function exists
      const { data: existingFunction, error: searchError } = await supabase
        .from("function")
        .select("function_id")
        .ilike("function_name", functionName)
        .single()

      if (existingFunction) {
        return existingFunction.function_id
      }

      // Create new function
      const { data: newFunction, error: createError } = await supabase
        .from("function")
        .insert({ function_name: functionName, is_active: true })
        .select("function_id")
        .single()

      if (createError) throw createError
      return newFunction.function_id
    } catch (error) {
      console.error("Error finding/creating function:", error)
      return null
    }
  }

  const findOrCreateSubFunction = async (subFunctionName: string, functionId: string): Promise<string | null> => {
    if (!subFunctionName || !functionId) return null

    try {
      // Check if sub_function exists
      const { data: existingSubFunction, error: searchError } = await supabase
        .from("sub_function")
        .select("sub_function_id")
        .ilike("sub_function_name", subFunctionName)
        .eq("function_id", functionId)
        .single()

      if (existingSubFunction) {
        return existingSubFunction.sub_function_id
      }

      // Create new sub_function
      const { data: newSubFunction, error: createError } = await supabase
        .from("sub_function")
        .insert({ 
          sub_function_name: subFunctionName, 
          function_id: functionId,
          is_active: true 
        })
        .select("sub_function_id")
        .single()

      if (createError) throw createError
      return newSubFunction.sub_function_id
    } catch (error) {
      console.error("Error finding/creating sub_function:", error)
      return null
    }
  }

  const findOrCreateTitle = async (titleName: string, subFunctionId: string): Promise<string | null> => {
    if (!titleName || !subFunctionId) return null

    try {
      // Check if title exists
      const { data: existingTitle, error: searchError } = await supabase
        .from("titles")
        .select("title_id")
        .ilike("title_name", titleName)
        .eq("sub_function_id", subFunctionId)
        .single()

      if (existingTitle) {
        return existingTitle.title_id
      }

      // Create new title
      const { data: newTitle, error: createError } = await supabase
        .from("titles")
        .insert({ 
          title_name: titleName, 
          sub_function_id: subFunctionId,
          is_active: true 
        })
        .select("title_id")
        .single()

      if (createError) throw createError
      return newTitle.title_id
    } catch (error) {
      console.error("Error finding/creating title:", error)
      return null
    }
  }

  const handleUploadToDatabase = async () => {
    if (!companyId || parsedData.length === 0) return

    try {
      setUploading(true)
      
      const kpisToInsert = []

      for (const kpi of parsedData) {
        // Find or create function, sub_function, and title
        const functionId = await findOrCreateFunction(kpi.function)
        const subFunctionId = functionId ? await findOrCreateSubFunction(kpi.sub_function, functionId) : null
        const titleId = subFunctionId ? await findOrCreateTitle(kpi.title, subFunctionId) : null

        kpisToInsert.push({
          company_id: companyId,
          name: kpi.name,
          description: `${kpi.definition}\n\nFormula: ${kpi.formula}`,
          target: parseFloat(kpi.target) || 0,
          weight: parseFloat(kpi.weight) || 0,
          function_id: functionId,
          sub_function_id: subFunctionId,
          title_id: titleId,
          datatype: 'percentage',
          created_at: new Date().toISOString()
        })
      }

      const { error } = await supabase
        .from("kpis")
        .insert(kpisToInsert)

      if (error) throw error

      alert(`Successfully uploaded ${parsedData.length} KPIs!`)
      setShowPreview(false)
      setParsedData([])
      await fetchCompanyAndKPIs()
      await fetchFilterData() // Refresh filter data
    } catch (error) {
      console.error("Error uploading KPIs:", error)
      alert("Error uploading KPIs to database.")
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadTemplate = () => {
    const template = [
      {
        'KPI Name': 'Effective Coverage (ECO)',
        'Definition': 'Percentage of total outlets in the beat plan that were successfully billed.',
        'Formula': 'f(x) = (Billed Outlets / Total Scheduled Outlets) * 100',
        'Target': '85',
        'Weight %': '30',
        'Function': 'Sales',
        'Sub Function': 'Field Sales',
        'Title': 'Sales Executive'
      },
      {
        'KPI Name': 'Lines Per Call (LPC)',
        'Definition': 'Average number of distinct SKU lines sold per successful productive call.',
        'Formula': 'f(x) = Total Lines Sold / Total Productive Calls',
        'Target': '5.5',
        'Weight %': '25',
        'Function': 'Sales',
        'Sub Function': 'Field Sales',
        'Title': 'Sales Manager'
      }
    ]

    const ws = XLSX.utils.json_to_sheet(template)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "KPI Template")
    XLSX.writeFile(wb, "KPI_Upload_Template.xlsx")
  }

  const handleExportExcel = () => {
    if (filteredKpis.length === 0) return;

    // Prepare data for export
    const exportData = filteredKpis.map((kpi, index) => ({
      '#': index + 1,
      'KPI Name': kpi.name,
      'Definition': kpi.description?.split('\n\n')[0] || '',
      'Formula': kpi.description?.includes('Formula:') 
        ? kpi.description.split('Formula:')[1]?.trim() 
        : 'N/A',
      'Target': kpi.target || 0,
      'Weight %': kpi.weight || 0,
      'Function': kpi.function?.function_name || '-',
      'Sub Function': kpi.sub_function?.sub_function_name || '-',
      'Title': kpi.titles?.title_name || '-',
      'Data Type':  'percentage',
      'Created At': new Date().toLocaleDateString()
    }));

    // Create summary data
    const summaryData = [
      { 'Field': 'Total KPIs', 'Value': filteredKpis.length },
      { 'Field': 'Export Date', 'Value': new Date().toLocaleString() },
      { 'Field': 'Filters Applied', 'Value': `Function: ${functionFilter === 'All' ? 'All' : functions.find(f => f.function_id === functionFilter)?.function_name || 'N/A'}, Sub-Function: ${subFunctionFilter === 'All' ? 'All' : subFunctions.find(sf => sf.sub_function_id === subFunctionFilter)?.sub_function_name || 'N/A'}, Title: ${titleFilter === 'All' ? 'All' : titles.find(t => t.title_id === titleFilter)?.title_name || 'N/A'}` }
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    const wsKPIs = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, wsKPIs, 'KPIs');
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    
    // Generate filename
    const filename = `KPI_Configuration_Export_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);
  };

  const applyFilters = useCallback(() => {
    let filtered = [...kpis]

    if (functionFilter !== "All") {
      filtered = filtered.filter(k => k.function_id === functionFilter)
    }
    if (subFunctionFilter !== "All") {
      filtered = filtered.filter(k => k.sub_function_id === subFunctionFilter)
    }
    if (titleFilter !== "All") {
      filtered = filtered.filter(k => k.title_id === titleFilter)
    }
    if (searchTerm) {
      filtered = filtered.filter(k => 
        k.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        k.description?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    setFilteredKpis(filtered)
  }, [kpis, functionFilter, subFunctionFilter, titleFilter, searchTerm])

  useEffect(() => {
    applyFilters()
  }, [applyFilters])

  // Filter sub-functions based on selected function
  const filteredSubFunctions = functionFilter !== "All" 
    ? subFunctions.filter(sf => sf.function_id === functionFilter)
    : subFunctions

  // Filter titles based on selected sub-function
  const filteredTitles = subFunctionFilter !== "All"
    ? titles.filter(t => t.sub_function_id === subFunctionFilter)
    : titles

  if (loading) {
    return (
      showLoadingProgress
        ? <LoadingProgress label="Loading KPI configuration..." progress={loadingProgress} />
        : (
          <div className="flex min-h-screen bg-gray-50">
            <main className="flex-1 transition-all duration-300 p-8">
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              </div>
            </main>
          </div>
        )
    )
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">KPI Configuration</h1>
          <p className="text-gray-600 mt-1">Manage and upload Key Performance Indicators for your organization.</p>
        </header>

        <main>
          {/* Filter and Search Section */}
          <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
            <div className="w-full md:w-auto">
              <Input
                placeholder="Search KPIs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <div className="flex-grow" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full md:w-auto">
              <Select value={functionFilter} onValueChange={setFunctionFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Functions</SelectItem>
                  {functions.map(f => <SelectItem key={f.function_id} value={f.function_id}>{f.function_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={subFunctionFilter} onValueChange={setSubFunctionFilter} disabled={functionFilter === "All"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sub-Functions</SelectItem>
                  {subFunctions.filter(sf => sf.function_id === functionFilter).map(sf => <SelectItem key={sf.sub_function_id} value={sf.sub_function_id}>{sf.sub_function_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={titleFilter} onValueChange={setTitleFilter} disabled={subFunctionFilter === "All"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Titles</SelectItem>
                  {titles.filter(t => t.sub_function_id === subFunctionFilter).map(t => <SelectItem key={t.title_id} value={t.title_id}>{t.title_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>KPIs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weight</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Function</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Sub-Function</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Title</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredKpis.map((kpi) => (
                          <tr key={kpi.kpi_id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{kpi.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{kpi.target}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{kpi.weight}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">{kpi.function?.function_name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">{kpi.sub_function?.sub_function_name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">{kpi.titles?.title_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Upload KPIs</CardTitle>
                  <CardDescription>Bulk upload KPIs from an Excel file.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <label
                      htmlFor="kpi-upload"
                      className="flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all duration-300"
                    >
                      <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-3">
                        <Upload className="w-8 h-8 text-blue-600" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">Click to upload Excel file</span>
                      <span className="text-xs text-gray-500 mt-1">Supported: .xlsx, .xls</span>
                    </label>
                    <Input
                      id="kpi-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <Button onClick={handleUploadToDatabase} disabled={uploading || parsedData.length === 0} className="w-full">
                      {uploading ? "Uploading..." : "Upload to Database"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Upload KPI Scores</CardTitle>
                  <CardDescription>Upload employee scores for existing KPIs.</CardDescription>
                </CardHeader>
                <CardContent>
                  <KPIScoresUpload companyId={companyId} admin={admin} />
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
      </div>
    );
  }
  
  // function useIllusionProgress(active: boolean) {
  //   const [progress, setProgress] = useState(12);
  //   const [show, setShow] = useState(active);
  
  //   useEffect(() => {
  //     if (!active) {
  //       setProgress(100);
  //       const timeout = setTimeout(() => setShow(false), 180);
  //       return () => clearTimeout(timeout);
  //     }
  
  //     setShow(true);
  //     setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));
  
  //     const id = setInterval(() => {
  //       setProgress((prev) => {
  //         const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
  //         if (shouldHold) return prev; // create a brief stall so progress looks more natural
  //         const increment = Math.max(1, Math.round(Math.random() * 7));
  //         return Math.min(prev + increment, 93);
  //       });
  //     }, 420 + Math.round(Math.random() * 240));
  
  //     return () => clearInterval(id);
  //   }, [active]);
  
  //   return { progress: Math.min(progress, 100), show };
  // }
  
  function LoadingProgress({ label, progress }: { label: string; progress: number }) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
          <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
            <span>{label}</span>
            <span className="text-slate-900 text-base font-black">{progress}%</span>
          </div>
          <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 font-medium">We are personalizing your experience. This will only take a moment.</p>
        </div>
      </div>
    );
  }
  

