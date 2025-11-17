import React from "react";
import { Folder } from "../../types/folder.types";

interface FolderListProps {
  folders: Folder[];
  onOpen: (id: string) => void;
}

const FolderList: React.FC<FolderListProps> = ({ folders, onOpen }) => (
  <div>
    {folders.map(folder => (
      <div key={folder.id} onClick={() => onOpen(folder.id)} style={{marginBottom: 8, cursor: "pointer"}}>
        <strong>{folder.name}</strong>
      </div>
    ))}
  </div>
);

export default FolderList;
