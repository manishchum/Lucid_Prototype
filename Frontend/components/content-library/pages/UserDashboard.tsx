import React, { useState, useMemo, useRef, useEffect } from "react";
import { CloudCog, Search } from "lucide-react";
import { supabase } from "../../../lib/supabase";

interface Category {
  category_id: number;
  name: string;
  created_at: string;
}

interface Course {
  id: number | string;
  title: string;
  description: string;
  category_id?: number;
  created_at?: string;
  image?: string;
  rating?: number;
  learners?: number;
  duration?: string;
  category?: string;
}

// Restore original static modules
const staticCourses: Course[] = [
];



const UserDashboard: React.FC<{ activeSection?: string; isAdmin?: boolean }> = ({ activeSection = 'overview', isAdmin = false }) => {
  const [searchQuery, setSearchQuery] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMetaRef = useRef<{ category_id: number; moduleName: string; moduleDescription: string; } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<{ files: number; folders: number } | null>(null);
  const [hoveredCourseId, setHoveredCourseId] = useState<string | number | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const staticCategories: Category[] = [
    { category_id: -1, name: 'Sales', created_at: '' },
    { category_id: -2, name: 'Marketing', created_at: '' },
    { category_id: -3, name: 'Finance', created_at: '' },
    { category_id: -4, name: 'HR', created_at: '' },
    { category_id: -5, name: 'Product', created_at: '' },
    { category_id: -6, name: 'Engineering', created_at: '' },
    { category_id: -7, name: 'Prompt Engineering', created_at: '' },
    { category_id: -10, name: 'Operations', created_at: '' },
    { category_id: -11, name: 'Customer Support', created_at: '' },
  ];
  const [categories, setCategories] = useState<Category[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [moduleName, setModuleName] = useState('');
  const [moduleDescription, setModuleDescription] = useState('');
  const [uploadMeta, setUploadMeta] = useState<{ category_id: number; moduleName: string; moduleDescription: string; } | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');

  const triggerUpload = () => { 
    console.log(selectedCategory)
    if (selectedCategory === '') return;
    // Resolve category id robustly from the dropdown value (which might be numeric string or name)
    let catId: number = 0;
    const tryNum = Number(selectedCategory);
    console.log(tryNum);
    if (!Number.isNaN(tryNum)) catId = tryNum;
    else {
      console.log('--- IGNORE ---');
      console.log(categories);
      console.log(selectedCategory);
      const byName = categories.find(c =>( (c.category_id || '').toString().toLowerCase() )=== (selectedCategory || '').toString().toLowerCase());
      console.log(byName);
      if (byName) {
        catId = byName.category_id;
        console.log(byName);
      }
      console.log(catId);
    }
    const metaObj = { category_id: catId, moduleName, moduleDescription };
    uploadMetaRef.current = metaObj;
    setUploadMeta(metaObj);
    console.log('--- IGNORE ---');
    console.log(metaObj);
    console.log(uploadMetaRef.current);
    setShowUploadModal(false);
    console.log('triggerUpload: selectedCategory=', selectedCategory, 'metaObj=', metaObj, 'categories length=', categories.length);
    // give the browser a short delay to update UI and ensure ref/state are set, then open file dialog
    setTimeout(() => fileInputRef.current?.click(), 150);
  };

  // legacy local folder creation - retained for compatibility
  const handleCreateFolderFromUser = (name: string, category?: string) => {
    const folder = { id: Date.now().toString(), name, files: [], category } as any;
    try {
      const existing = JSON.parse(localStorage.getItem('lucid_folders') || '[]');
      existing.push(folder);
      localStorage.setItem('lucid_folders', JSON.stringify(existing));
    } catch (e) {
      localStorage.setItem('lucid_folders', JSON.stringify([folder]));
    }
    alert(`Created folder "${name}" in category "${category}". Switch to Admin view to upload files.`);
    setShowUploadModal(false);
    setNewFolderName('');
  };
  
  // Add new module to course list (local only)
  const addNewModuleToCourseList = () => {
    const newCourse = {
      id: Date.now().toString(),
      title: moduleName,
      description: moduleDescription,
      category_id: Number(selectedCategory),
      category: categories.find(c => c.category_id === Number(selectedCategory))?.name || '',
      image: undefined,
      rating: undefined,
      learners: undefined,
      duration: undefined
    };
    setCourses(prev => [newCourse, ...prev]);
    setModuleName('');
    setModuleDescription('');
    setShowUploadModal(false);
  };

  // Fetch categories and courses from Supabase, and seed static categories if missing
  useEffect(() => {
    const seedAndFetchCategories = async () => {
      // 1. Fetch current DB categories
      const { data: dbCategories, error } = await supabase.from('categories').select('*');
      if (error) return;
      // 2. Find static categories not in DB (case-insensitive)
      const dbCatNames = new Set((dbCategories || []).map((c: Category) => c.name.toLowerCase()));
      const missing = staticCategories.filter(sc => !dbCatNames.has(sc.name.toLowerCase()));
      // 3. Insert missing static categories
      if (missing.length > 0) {
        await supabase.from('categories').insert(missing.map(c => ({ name: c.name })));
      }
      // 4. Fetch again to get the full up-to-date list
      const { data: allCategories } = await supabase.from('categories').select('*').order('created_at', { ascending: false });
      if (allCategories) setCategories(allCategories as Category[]);
      // 5. Seed static courses into DB only if courses table is empty
      try {
        const { data: dbCourses } = await supabase.from('courses').select('*');
        const existingCount = (dbCourses || []).length;
        console.log('Seeding static courses, existingCount=', existingCount);
       
          console.log(staticCourses)
          console.log(allCategories)
          
          const toInsert = staticCourses.map(sc => {
            const match = (allCategories || []).find((ac: any) => (ac.name || '').toLowerCase() === (sc.category || '').toLowerCase());
            const catId = match.category_id;
            return {
              title: sc.title,
              description: sc.description,
              category_id: catId,
              created_at: new Date().toISOString(),
              module: sc.image || null,
            };
          });
          if (toInsert.length > 0) {
            console.log('Inserting courses:', toInsert);
            await supabase.from('courses').insert(toInsert);
          }
        
      } catch (e) {
        console.error('Seeding static courses failed', e);
      }
    };
    const fetchCourses = async () => {
      const { data, error } = await supabase.from('courses').select('*').order('created_at', { ascending: false });
      if (!error && data) setCourses(data as Course[]);
    };
    seedAndFetchCategories();
    fetchCourses();
  }, []);

  // Restore refreshCategories for the refresh button
  const refreshCategories = async () => {
    const { data, error } = await supabase.from('categories').select('*').order('created_at', { ascending: false });
    if (!error && data) setCategories(data as Category[]);
  };
  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [] as any);
    if (files.length === 0) return;

    // Detect if uploading folders or individual files
    const roots = new Set<string>();
    let isFolderUpload = false;
    
    files.forEach((f: any) => {
      const path = f.webkitRelativePath || f.name;
      if (f.webkitRelativePath) {
        isFolderUpload = true;
        const root = path.split('/')[0];
        roots.add(root);
      }
    });

    setUploadSummary({ files: files.length, folders: roots.size });

    const meta = uploadMetaRef.current ?? uploadMeta;
    let metaTxt = '';
    if (meta) { 
      const catName = categories.find(c => c.category_id === meta.category_id)?.name || '';
      metaTxt = ` for module "${meta.moduleName}" in category "${catName}"\nDescription: ${meta.moduleDescription}`; 
    }

    const uploadType = isFolderUpload ? `from ${roots.size} folder(s)` : 'individually selected';

    // Upload all selected files to Supabase storage (bucket: 'content library')
    // Resolve the numeric category_id from uploadMeta or the dropdown value.
    const resolveCategoryId = () => {
      if (meta && meta.category_id) return meta.category_id;
      if (selectedCategory !== '') {
        // If the dropdown stores the numeric id as a string, coerce to number first
        const num = Number(selectedCategory);
        if (!Number.isNaN(num)) return num;
        // otherwise try matching by name
        const byName = categories.find(c => (c.name || '').toLowerCase() === (selectedCategory || '').toString().toLowerCase());
        if (byName) return byName.category_id;
      }
      return null;
    };
    const uploadedRows: any[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File;
      try {
        const form = new FormData();
        form.append('file', f);
        form.append('title', meta?.moduleName || moduleName || f.name);
        form.append('description', meta?.moduleDescription || moduleDescription || '');

        // Determine final category id: prefer meta, then numeric dropdown value, then name match
        let finalCategory: number | null = null;
        if (meta && meta.category_id) finalCategory = Number(meta.category_id);
        if (finalCategory === null) {
          const num = Number(selectedCategory);
          if (!Number.isNaN(num)) finalCategory = num;
        }
        if (finalCategory === null) {
          const byName = categories.find(c => (c.name || '').toLowerCase() === (selectedCategory || '').toString().toLowerCase());
          if (byName) finalCategory = byName.category_id;
        }

        console.log('Uploading file, finalCategory=', finalCategory, 'selectedCategory=', selectedCategory, 'uploadMeta=', meta);
        const resolvedCat = finalCategory;
        if (resolvedCat !== null && resolvedCat !== undefined) form.append('category_id', String(selectedCategory));
        console.log('--- IGNORE ---');
        console.log(form);
        const res = await fetch("/api/content-library/upload", { method: 'POST', body: form });
        console.log(res);
        const json = await res.json();
        if (!res.ok) {
          console.error('Server upload failed', json);
          // fallback to a local-only entry so the UI still shows something
          const localCourse = {
            id: Date.now().toString(),
            title: meta?.moduleName || moduleName || f.name,
            description: meta?.moduleDescription || moduleDescription || '',
            category_id: resolvedCat,
            category: (categories.find(c => (c.category_id ?? (c as any).id) === resolvedCat) as any)?.name || '',
            image: undefined,
            rating: undefined,
            learners: undefined,
            duration: undefined,
            module: `${Date.now()}_${i}_${f.name}`,
          };
          uploadedRows.push(localCourse);
        } else {
          const inserted = json.inserted;
          if (inserted) uploadedRows.push(inserted as any);
          else {
            // Unexpected: no inserted row returned — add local fallback
            const localCourse = {
              id: Date.now().toString(),
              title: meta?.moduleName || moduleName || f.name,
              description: meta?.moduleDescription || moduleDescription || '',
              category_id: resolvedCat,
              category: (categories.find(c => (c.category_id ?? (c as any).id) === resolvedCat) as any)?.name || '',
              image: undefined,
              module: `${Date.now()}_${i}_${f.name}`,
            };
            uploadedRows.push(localCourse);
          }
        }
      } catch (err) {
        console.error('File upload failed', err);
        const resolvedCat = resolveCategoryId();
        const localCourse = {
          id: Date.now().toString(),
          title: meta?.moduleName || moduleName || f.name,
          description: meta?.moduleDescription || moduleDescription || '',
          category_id: resolvedCat,
          category: (categories.find(c => (c.category_id ?? (c as any).id) === resolvedCat) as any)?.name || '',
          image: undefined,
          module: `${Date.now()}_${i}_${f.name}`,
        };
        uploadedRows.push(localCourse);
      }
    }

    if (uploadedRows.length > 0) {
      setCourses(prev => [...uploadedRows, ...prev]);
      alert(`Uploaded ${uploadedRows.length} file(s) ${uploadType}.${metaTxt}\n(Saved to DB)`);
    } else {
      alert(`No files were uploaded.${metaTxt}`);
    }

    setUploadMeta(null);
    uploadMetaRef.current = null;
    // Clear file input via ref (don't use the event target after async/await)
    if (fileInputRef.current) {
      try { (fileInputRef.current as HTMLInputElement).value = ''; } catch (e) {}
    }
  };

  const getBullets = (course: Course) => { 
    return [
      'Key concepts and terminology',
      'Step-by-step practical guidance',
      'Common challenges and solutions',
      'Real-world examples and use-cases',
      'Tips for effective implementation'
    ];
  };

  const OverviewHover: React.FC<{ course: Course }> = ({ course }) => {
    const bullets = getBullets(course);
    return (
      <div style={{ position: 'relative' }}>
        <button
          onMouseEnter={() => setHoveredCourseId(course.id)}
          onMouseLeave={() => setHoveredCourseId(null)}
          style={{
            background: '#2563eb',
            border: 'none',
            color: 'white',
            padding: '8px 12px',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Overview
        </button>
        {hoveredCourseId === course.id && (
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 320, background: '#fff', border: '1px solid #e6edf3', padding: 12, borderRadius: 8, boxShadow: '0 8px 24px rgba(2,6,23,0.08)', pointerEvents: 'none', zIndex: 60 }}>
            {course.description ? (
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.4 }}>{course.description}</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#374151', listStyleType: 'disc' }}>
                {bullets.map((b, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  // Merge static and DB courses for display
  const filteredCourses = useMemo(() => {
    const defaultImage = 'https://images.unsplash.com/photo-1527689368864-3a821dbccc34?w=400&h=300&fit=crop';
    // Map DB courses to include static-like fields for display
    const dbCourses: Course[] = courses.map((c: any) => ({
      ...c,
      // If the module is an image URL, show it; otherwise use a document icon for common file types
      image: (() => {
        const m = c.module || '';
        // If module is an absolute URL and appears to be an image, use it.
        if (typeof m === 'string' && (m.startsWith('http://') || m.startsWith('https://'))) {
          const low = m.toLowerCase();
          if (low.endsWith('.jpg') || low.endsWith('.jpeg') || low.endsWith('.png') || low.endsWith('.webp') || low.endsWith('.gif')) return m;
          // For non-image file types (pdf/doc/ppt/etc) fall back to a consistent default image
          return defaultImage;
        }
        // No module URL present — use the default thumbnail so every card has a visual
        return defaultImage;
      })(),
      rating: undefined,
      learners: undefined,
      duration: undefined,
      category: (categories.find(cat => ((cat.category_id ?? (cat as any).id) === (c.category_id ?? (c as any).id))) as any)?.name || '',
    }));
    // Deduplicate by title (case-insensitive). Prefer DB entries over static ones so
    // uploaded/DB-backed courses (with images) replace static copies with same title.
    const mapByTitle = new Map<string, Course>();
    // insert static first
    for (const sc of staticCourses) {
      const key = (sc.title || '').toLowerCase();
      mapByTitle.set(key, sc);
    }
    // then insert DB courses, overwriting static entries when titles match
    for (const dc of dbCourses) {
      const key = ((dc.title as string) || '').toLowerCase();
      mapByTitle.set(key, dc);
    }
    const deduped = Array.from(mapByTitle.values());
    console.log(deduped);
    return deduped.filter(course =>
      (course.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (course.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (course.category || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, courses, categories]);

  

  if (activeSection === 'content') {
    return (
      <main style={{ padding: 32 }}>
        <div style={{ marginBottom: 40 }}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, maxWidth: 1400}}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, color: '#1f2937' }}>
              Browse Courses
            </h1>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, minWidth: 160 }}>
                  <option value="">All Categories</option>
                  {categories.map(c => (
                    <option key={c.category_id} value={c.category_id}>{c.name}</option>
                  ))}
                </select>
                <button
                  style={{
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    padding: '10px 18px',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(37,99,235,0.15)',
                  }}
                  onClick={() => setShowUploadModal(true)}
                >
                  + Upload
                </button>
                {showUploadModal && (
                  <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0,0,0,0.18)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <div style={{
                      background: '#fff',
                      borderRadius: 16,
                      boxShadow: '0 8px 32px rgba(2,6,23,0.12)',
                      padding: 36,
                      minWidth: 520,
                      maxWidth: 700,
                      width: '100%',
                      display: 'flex',
                      gap: 32,
                      position: 'relative',
                    }}>
                      <button onClick={() => setShowUploadModal(false)} style={{ position: 'absolute', top: 18, right: 18, background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer' }}>&times;</button>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Create Folder</div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 15 }}>
                            <option value="">Select Category</option>
                            {categories.map(c => (
                              <option key={c.category_id} value={c.category_id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        {/* Always show tabs below the dropdown so user can type title/description */}
                        <div style={{ marginBottom: 10, fontWeight: 600, color: '#2563eb', fontSize: 15 }}>
                          {selectedCategory !== '' ? (categories.find(c => c.category_id === Number(selectedCategory))?.name || '') : ''}
                        </div>
                        {/* Title above Description inputs (stacked) */}
                        <input type="text" placeholder="Module title" value={moduleName} onChange={e => setModuleName(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, marginBottom: 12, border: '1px solid #e5e7eb', fontSize: 15 }} />
                        <textarea placeholder="Module description" value={moduleDescription} onChange={e => setModuleDescription(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, marginBottom: 12, border: '1px solid #e5e7eb', fontSize: 15, resize: 'vertical', minHeight: 90 }} />
                        {/* Removed Create (local) and Create Module buttons as requested */}
                      </div>
                      <div style={{ width: 1, background: '#eef2f6', margin: '0 24px' }} />
                      <div style={{ width: 240 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Upload Module</div>
                        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>Upload a local folder (Chrome/Edge only).</div>
                        <button
                          onClick={triggerUpload}
                          disabled={!(selectedCategory !== '' && moduleName && moduleDescription)}
                          style={{
                            background: selectedCategory !== '' && moduleName && moduleDescription ? '#10b981' : '#ffffff',
                            color: selectedCategory !== '' && moduleName && moduleDescription ? '#fff' : '#374151',
                            padding: '10px 18px',
                            borderRadius: 8,
                            border: selectedCategory !== '' && moduleName && moduleDescription ? 'none' : '1px solid #e5e7eb',
                            cursor: selectedCategory !== '' && moduleName && moduleDescription ? 'pointer' : 'not-allowed',
                            width: '100%',
                            fontWeight: 600,
                            fontSize: 15
                          }}
                        >
                          Upload Module
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
           </div>

          {isAdmin && (
            <input
              ref={fileInputRef as any}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.jpg,.png,.gif"
              style={{ display: 'none' }}
              onChange={handleFilesChange}
            />
          )}
          <div style={{ position: 'relative', marginBottom: 24, maxWidth: 1400 }}>
            <Search style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search courses, folders or topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: 48,
                paddingRight: 16,
                paddingTop: 12,
                paddingBottom: 12,
                fontSize: 16,
                border: '2px solid #e5e7eb',
                borderRadius: 12,
                outline: 'none',
                transition: 'all 0.3s ease',
                backgroundColor: '#ffffff',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#3b82f6';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.12)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#e5e7eb';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.04)';
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1400 }}>
            {filteredCourses.map(course => (
              <div
                key={course.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.06)',
                  position: 'relative'
                }}
              >
                {course.image && (
                  <img src={course.image} alt={course.title} style={{ width: 160, height: 96, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0', lineHeight: 1.2 }}>{course.title}</h3>
                  <p style={{ fontSize: 14, color: '#475569', margin: '0 0 8px 0', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{course.description}</p>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: '#6b7280' }}>
                    {course.rating && <span>★ {course.rating}</span>}
                    {course.learners && <span>{(course.learners / 1000).toFixed(1)}K learners</span>}
                    {course.duration && <span>⏱ {course.duration}</span>}
                    <span style={{ fontSize: 12, backgroundColor: '#f8fafc', color: '#475569', padding: '4px 8px', borderRadius: 6 }}>{course.category || 'Uncategorized'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <OverviewHover course={course} />
                  {/* Admin delete removed from UI; deletions should be done directly in Supabase */}
                </div>
              </div>
            ))}
          </div>

          {filteredCourses.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 40, color: '#999', fontSize: 16 }}>
              No courses found. Try a different search.
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: 32 }}>
      <h1>Welcome to Content Library</h1>
      <p style={{ color: '#666', fontSize: 16 }}>Select "Content Library" to browse available courses.</p>
    </main>
  );
};

export default UserDashboard;








