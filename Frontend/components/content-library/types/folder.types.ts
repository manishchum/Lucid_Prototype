export type FileItem = {
  id: string;
  name: string;
  url: string;
};

export type Folder = {
  id: string;
  name: string;
  files: FileItem[];
};
