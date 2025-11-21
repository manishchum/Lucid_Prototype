import React from "react";

interface UploadFileProps {
  folderId: string;
  onUpload: (folderId: string, files: FileList | null) => void;
}

const UploadFile: React.FC<UploadFileProps> = ({ folderId, onUpload }) => (
  <input
    type="file"
    multiple
    onChange={e => onUpload(folderId, e.target.files)}
  />
);

export default UploadFile;
