'use client'

import * as React from 'react';
import { Bell } from 'lucide-react';
import { useNotifications } from '@/contexts/notification-context';

interface NotificationBellProps {
  className?: string;
  iconSize?: number;
  showCount?: boolean;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  className = '',
  iconSize = 20,
  showCount = true,
}) => {
  const { unreadCount, setIsDrawerOpen, connectionStatus } = useNotifications();

  return (
    <button
      onClick={() => setIsDrawerOpen(true)}
      aria-label="Open notifications"
      title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'Notifications'}
      className={`group relative p-2.5 rounded-xl text-slate-600 hover:text-[#3B66F5] hover:bg-blue-50/60 active:scale-95 transition-all duration-200 cursor-pointer ${className}`}
    >
      <Bell
        size={iconSize}
        className={`shrink-0 transition-transform duration-200 group-hover:rotate-12 ${
          unreadCount > 0 ? 'text-slate-800' : 'text-slate-500'
        }`}
      />

      {/* Unread badge with glowing pulse */}
      {showCount && unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center">
          <span className="animate-ping absolute inline-flex h-4 w-4 rounded-full bg-rose-400 opacity-75" />
          <span className="relative flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-gradient-to-r from-red-500 to-rose-600 text-white text-[10px] font-extrabold rounded-full ring-2 ring-white shadow-sm pointer-events-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        </span>
      )}
    </button>
  );
};
