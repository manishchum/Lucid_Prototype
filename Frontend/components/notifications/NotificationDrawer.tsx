'use client'

import * as React from 'react';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useNotifications, NotificationItem } from '@/contexts/notification-context';
import {
  Bell,
  CheckCheck,
  Check,
  Zap,
  Headset,
  MessageSquare,
  Award,
  Sparkles,
  ArrowRight,
  Search,
  X,
  Clock,
  Flame,
  Radio,
  Layers,
  ShieldCheck,
} from 'lucide-react';

function formatRelativeTime(dateString: string): string {
  try {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Recent';
  }
}

function getNotificationGroup(dateString: string): 'Today' | 'Yesterday' | 'Earlier this week' | 'Older' {
  try {
    const now = new Date();
    const date = new Date(dateString);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOfWeek = startOfToday - 6 * 86400000;
    const itemTime = date.getTime();

    if (itemTime >= startOfToday) return 'Today';
    if (itemTime >= startOfYesterday) return 'Yesterday';
    if (itemTime >= startOfWeek) return 'Earlier this week';
    return 'Older';
  } catch {
    return 'Older';
  }
}

function getNotificationTheme(type: string) {
  const upper = (type || '').toUpperCase();
  if (upper.includes('ROLEPLAY') || upper.includes('CALL') || upper.includes('SCENARIO')) {
    return {
      categoryKey: 'roleplay',
      tagLabel: 'ROLEPLAY',
      icon: Headset,
      tagBg: 'bg-violet-50 text-violet-700 border-violet-200/80',
      iconBg: 'bg-gradient-to-br from-violet-500/15 to-purple-500/15 text-violet-600 border-violet-200/70',
      actionLabel: 'Practice Scenario',
    };
  }
  if (upper.includes('SPRINT') || upper.includes('ASSIGNMENT') || upper.includes('QUIZ') || upper.includes('MODULE')) {
    return {
      categoryKey: 'sprints',
      tagLabel: 'SPRINT',
      icon: Zap,
      tagBg: 'bg-blue-50 text-blue-700 border-blue-200/80',
      iconBg: 'bg-gradient-to-br from-blue-500/15 to-indigo-500/15 text-[#3B66F5] border-blue-200/70',
      actionLabel: 'Start Sprint',
    };
  }
  if (upper.includes('STREAK') || upper.includes('TROPHY') || upper.includes('BADGE') || upper.includes('LEVEL') || upper.includes('LEADERBOARD')) {
    return {
      categoryKey: 'milestones',
      tagLabel: 'MILESTONE',
      icon: Flame,
      tagBg: 'bg-amber-50 text-amber-700 border-amber-200/80',
      iconBg: 'bg-gradient-to-br from-amber-500/15 to-orange-500/15 text-amber-600 border-amber-200/70',
      actionLabel: 'View Arena',
    };
  }
  if (upper.includes('FEEDBACK') || upper.includes('SURVEY') || upper.includes('REPORT') || upper.includes('REVIEW')) {
    return {
      categoryKey: 'feedback',
      tagLabel: 'FEEDBACK',
      icon: MessageSquare,
      tagBg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
      iconBg: 'bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-600 border-emerald-200/70',
      actionLabel: 'View Insights',
    };
  }
  return {
    categoryKey: 'general',
    tagLabel: 'SYSTEM',
    icon: Bell,
    tagBg: 'bg-slate-100 text-slate-700 border-slate-200/80',
    iconBg: 'bg-gradient-to-br from-slate-100 to-slate-200/70 text-slate-600 border-slate-200',
    actionLabel: 'View Details',
  };
}

