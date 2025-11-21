import React from "react";
import { Folder } from "../../types/folder.types";

interface FolderListProps {
  folders: Folder[];
  onOpen: (id: string) => void;
}

const FolderList: React.FC<FolderListProps> = ({ folders, onOpen }) => (
  <div>
    {folders.map(folder => (
      <div key={folder.id} onClick={() => onOpen(folder.id)} style={{marginBottom: 8, cursor: "pointer", display: 'flex', alignItems: 'center', gap: 8}}>
        <div style={{flex: 1}}>
          <strong>{folder.name}</strong>
        </div>
        {folder.category && (
          <div style={{background: '#eef2ff', color: '#3730a3', padding: '2px 8px', borderRadius: 12, fontSize: 12}}>
            {folder.category}
          </div>
        )}
      </div>
    ))}
  </div>
);

export default FolderList;
