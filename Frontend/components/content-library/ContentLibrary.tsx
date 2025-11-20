import React from 'react';
import UserDashboard from './pages/UserDashboard';
import './styles/content-library.css';

export type Role = 'admin' | 'user' | 'super_admin';

export default function ContentLibrary({ isAdmin, onNavigate } : { isAdmin?: boolean; onNavigate?: (s:any) => void }) {
  // Always render the card-based UserDashboard in content mode.
  // Upload controls are shown when `isAdmin` is true.
  return <UserDashboard activeSection="content" isAdmin={isAdmin} />;
}