export const NotificationDrawer: React.FC = () => {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isDrawerOpen,
    setIsDrawerOpen,
    markAsRead,
    markAllAsRead,
    connectionStatus,
  } = useNotifications();

  // Navigation Filter & Search State
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'sprints' | 'roleplay' | 'milestones'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Counts by category
  const categoryCounts = useMemo(() => {
    let sprints = 0;
    let roleplay = 0;
    let milestones = 0;
    notifications.forEach((n) => {
      const theme = getNotificationTheme(n.type);
      if (theme.categoryKey === 'sprints') sprints++;
      else if (theme.categoryKey === 'roleplay') roleplay++;
      else if (theme.categoryKey === 'milestones') milestones++;
    });
    return { sprints, roleplay, milestones };
  }, [notifications]);

  // Filtered Notifications list
  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      // 1. Tab filter
      if (activeTab === 'unread' && item.read) return false;
      if (activeTab === 'sprints' && getNotificationTheme(item.type).categoryKey !== 'sprints') return false;
      if (activeTab === 'roleplay' && getNotificationTheme(item.type).categoryKey !== 'roleplay') return false;
      if (activeTab === 'milestones' && getNotificationTheme(item.type).categoryKey !== 'milestones') return false;

      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = (item.title || '').toLowerCase().includes(q);
        const matchesMessage = (item.message || '').toLowerCase().includes(q);
        const matchesType = (item.type || '').toLowerCase().includes(q);
        if (!matchesTitle && !matchesMessage && !matchesType) return false;
      }

      return true;
    });
  }, [notifications, activeTab, searchQuery]);

  // Chronologically Grouped Notifications
  const groupedNotifications = useMemo(() => {
    const groups: { [key in 'Today' | 'Yesterday' | 'Earlier this week' | 'Older']?: NotificationItem[] } = {};
    const order: ('Today' | 'Yesterday' | 'Earlier this week' | 'Older')[] = ['Today', 'Yesterday', 'Earlier this week', 'Older'];

    filteredNotifications.forEach((item) => {
      const g = getNotificationGroup(item.created_at);
      if (!groups[g]) groups[g] = [];
      groups[g]!.push(item);
    });

    return order.filter((g) => groups[g] && groups[g]!.length > 0).map((key) => ({
      groupName: key,
      items: groups[key]!,
    }));
  }, [filteredNotifications]);

  const handleNotificationClick = (item: NotificationItem) => {
    if (!item.read) {
      markAsRead(item.id);
    }

    const meta = item.metadata || {};
    const target = meta.target_screen || meta.screen || meta.url || meta.link;

    if (target) {
      setIsDrawerOpen(false);
      if (typeof target === 'string') {
        if (target.startsWith('http://') || target.startsWith('https://')) {
          window.open(target, '_blank');
        } else if (target.startsWith('/')) {
          router.push(target);
        } else {
          const lower = target.toLowerCase();
          if (lower.includes('roleplay')) router.push('/employee/roleplay');
          else if (lower.includes('sprint') || lower.includes('training')) router.push('/employee/welcome');
          else if (lower.includes('history') || lower.includes('score')) router.push('/employee/score-history');
          else if (lower.includes('arena') || lower.includes('leaderboard')) router.push('/employee/gamified-arena');
          else router.push('/employee/welcome');
        }
      }
    } else {
      // Intelligent fallback by notification type
      const upper = (item.type || '').toUpperCase();
      if (upper.includes('ROLEPLAY')) {
        setIsDrawerOpen(false);
        router.push('/employee/roleplay');
      } else if (upper.includes('SPRINT') || upper.includes('ASSIGNMENT')) {
        setIsDrawerOpen(false);
        router.push('/employee/welcome');
      } else if (upper.includes('STREAK') || upper.includes('TROPHY')) {
        setIsDrawerOpen(false);
        router.push('/employee/gamified-arena');
      }
    }
  };

  return (
    <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[460px] p-0 flex flex-col bg-white border-l border-slate-200/90 shadow-2xl z-[100]"
      >
        {/* Modern Drawer Header */}
        <div className="p-5 border-b border-slate-100 bg-gradient-to-b from-slate-50/70 via-white to-white space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                <Bell size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-base font-extrabold text-slate-900 tracking-tight">
                    Notifications
                  </SheetTitle>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-blue-50 text-[#3B66F5] border border-blue-200/60 shadow-2xs">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <SheetDescription className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        connectionStatus === 'connected'
                          ? 'bg-emerald-500 ring-2 ring-emerald-100'
                          : connectionStatus === 'connecting'
                          ? 'bg-amber-400 animate-pulse'
                          : 'bg-slate-300'
                      }`}
                    />
                    <span>{connectionStatus === 'connected' ? 'Live Stream Active' : 'Connecting...'}</span>
                  </SheetDescription>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllAsRead()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-[#3B66F5] hover:bg-blue-50/80 rounded-lg transition-colors cursor-pointer"
                  title="Mark all notifications as read"
                >
                  <CheckCheck size={14} className="text-[#3B66F5]" />
                  <span>Mark read</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Search Field */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by title, module, or topic..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-200 bg-slate-50/60 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#3B66F5] focus:bg-white transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Categorical Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setActiveTab('unread')}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'unread'
                  ? 'bg-[#3B66F5] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              <span>Unread</span>
              {unreadCount > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    activeTab === 'unread' ? 'bg-white text-[#3B66F5]' : 'bg-red-500 text-white'
                  }`}
                >
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('sprints')}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'sprints'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              Sprints {categoryCounts.sprints > 0 && `(${categoryCounts.sprints})`}
            </button>
            <button
              onClick={() => setActiveTab('roleplay')}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'roleplay'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              Roleplay {categoryCounts.roleplay > 0 && `(${categoryCounts.roleplay})`}
            </button>
            <button
              onClick={() => setActiveTab('milestones')}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'milestones'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              Milestones {categoryCounts.milestones > 0 && `(${categoryCounts.milestones})`}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3.5 space-y-4">
          {filteredNotifications.length === 0 ? (
            /* Premium Zero-State Experience */
            <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center p-6 py-16">
              <div className="relative mb-4">
                <div className="w-16 h-16 rounded-3xl bg-blue-50/80 border border-blue-100 text-[#3B66F5] flex items-center justify-center shadow-inner">
                  <Sparkles size={28} />
                </div>
                <div className="absolute -inset-1.5 rounded-3xl bg-blue-500/10 -z-10 blur-xs" />
              </div>

              <h3 className="text-sm font-bold text-slate-800">
                {searchQuery
                  ? 'No matching notifications'
                  : activeTab === 'unread'
                  ? 'All caught up!'
                  : 'No notifications yet'}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-[240px] leading-relaxed">
                {searchQuery
                  ? `No alerts match "${searchQuery}". Try a different keyword.`
                  : activeTab === 'unread'
                  ? "You don't have any unread notifications right now."
                  : 'When mentors assign training sprints or AI roleplays, they will appear here.'}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-3 text-xs text-[#3B66F5] font-semibold hover:underline"
                >
                  Clear search query
                </button>
              )}
            </div>
          ) : (
            /* Chronologically Grouped Feed */
            groupedNotifications.map((group) => (
              <div key={group.groupName} className="space-y-2">
                {/* Section Header Divider */}
                <div className="flex items-center gap-2 px-1 pt-1">
                  <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">
                    {group.groupName}
                  </span>
                  <div className="flex-1 h-[1px] bg-slate-100" />
                  <span className="text-[10px] font-semibold text-slate-400">
                    {group.items.length}
                  </span>
                </div>

                {/* Group Item Cards */}
                <div className="space-y-2">
                  {group.items.map((item) => {
                    const theme = getNotificationTheme(item.type);
                    const IconComponent = theme.icon;

                    return (
                      <div
                        key={item.id}
                        onClick={() => handleNotificationClick(item)}
                        className={`group relative flex items-start gap-3 p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                          item.read
                            ? 'bg-white hover:bg-slate-50/80 border-slate-100 text-slate-600 shadow-2xs hover:border-slate-200'
                            : 'bg-blue-50/20 hover:bg-blue-50/40 border-slate-200/90 text-slate-900 shadow-xs border-l-[3.5px] border-l-[#3B66F5]'
                        }`}
                      >
                        {/* Categorical Icon Squircle */}
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border shadow-2xs ${theme.iconBg}`}
                        >
                          <IconComponent size={17} />
                        </div>

                        {/* Card Core Content */}
                        <div className="flex-1 min-w-0 pr-6">
                          {/* Top Tag & Indicator Row */}
                          <div className="flex items-center gap-2 mb-0.5">
                            <span
                              className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-md border tracking-wider ${theme.tagBg}`}
                            >
                              {theme.tagLabel}
                            </span>
                            {!item.read && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#3B66F5] animate-pulse shrink-0" />
                            )}
                          </div>

                          {/* Title */}
                          <p
                            className={`text-xs leading-snug line-clamp-1 ${
                              item.read
                                ? 'font-semibold text-slate-700'
                                : 'font-extrabold text-slate-900'
                            }`}
                          >
                            {item.title}
                          </p>

                          {/* Message Body */}
                          <p className="text-[11px] text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                            {item.message}
                          </p>

                          {/* Meta & CTA Footer */}
                          <div className="flex items-center justify-between gap-2 mt-2.5 pt-1.5 border-t border-slate-100/70 text-[10px] text-slate-400">
                            <span className="flex items-center gap-1 font-medium">
                              <Clock size={11} className="text-slate-400" />
                              {formatRelativeTime(item.created_at)}
                            </span>

                            <span className="inline-flex items-center gap-1 text-[#3B66F5] font-bold group-hover:translate-x-0.5 transition-transform">
                              <span>{theme.actionLabel}</span>
                              <ArrowRight size={11} />
                            </span>
                          </div>
                        </div>

                        {/* Quick Mark Read Check Button */}
                        {!item.read && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(item.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 absolute top-3.5 right-3 p-1 rounded-lg text-slate-400 hover:text-[#3B66F5] hover:bg-blue-50/80 transition-all shadow-2xs"
                            title="Mark as read"
                          >
                            <Check size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Bottom Real-time Security Footer Ribbon */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="font-medium text-slate-600">Enterprise Event Bus</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            Single-Device Session Protected
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
};
