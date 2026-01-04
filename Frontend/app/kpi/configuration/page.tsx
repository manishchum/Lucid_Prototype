'use client'

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import EmployeeNavigation from "@/components/employee-navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Download, Filter, FileSpreadsheet, CheckCircle2, XCircle, Settings, Search, TrendingUp, Target } from "lucide-react"
import * as XLSX from 'xlsx'

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

interface FunctionData {
  function_id: string
  function_name: string
}

interface SubFunctionData {
  sub_function_id: string
  sub_function_name: string
  function_id: string
}

interface TitleData {
  title_id: string
  title_name: string
  sub_function_id: string
}

export default function KPIConfigurationPage() {
  const router = useRouter()
  const { user } = useAuth()
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

  useEffect(() => {
    setTimeout(() => {
    // console.log(user)
    if (!user) {
      router.push("/")
      return
    }
}, 200);
    fetchCompanyAndKPIs()
    fetchFilterData()
  }, [user, router])

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
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("company_id")
        .eq("email", user?.email)
        .single()

      if (userError) throw userError
      
      if (userData?.company_id) {
        setCompanyId(userData.company_id)
        
        // Fetch KPIs for the company with related data
        const { data: kpiData, error: kpiError } = await supabase
          .from("kpis")
          .select(`
            *,
            function:function_id (function_name),
            sub_function:sub_function_id (sub_function_name),
            titles:title_id (title_name)
          `)
          .eq("company_id", userData.company_id)
          .order("created_at", { ascending: false })

        if (kpiError) throw kpiError
        
        setKpis(kpiData || [])
        setFilteredKpis(kpiData || [])
      }
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
    // console.log(XLSX)
    // Add Summary sheet
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    // console.log(wsSummary)
    // Add KPIs sheet
    
    // console.log("This is the data in the KPI sheet:")
    // console.log(wsKPIs)
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
      <div className="flex min-h-screen bg-gray-50">
        <EmployeeNavigation />
        <main className="flex-1 lg:ml-72 transition-all duration-300 p-8">
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <EmployeeNavigation />
      <main className="flex-1 lg:ml-72 transition-all duration-300 p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">KPI Configuration</h1>
            <p className="text-gray-600 mt-1">Configure role-based success metrics and upload definitions via Excel</p>
          </div>

          {/* Upload Section */}
          {!showPreview && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-2 border-dashed border-gray-300 hover:border-blue-400 transition-all duration-300 p-10 bg-white">
                <div className="flex flex-col items-center justify-center text-center space-y-6">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-2xl bg-blue-50 flex items-center justify-center border-2 border-blue-200">
                      <FileSpreadsheet className="w-12 h-12 text-blue-600" />
                    </div>
                    <div className="absolute -top-2 -right-2 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                      <Upload className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Drag & Drop Excel File</h3>
                    <p className="text-sm text-gray-600">
                      or <label htmlFor="file-upload" className="text-blue-600 cursor-pointer hover:text-blue-700 font-semibold underline">browse</label> to upload
                    </p>
                  </div>
                  <Input
                    id="file-upload"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    onClick={handleDownloadTemplate}
                    variant="outline"
                    className="mt-4 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-blue-500 transition-all duration-300"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Template
                  </Button>
                  <div className="pt-4 text-xs text-gray-500">
                    Supported formats: .xlsx, .xls • Max size: 5MB
                  </div>
                </div>
              </Card>

              <Card className="border border-gray-200 p-8 bg-white shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <FileSpreadsheet className="w-5 h-5 text-purple-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Required Columns</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { name: 'KPI Name', icon: 'K', color: 'blue' },
                    { name: 'Definition', icon: 'D', color: 'purple' },
                    { name: 'Formula', icon: 'F', color: 'pink' },
                    { name: 'Target', icon: 'T', color: 'green' },
                    { name: 'Weight %', icon: 'W', color: 'orange' },
                    { name: 'Function', icon: 'F', color: 'indigo' },
                    { name: 'Sub Function', icon: 'S', color: 'cyan' },
                    { name: 'Title', icon: 'T', color: 'violet' }
                  ].map((col) => (
                    <div key={col.name} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition-all">
                      <div className={`w-8 h-8 rounded-lg bg-${col.color}-100 flex items-center justify-center border border-${col.color}-200`}>
                        <span className="text-sm font-bold text-${col.color}-600">{col.icon}</span>
                      </div>
                      <span className="text-sm font-medium text-gray-700">{col.name}</span>
                      <div className="ml-auto">
                        <CheckCircle2 className={`w-4 h-4 text-${col.color}-500`} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Preview Section */}
          {showPreview && (
            <Card className="border border-gray-200 p-8 bg-white shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">Preview Uploaded Data</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      <span className="text-blue-600 font-semibold">{parsedData.length}</span> KPIs ready to upload to database
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      setShowPreview(false)
                      setParsedData([])
                    }}
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-red-500 transition-all"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleUploadToDatabase}
                    disabled={uploading}
                    className="bg-blue-600 hover:bg-blue-700 text-white transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {uploading ? 'Uploading...' : 'Upload to Database'}
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">KPI Name</th>
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">Definition</th>
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">Formula</th>
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">Target</th>
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">Weight %</th>
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">Function</th>
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">Sub Function</th>
                      <th className="text-left py-4 px-6 text-sm font-bold text-gray-700">Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((kpi, index) => (
                      <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6 text-sm text-gray-900 font-semibold">{kpi.name}</td>
                        <td className="py-4 px-6 text-sm text-gray-700 max-w-md">{kpi.definition}</td>
                        <td className="py-4 px-6 text-xs text-blue-600 font-mono bg-blue-50 rounded">{kpi.formula}</td>
                        <td className="py-4 px-6 text-sm text-green-600 font-semibold">{kpi.target}</td>
                        <td className="py-4 px-6 text-sm text-purple-600 font-semibold">{kpi.weight}%</td>
                        <td className="py-4 px-6 text-sm text-gray-700">{kpi.function || '-'}</td>
                        <td className="py-4 px-6 text-sm text-gray-700">{kpi.sub_function || '-'}</td>
                        <td className="py-4 px-6 text-sm text-gray-700">{kpi.title || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Filters and Library View */}
          {!showPreview && (
            <>
              <Card className="border border-gray-200 p-8 bg-white shadow-sm">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Filter className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Filter Scope</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Function</label>
                    <Select value={functionFilter} onValueChange={(value) => {
                      setFunctionFilter(value)
                      setSubFunctionFilter("All")
                      setTitleFilter("All")
                    }}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900 hover:border-blue-500 transition-all">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="All">All Functions</SelectItem>
                        {functions.map((func) => (
                          <SelectItem key={func.function_id} value={func.function_id}>
                            {func.function_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Sub-Function</label>
                    <Select 
                      value={subFunctionFilter} 
                      onValueChange={(value) => {
                        setSubFunctionFilter(value)
                        setTitleFilter("All")
                      }}
                      disabled={functionFilter === "All"}
                    >
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900 hover:border-blue-500 transition-all disabled:opacity-50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="All">All Sub-Functions</SelectItem>
                        {filteredSubFunctions.map((subFunc) => (
                          <SelectItem key={subFunc.sub_function_id} value={subFunc.sub_function_id}>
                            {subFunc.sub_function_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Title</label>
                    <Select 
                      value={titleFilter} 
                      onValueChange={setTitleFilter}
                      disabled={subFunctionFilter === "All"}
                    >
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900 hover:border-blue-500 transition-all disabled:opacity-50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="All">All Titles</SelectItem>
                        {filteredTitles.map((title) => (
                          <SelectItem key={title.title_id} value={title.title_id}>
                            {title.title_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              {/* KPI Library */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Settings className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Library View: Consolidated</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      <span className="text-blue-600 font-semibold">{filteredKpis.length}</span> Metrics Available
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={handleExportExcel}
                  disabled={filteredKpis.length === 0}
                  variant="outline" 
                  className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-green-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export Excel
                </Button>
              </div>

              {/* KPI Grid */}
              <div className="space-y-5">
                {filteredKpis.map((kpi) => (
                  <Card key={kpi.kpi_id} className="border border-gray-200 p-8 bg-white hover:border-blue-400 hover:shadow-lg transition-all duration-300">
                    <div className="grid grid-cols-12 gap-8 items-center">
                      <div className="col-span-3">
                        <div className="space-y-3">
                          <h3 className="text-xl font-bold text-gray-900">{kpi.name}</h3>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200">
                              ID: {kpi.kpi_id.slice(0, 8)}
                            </span>
                            {kpi.function && (
                              <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold border border-indigo-200">
                                {kpi.function.function_name}
                              </span>
                            )}
                            {kpi.sub_function && (
                              <span className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-lg text-xs font-semibold border border-cyan-200">
                                {kpi.sub_function.sub_function_name}
                              </span>
                            )}
                            {kpi.titles && (
                              <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-semibold flex items-center gap-1 border border-purple-200">
                                <Settings className="w-3 h-3" />
                                {kpi.titles.title_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="col-span-5">
                        <div className="space-y-3">
                          <p className="text-sm text-gray-700 leading-relaxed">{kpi.description?.split('\n\n')[0]}</p>
                          {kpi.description?.includes('Formula:') && (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                              <div className="text-xs text-gray-600 mb-1 font-semibold">Formula:</div>
                              <code className="text-xs text-blue-600 font-mono">
                                {kpi.description.split('Formula:')[1]?.trim()}
                              </code>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="col-span-2 flex items-center justify-center">
                        <div className="relative w-28 h-28">
                          <svg className="w-28 h-28 transform -rotate-90">
                            <circle
                              cx="56"
                              cy="56"
                              r="48"
                              stroke="currentColor"
                              strokeWidth="10"
                              fill="none"
                              className="text-gray-200"
                            />
                            <circle
                              cx="56"
                              cy="56"
                              r="48"
                              stroke="url(#gradient)"
                              strokeWidth="10"
                              fill="none"
                              strokeDasharray={`${(kpi.weight || 0) * 3.01} 301`}
                              className="transition-all duration-500"
                            />
                          </svg>
                          <defs>
                            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="#3b82f6" />
                              <stop offset="100%" stopColor="#8b5cf6" />
                            </linearGradient>
                          </defs>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-bold text-gray-900">{kpi.weight || 0}%</span>
                            <span className="text-xs text-gray-600">Weight</span>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-2">
                        <div className="flex flex-col items-center justify-center p-6 bg-green-50 rounded-xl border border-green-200">
                          <Target className="w-6 h-6 text-green-600 mb-2" />
                          <div className="text-3xl font-bold text-gray-900">{kpi.target}%</div>
                          <div className="text-xs text-gray-600 mt-1">Target</div>
                          <div className="text-xs text-green-600 mt-2">Avg: {Math.floor(kpi.target * 0.85)}%</div>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}

                {filteredKpis.length === 0 && (
                  <Card className="border border-gray-200 p-16 bg-white shadow-sm">
                    <div className="text-center">
                      <div className="w-24 h-24 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-6">
                        <FileSpreadsheet className="w-12 h-12 text-gray-400" />
                      </div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-3">No KPIs Found</h3>
                      <p className="text-gray-600 mb-6">Upload an Excel file to get started or adjust your filters.</p>
                      <Button
                        onClick={() => document.getElementById('file-upload')?.click()}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Upload KPIs
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
