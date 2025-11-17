import React, { useState } from "react";
import FolderList from "../components/folder/folderlist";
import UploadFile from "../components/folder/uploadfile";
import { Folder } from "../types/folder.types";

const initialFolders: Folder[] = [];

const AdminDashboard: React.FC<{ activeSection?: string }> = ({ activeSection = 'overview' }) => {
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(folders[0]?.id ?? null);
  const [descriptions, setDescriptions] = useState<Record<string,string>>({});

  const handleCreateFolder = (name: string) => {
    const newFolder = { id: Date.now().toString(), name, files: [] };
    setFolders(prev => [...prev, newFolder]);
    setSelectedFolder(newFolder.id);
  };

  const handleUpload = (folderId: string, files: FileList | null) => {
    if (!files) return;
    setFolders(prev => prev.map(folder =>
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
    ));
  };

  const handleDescriptionChange = (folderId: string, value: string) => {
    setDescriptions(prev => ({ ...prev, [folderId]: value }));
  };

  // Overview view (default) — show first-time CTA when no folders exist
  if (activeSection === 'overview') {
    if (folders.length === 0) {
      return (
        <main style={{ padding: 32 }}>
          <div style={{ maxWidth: 920 }}>
            <h1 style={{ fontSize: 28, marginBottom: 12 }}>Create a new folder <span style={{ fontSize: 14, color: '#6b7280', fontWeight: 500 }}>(for first time creators)</span></h1>
            <p style={{ marginBottom: 18, color: '#6b7280' }}>Get started by creating your first content folder. You can add PDFs, DOCX and other documents inside it.</p>

            <button
              onClick={() => {
                const folderName = prompt("Folder Name?");
                if (folderName) handleCreateFolder(folderName);
              }}
              style={{
                background: '#2563eb',
                color: '#fff',
                padding: '10px 16px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Create Folder
            </button>
          </div>
        </main>
      );
    }

    return (
      <main style={{ padding: 32 }}>
        <h1>Admin Content Library</h1>
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => {
              const folderName = prompt("Folder Name?");
              if (folderName) handleCreateFolder(folderName);
            }}
            style={{
              background: '#2563eb',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer'
            }}
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
      <h1>Admin Content Library — Content</h1>
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ width: 260 }}>
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => {
              const folderName = prompt("Folder Name?");
              if (folderName) handleCreateFolder(folderName);
            }}>Create Folder</button>
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
