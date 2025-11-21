export type FileItem = {
  id: string;
  name: string;
  url: string;
};

export type Folder = {
  id: string;
  name: string;
  // Optional category to group folders (e.g. Sales, Marketing, Finance)
  category?: string;
  files: FileItem[];
};
