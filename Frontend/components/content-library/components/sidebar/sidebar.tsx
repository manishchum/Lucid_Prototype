import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface SidebarProps {
  onNavigate: (section: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onNavigate }) => {
  const router = useRouter();
  const [active, setActive] = useState<"overview" | "content">("overview");

  const handleClick = (section: "overview" | "content") => {
    setActive(section);
    onNavigate(section);
  };

  return (
    <aside className="app-sidebar bg-white" style={{ boxShadow: 'none' }}>
      <div className="brand" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="logo w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">L</div>
          <div>
            <div className="title text-gray-900">Lucid</div>
            <div className="muted text-sm text-gray-500">Content Library</div>
          </div>
        </div>

        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="hidden lg:inline-flex px-2 py-1 rounded-md text-sm text-gray-600 hover:bg-gray-100"
        >
          Back
        </button>
      </div>

      <nav className="nav-tabs mt-6" aria-label="Main navigation">
        <button
          className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
            active === 'overview' ? 'text-blue-600 bg-blue-100' : 'text-gray-900 hover:bg-gray-100'
          }`}
          onClick={() => handleClick('overview')}
        >
          <span className="label">Overview</span>
        </button>

        <button
          className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
            active === 'content' ? 'text-blue-600 bg-blue-100' : 'text-gray-900 hover:bg-gray-100'
          }`}
          onClick={() => handleClick('content')}
        >
          <span className="label">Content</span>
        </button>
      </nav>

    </aside>
  );
};

export default Sidebar;
