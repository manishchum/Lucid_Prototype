// /**
//  * @license
//  * SPDX-License-Identifier: Apache-2.0
//  */

// import React from 'react';
// import { 
//   Home, 
//   FileText, 
//   Compass, 
//   Smile, 
//   Terminal, 
//   LineChart, 
//   User, 
//   LogOut, 
//   ChevronLeft,
//   ChevronRight,
//   Sparkles
// } from 'lucide-react';

// interface SidebarProps {
//   activeTab: string;
//   setActiveTab: (tab: string) => void;
//   userRole: 'admin' | 'employee';
//   setUserRole: (role: 'admin' | 'employee') => void;
// }

// export default function Sidebar({ activeTab, setActiveTab, userRole, setUserRole }: SidebarProps) {
//   const menuItems = [
//     { id: 'home', label: 'Dashboard', icon: Home },
//     { id: 'assistant', label: 'AI Assistant', icon: Sparkles },
//     { id: 'reports', label: 'Task Progress', icon: FileText },
//     { id: 'sprintverse', label: 'SprintVerse Map', icon: Compass },
//     { id: 'role-play', label: 'Role-Play Area', icon: Smile },
//     { id: 'console', label: 'Admin Console', icon: Terminal, hasChevron: true },
//     { id: 'kpi', label: 'Key Performance Indicators', icon: LineChart, hasChevron: true },
//     { id: 'profile', label: 'My Profile', icon: User }
//   ];

//   return (
//     <aside className="w-64 border-r border-[#E2E8F0] bg-white flex flex-col h-screen fixed top-0 left-0 z-20 transition-all duration-300">
//       {/* Brand Logo header */}
//       <div className="p-5 flex items-center justify-between border-b border-[#F1F5F9] bg-[#FAFBFD]">
//         <div className="flex items-center space-x-3">
//           <div className="w-8 h-8 rounded-lg bg-[#2F63FF] flex items-center justify-center text-white font-bold text-lg shadow-sm shadow-indigo-200">
//             W
//           </div>
//           <span className="font-display font-bold text-xl text-[#0F172A] tracking-tight">
//             Workfloww
//           </span>
//         </div>
//       </div>

//       {/* Profile Card matching image exactly */}
//       <div className="p-4 border-b border-[#F1F5F9]">
//         <div className="flex items-center space-x-3 p-2 bg-[#F8FAFC] rounded-xl border border-[#F1F5F9] relative group">
//           <div className="relative">
//             <div className="w-10 h-10 rounded-full bg-[#E0E7FF] text-[#2F63FF] font-semibold flex items-center justify-center text-sm font-display shadow-inner">
//               M
//             </div>
//             <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#10B981] border-2 border-white rounded-full"></span>
//           </div>
//           <div className="flex-1 min-w-0">
//             <h4 className="text-xs font-semibold text-[#0F172A] truncate font-sans">
//               Monalika
//             </h4>
//             <p className="text-[10px] text-gray-500 truncate font-mono">
//               monalika@workfloww.ai
//             </p>
//           </div>
//         </div>
//       </div>

//       {/* Role Switcher Pill for Interactive Prototype Testing */}
//       <div className="px-4 py-3">
//         <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block mb-2 px-1">
//           App Architecture Persona
//         </label>
//          <div className="grid grid-cols-2 p-1 bg-[#F1F5F9] rounded-lg">
//           <button
//             onClick={() => setUserRole('admin')}
//             className={`py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
//               userRole === 'admin'
//                 ? 'bg-[#2F63FF] text-white shadow-sm'
//                 : 'text-[#64748B] hover:text-[#0F172A]'
//             }`}
//           >
//             Admin View
//           </button>
//           <button
//             onClick={() => setUserRole('employee')}
//             className={`py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
//               userRole === 'employee'
//                 ? 'bg-[#2F63FF] text-white shadow-sm'
//                 : 'text-[#64748B] hover:text-[#0F172A]'
//             }`}
//           >
//             Team View
//           </button>
//         </div>
//       </div>

//       {/* Menu items */}
//       <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
//         {menuItems.map((item) => {
//           const Icon = item.icon;
//           const isActive = activeTab === item.id;
//           return (
//             <button
//               key={item.id}
//               onClick={() => setActiveTab(item.id)}
//               className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all group cursor-pointer ${
//                 isActive
//                   ? 'bg-[#EEF2FF] text-[#2F63FF]'
//                   : 'text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
//               }`}
//             >
//               <div className="flex items-center space-x-3">
//                 <Icon 
//                   size={18} 
//                   className={`transition-colors ${
//                     isActive ? 'text-[#2F63FF]' : 'text-gray-400 group-hover:text-gray-600'
//                   }`}
//                 />
//                 <span className="font-sans font-medium text-xs tracking-wide">{item.label}</span>
//               </div>
//               {item.hasChevron && (
//                 <ChevronRight size={14} className="text-gray-400 group-hover:text-gray-600 transition-transform group-hover:translate-x-0.5" />
//               )}
//             </button>
//           );
//         })}
//       </nav>

//       {/* Logout buttons */}
//       <div className="p-3 border-t border-[#F1F5F9] space-y-2">
//         <div className="p-3 bg-[#EEF2FF] rounded-xl text-center">
//           <p className="text-[10px] text-gray-500 font-medium font-sans">Prototype Active Mode:</p>
//           <p className="text-xs font-bold text-[#2F63FF] uppercase tracking-wide mt-0.5 font-mono">
//             Horizontal Engine v1.0
//           </p>
//         </div>
//         <button
//           onClick={() => console.log('Interactive playground sign out clicked!')}
//           className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-all cursor-pointer"
//         >
//           <LogOut size={18} className="text-red-500" />
//           <span className="font-sans font-medium text-xs tracking-wide">Sign Out</span>
//         </button>
//       </div>
//     </aside>
//   );
// }
