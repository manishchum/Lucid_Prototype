"use client";

import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import {
  Upload,
  Folder,
  FileText,
  FileImage,
  FileAudio,
  FileVideo,
  File,
  Search,
  ChevronRight,
  ArrowLeft,
  X,
  Loader2,
  Trash2,
  Download
} from "lucide-react";
import { toast } from "sonner";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "";

type Category = {
  id: string;
  name: string;
};

type ContentItem = {
  id: string;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  file_size: number;
  category_id: string;
  created_at: string;
};

export default function AdminContentLibrary() {
  const { user, loading: authLoading, isAdmin, isSuperAdmin, isManager, isDeveloper } = useAuth();
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState("");
  
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);

  // Upload Mode State
  const [isUploadMode, setIsUploadMode] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadCategoryId, setUploadCategoryId] = useState("");

  const hasUploadAccess = isAdmin || isSuperAdmin || isManager || isDeveloper;

  useEffect(() => {
    if (!authLoading && user) {
      loadCategories();
      loadItems(null);
    }
  }, [user, authLoading]);

  const loadCategories = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/content-library/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.data || []);
      }
    } catch (e) {
      console.error("Failed to load categories", e);
    }
  };

  const loadItems = async (categoryId: string | null) => {
    setLoading(true);
    try {
      // Fetch all items to count them for folders
      const res = await fetchWithAuth(`${API_BASE}/api/content-library/items`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.data || []);
      }
    } catch (e) {
      console.error("Failed to load items", e);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadFile) {
      toast.error("Please select a file first.");
      return;
    }
    
    if (!uploadCategoryId) {
      toast.error("Please select a Target Category.");
      return;
    }

    if (!uploadTitle.trim()) {
      toast.error("Please provide a title.");
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("category_id", uploadCategoryId);
    formData.append("title", uploadTitle);
    formData.append("description", uploadDescription);
    
    setIsUploading(true);
    toast.info("Publishing asset...");

    try {
      const res = await fetchWithAuth(`${API_BASE}/api/content-library/upload`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        toast.success("Asset published successfully!");
        setUploadFile(null);
        setUploadTitle("");
        setUploadDescription("");
        setUploadCategoryId("");
        setIsUploadMode(false);
        loadItems(null);
      } else {
        const err = await res.json();
        toast.error(`Publish failed: ${err.detail || "Unknown error"}`);
      }
    } catch (error) {
      toast.error("Publish failed due to network error");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      // Check for 50MB limit
      const MAX_SIZE = 50 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        const exceededBy = (file.size - MAX_SIZE) / (1024 * 1024);
        toast.error(`Upload failed: File exceeds the 50 MB limit by ${exceededBy.toFixed(2)} MB.`, {
          style: { background: '#EF4444', color: 'white', border: 'none' }
        });
        if (e.target) e.target.value = "";
        return;
      }

      setUploadFile(file);
      
      // Auto-fill title with filename without extension if title is empty
      if (!uploadTitle) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setUploadTitle(nameWithoutExt);
      }
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!confirm("Are you sure you want to delete this file?")) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/content-library/items/${itemId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        toast.success("File deleted");
        setItems(items.filter(i => i.id !== itemId));
        setSelectedItem(null);
      } else {
        toast.error("Failed to delete file");
      }
    } catch (e) {
      toast.error("Failed to delete file");
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <FileImage className="w-5 h-5 text-blue-500" />;
    if (mimeType.startsWith('audio/')) return <FileAudio className="w-5 h-5 text-purple-500" />;
    if (mimeType.startsWith('video/')) return <FileVideo className="w-5 h-5 text-red-500" />;
    if (mimeType.includes('pdf')) return <FileText className="w-5 h-5 text-red-500" />;
    if (mimeType.includes('document') || mimeType.includes('msword')) return <FileText className="w-5 h-5 text-blue-600" />;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return <FileText className="w-5 h-5 text-green-600" />;
    return <File className="w-5 h-5 text-slate-500" />;
  };

  if (authLoading) return <div className="p-8 flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  // Filter items based on active category and search
  let displayedItems = items;
  if (activeCategory) {
    displayedItems = displayedItems.filter(i => i.category_id === activeCategory);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    displayedItems = displayedItems.filter(i => i.title.toLowerCase().includes(q) || (i.description && i.description.toLowerCase().includes(q)));
  }

  // Count items per category
  const getCategoryCount = (catId: string) => {
    return items.filter(i => i.category_id === catId).length;
  };

  const activeCategoryObj = categories.find(c => c.id === activeCategory);

  if (isUploadMode) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] pb-20">
        <div className="max-w-6xl mx-auto px-6 pt-10">
          
          {/* Header */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm mb-6 flex justify-between items-center">
            <div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setIsUploadMode(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-500 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Resource Management Deck</h2>
              </div>
              <p className="text-slate-500 text-sm mt-1 max-w-xl ml-12">Publish internal handbooks, design assets, and communications under specific corporate category.</p>
            </div>
          </div>

          {/* Sub Header */}
          {/* <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Resource Management Deck</h2>
              <p className="text-slate-500 text-sm mt-1 max-w-xl">Publish internal handbooks, design assets, and communications under specific corporate category.</p>
            </div>
            <button className="bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 transition-colors border border-blue-100">
              <Folder className="w-4 h-4" />
              Create New Channel
            </button>
          </div> */}
          {/* Upload Area */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            
            {!uploadFile ? (
              <div 
                className="border-2 border-dashed border-blue-300 rounded-2xl bg-[#FAFCFF] p-16 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-blue-50/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    const MAX_SIZE = 50 * 1024 * 1024;
                    if (file.size > MAX_SIZE) {
                      const exceededBy = (file.size - MAX_SIZE) / (1024 * 1024);
                      toast.error(`Upload failed: File exceeds the 50 MB limit by ${exceededBy.toFixed(2)} MB.`, {
                        style: { background: '#EF4444', color: 'white', border: 'none' }
                      });
                      return;
                    }
                    setUploadFile(file);
                    if (!uploadTitle) {
                      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
                      setUploadTitle(nameWithoutExt);
                    }
                  }
                }}
              >
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 mb-6">
                  <Upload className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Drag & drop files here to upload</h3>
                <p className="text-slate-400 text-sm mb-2 max-w-md">Support PDFs, DOCs, TXT, images (PNG, JPEG), audio logs (MP3, WAV), corporate reels, and ZIP packets.</p>
                <p className="text-blue-500 font-bold text-sm mb-8">File uploaded should be less than 50 MB only.</p>
                <button className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-6 py-2.5 rounded-xl text-sm transition-colors">
                  Choose File
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="hidden" 
                  onChange={handleFileSelect}
                />
              </div>
            ) : (
              <div className="space-y-6">
                {/* File Card */}
                <div className="bg-[#FAFCFF] border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100">
                      {getFileIcon(uploadFile.type || 'document')}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 truncate max-w-md">{uploadFile.name}</h4>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                        {(uploadFile.size / 1024).toFixed(1)} KB • {uploadFile.type || 'UNKNOWN FORMAT'}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setUploadFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-slate-400 hover:text-red-500 font-medium text-sm transition-colors mr-2"
                  >
                    Remove
                  </button>
                </div>

                {/* Form Fields */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Resource Hub Title</label>
                  <input 
                    type="text" 
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Description / Purpose</label>
                  <textarea 
                    value={uploadDescription}
                    onChange={(e) => setUploadDescription(e.target.value)}
                    placeholder="Briefly state what this asset contains, its usage constraints, and key contact details..."
                    rows={4}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium text-slate-900 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Target Category (Publish Location)</label>
                    <select 
                      value={uploadCategoryId}
                      onChange={(e) => setUploadCategoryId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium text-slate-900 appearance-none"
                    >
                      <option value="" disabled>Select a category...</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}># {c.name.toLowerCase()}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Publishing Author Name</label>
                    <input 
                      type="text" 
                      defaultValue={user?.email?.split('@')[0] || "Admin"}
                      readOnly
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none text-slate-500 font-medium cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-slate-100">
                  <button 
                    onClick={() => {
                      setUploadFile(null);
                      setUploadTitle("");
                      setUploadDescription("");
                      setUploadCategoryId("");
                    }}
                    className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Clear File
                  </button>
                  <button 
                    onClick={handleFileUpload}
                    disabled={isUploading}
                    className="px-6 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 transition-colors shadow-sm flex items-center gap-2"
                  >
                    {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                    Publish Asset to Category
                  </button>
                </div>
                
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-20">
      
      {/* Top Header Area */}
      <div className="max-w-6xl mx-auto px-6 pt-10">
        
        {/* Banner */}
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Corporate Workspace Directory</h1>
            <p className="text-slate-500 mt-2 text-sm font-medium">Comprehensive Directory Of Internal Resources. Filter Categories From The Sidebar Or Select A Category Below.</p>
          </div>
          {hasUploadAccess && (
            <button 
              onClick={() => setIsUploadMode(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-sm text-sm"
            >
              <Upload className="w-4 h-4" />
              Upload Asset
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search courses, folders or topics..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl py-4 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-700 shadow-sm placeholder:text-slate-400"
          />
        </div>

        {/* Main Content */}
        {!activeCategory ? (
          // DIRECTORY VIEW
          <div>
            <div className="flex justify-between items-end mb-2">
              {/* <div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Corporate Workspace Directory</h2>
                <p className="text-slate-500 text-sm mt-1">Comprehensive directory of internal resources. Filter categories from the sidebar or select a category below.</p>
              </div> */}
              
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 tracking-wider">SORT BY:</span>
                <select className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 outline-none bg-white">
                  <option>Newest</option>
                  <option>A-Z</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {/* Categories as Folders */}
                {categories.map((cat) => {
                  const count = getCategoryCount(cat.id);
                  return (
                    <div 
                      key={cat.id} 
                      onClick={() => setActiveCategory(cat.id)}
                      className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                          <Folder className="w-6 h-6 text-blue-600 fill-blue-100/50" strokeWidth={1.5} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 text-lg group-hover:text-blue-700 transition-colors">{cat.name}</h3>
                          <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">{count} ITEM{count !== 1 && 'S'}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                  );
                })}

                {categories.length === 0 && !loading && (
                  <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white">
                    <p className="text-slate-500">No categories found in the workspace.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          // INSIDE A FOLDER
          <div>
            <div className="flex items-center justify-between mb-8">
              <button 
                onClick={() => setActiveCategory(null)}
                className="flex items-center gap-3 text-slate-800 hover:text-blue-600 transition-colors group"
              >
                <div className="w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center group-hover:border-blue-200 group-hover:bg-blue-50 transition-all shadow-sm">
                  <ArrowLeft className="w-5 h-5" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">{activeCategoryObj?.name || 'Folder'}</h2>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{getCategoryCount(activeCategory)} ITEMS</p>
                </div>
              </button>
              
              {/* {hasUploadAccess && (
                // <button 
                //   onClick={() => setIsUploadMode(true)}
                //   className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-sm text-sm"
                // >
                //   <Upload className="w-4 h-4" />
                //   Upload to Folder
                // </button>
              )} */}
            </div>

            {loading ? (
               <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            ) : (
              <div className="space-y-4">
                {displayedItems.length === 0 ? (
                  <div className="py-12 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white">
                    <p className="text-slate-500">This folder is empty.</p>
                  </div>
                ) : (
                  displayedItems.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer flex items-center gap-5 group"
                    >
                      <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-white transition-colors">
                        {getFileIcon(item.file_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-slate-900 text-lg truncate group-hover:text-blue-700 transition-colors">{item.title}</h3>
                        {item.description && (
                          <p className="text-slate-500 text-sm mt-1 truncate">{item.description}</p>
                        )}
                        {!item.description && (
                          <p className="text-slate-400 text-sm mt-1 truncate">Uploaded on {new Date(item.created_at).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal / Popup overlay */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-[#0F172A]/80 backdrop-blur-sm transition-opacity" 
            onClick={() => setSelectedItem(null)}
          ></div>
          
          {/* Modal Content */}
          <div className="relative bg-white rounded-[24px] w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center shrink-0">
                  {getFileIcon(selectedItem.file_type || 'document')}
                </div>
                <h2 className="text-lg font-bold text-slate-900 truncate pr-4">{selectedItem.title}</h2>
              </div>
              <button 
                onClick={() => setSelectedItem(null)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-full transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Preview Area */}
            <div className="flex-1 bg-slate-100/50 p-6 flex flex-col overflow-hidden relative">
              <div className="w-full h-full flex items-center justify-center">
                {(() => {
                  const type = selectedItem.file_type?.toLowerCase() || '';
                  const url = selectedItem.file_url;
                  
                  if (type.startsWith('image/')) {
                    return <img src={url} alt={selectedItem.title} className="max-w-full max-h-full object-contain drop-shadow-md rounded-xl" />;
                  }
                  if (type.startsWith('video/')) {
                    return <video src={url} controls className="max-w-full max-h-full rounded-xl shadow-md bg-black" />;
                  }
                  if (type.startsWith('audio/')) {
                    return (
                      <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-sm border border-slate-200 flex flex-col items-center">
                        <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-6">
                          <FileAudio className="w-10 h-10" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-6 truncate w-full text-center">{selectedItem.title}</h3>
                        <audio src={url} controls className="w-full outline-none" />
                      </div>
                    );
                  }
                  if (type.includes('pdf')) {
                    return <iframe src={url} className="w-full h-full rounded-xl shadow-sm border border-slate-200 bg-white" />;
                  }
                  
                  const isOfficeDoc = type.includes('document') || type.includes('msword') || type.includes('spreadsheet') || type.includes('excel') || type.includes('presentation') || type.includes('powerpoint');
                  
                  if (isOfficeDoc && url.startsWith('http')) {
                    const docViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
                    return <iframe src={docViewerUrl} className="w-full h-full rounded-xl shadow-sm border border-slate-200 bg-white" />;
                  }

                  return (
                    <div className="flex flex-col items-center text-center max-w-sm">
                      <div className="w-24 h-24 bg-white text-slate-300 rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-200">
                        <File className="w-12 h-12" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-800 mb-2">No Preview Available</h3>
                      <p className="text-slate-500 mb-8">This file format cannot be previewed in the browser. Please download it to view the contents.</p>
                      <a href={url} target="_blank" rel="noreferrer" className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2">
                        <Download className="w-5 h-5" />
                        Download File
                      </a>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-end gap-3 shrink-0">
              {hasUploadAccess && (
                <button 
                  onClick={() => handleDelete(selectedItem.id)}
                  className="px-5 py-2.5 rounded-xl font-bold text-red-600 bg-white border border-red-200 hover:bg-red-50 hover:border-red-300 transition-colors flex items-center gap-2 mr-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Asset
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
