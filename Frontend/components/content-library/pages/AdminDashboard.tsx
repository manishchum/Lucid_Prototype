import React, { useState, useEffect } from "react";
import FolderList from "../components/folder/FolderList";
import UploadFile from "../components/folder/UploadFile";
import { Folder } from "../types/folder.types";

const initialFolders: Folder[] = [];

const categories = [
  'Sales',
  'Marketing',
  'Finance',
  'HR',
  'Product',
  'Engineering',
  'Prompt Engineering',
  'AI in Sales',
  'AI in Marketing',
  'Operations',
  'Customer Support'
];

const AdminDashboard: React.FC<{ activeSection?: string }> = ({ activeSection = 'overview' }) => {
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string,string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]);

  const primaryButtonStyle = (enabled: boolean, width: string | number = '100%'): React.CSSProperties => ({
    background: enabled ? '#2563eb' : '#f3f4f6',
    color: enabled ? '#fff' : '#9ca3af',
    padding: '10px 14px',
    borderRadius: 8,
    border: 'none',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontWeight: 700,
    fontSize: 15,
    transition: 'background 0.2s, color 0.2s',
    boxShadow: enabled ? '0 4px 12px rgba(37,99,235,0.12)' : 'none',
    width,
    textAlign: 'center'
  });

  // Load folders from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('lucid_folders') || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        setFolders(stored);
        setSelectedFolder(stored[0].id);
      }
    } catch (e) {
      // ignore parse errors
    }
  }, []);

  const persistFolders = (updated: Folder[]) => {
    setFolders(updated);
    try {
      localStorage.setItem('lucid_folders', JSON.stringify(updated));
    } catch (e) {
      // ignore
    }
  };

  const handleCreateFolder = (name: string, category?: string) => {
    const newFolder: Folder = { id: Date.now().toString(), name, files: [], category };
    const updated = [...folders, newFolder];
    persistFolders(updated);
    setSelectedFolder(newFolder.id);
  };

  const handleUpload = (folderId: string, files: FileList | null) => {
    if (!files) return;
    const updated = folders.map(folder =>
      folder.id === folderId
        ? {
            ...folder,
            files: [
              ...folder.files,
              ...Array.from(files).map(f => ({
                id: Date.now().toString() + f.name,
                name: f.name,
                url: "#"
              }))
            ]
          }
        : folder
    );
    persistFolders(updated);
  };

  const handleDescriptionChange = (folderId: string, value: string) => {
    setDescriptions(prev => ({ ...prev, [folderId]: value }));
  };

  // Overview view (default) � show first-time CTA when no folders exist
  if (activeSection === 'overview') {
    if (folders.length === 0) {
      return (
        <main style={{ padding: 32 }}>
          <div style={{ maxWidth: 920 }}>
            <h1 style={{ fontSize: 28, marginBottom: 12 }}>Create a new folder <span style={{ fontSize: 14, color: '#6b7280', fontWeight: 500 }}>(for first time creators)</span></h1>
            <p style={{ marginBottom: 18, color: '#6b7280' }}>Get started by creating your first content folder. You can add PDFs, DOCX and other documents inside it.</p>

            <div style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
              <div style={{ marginRight: 16 }}>
                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', minWidth: 160, fontSize: 16 }}
                >
                  <option value="">Select Category</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <button
                disabled={!selectedCategory}
                onClick={() => {
                  if (!selectedCategory) return;
                  const folderName = prompt("Folder Name? (leave blank to use category)") || selectedCategory;
                  if (folderName) handleCreateFolder(folderName, selectedCategory);
                }}
                style={primaryButtonStyle(!!selectedCategory, 456)}
              >
                Create Folder
              </button>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main style={{ padding: 32 }}>
        <h1>Admin Content Library</h1>
        <div style={{ marginBottom: 12, display: 'flex', gap: 0, alignItems: 'center' }}>
          <div style={{ marginRight: 16 }}>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', minWidth: 160, fontSize: 16 }}
            >
              <option value="">Select Category</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            disabled={!selectedCategory}
            onClick={() => {
              if (!selectedCategory) return;
              const folderName = prompt("Folder Name? (leave blank to use category)") || selectedCategory;
              if (folderName) handleCreateFolder(folderName, selectedCategory);
            }}
            style={primaryButtonStyle(!!selectedCategory, 456)}
          >
            Add Folder
          </button>
        </div>
        <FolderList folders={folders} onOpen={(id) => setSelectedFolder(id)} />
      </main>
    );
  }

  // Content view - show folders on left and editor on right
  return (
    <main style={{ padding: 24 }}>
      <h1>Admin Content Library � Content</h1>
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ width: 260 }}>
          <div style={{ marginBottom: 12, display: 'flex', gap: 0, alignItems: 'center' }}>
            <div style={{ marginRight: 16 }}>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', minWidth: 160, fontSize: 16 }}
              >
                <option value="">Select Category</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button
              disabled={!selectedCategory}
              onClick={() => {
                if (!selectedCategory) return;
                const folderName = prompt("Folder Name? (leave blank to use category)") || selectedCategory;
                if (folderName) handleCreateFolder(folderName, selectedCategory);
              }}
              style={primaryButtonStyle(!!selectedCategory)}
            >
              Create Folder
            </button>
          </div>
          <div>
            <FolderList folders={folders} onOpen={id => setSelectedFolder(id)} />
          </div>
        </div>

        <div style={{ flex: 1, padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
          {!selectedFolder ? (
            <div>Select a folder to manage its content</div>
          ) : (
            (() => {
              const folder = folders.find(f => f.id === selectedFolder)!;
              return (
                <div>
                  <h2>{folder.name}</h2>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontWeight: 600 }}>Description</label>
                    <textarea
                      value={descriptions[selectedFolder] || ''}
                      onChange={e => handleDescriptionChange(selectedFolder, e.target.value)}
                      style={{ width: '100%', minHeight: 100 }}
                    />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontWeight: 600 }}>Upload PDFs</label>
                    <input
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={e => handleUpload(selectedFolder, e.target.files)}
                    />
                  </div>

                  <div>
                    <h3>Files</h3>
                    <ul>
                      {folder.files.map(file => (
                        <li key={file.id}>{file.name}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
    </main>
  );
};

export default AdminDashboard;
