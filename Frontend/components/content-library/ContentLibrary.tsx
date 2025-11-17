import React from 'react';
import UserDashboard from './pages/UserDashboard';
import './styles/content-library.css';

export type Role = 'admin' | 'user' | 'super_admin';

export default function ContentLibrary({ role } : { role: Role }) {
  // Always render the card-based UserDashboard in content mode.
  // Route-level access control ensures only admin/super_admin reach this page.
  return <UserDashboard activeSection="content" />;
}
