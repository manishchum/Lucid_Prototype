'use client';

import React from 'react';
import { Inbox } from '@novu/nextjs';
import { useAuth } from '@/contexts/auth-context';

interface NotificationInboxProps {
  subscriberId?: string;
}

export default function NotificationInbox({ subscriberId }: NotificationInboxProps) {
  const { user, userId, employeeData } = useAuth();
  const applicationIdentifier = process.env.NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER;
  const backendUrl = process.env.NEXT_PUBLIC_NOVU_BACKEND_URL;
  const socketUrl = process.env.NEXT_PUBLIC_NOVU_SOCKET_URL;

  const resolvedSubscriberId =
    subscriberId ||
    userId ||
    user?.uid ||
    employeeData?.user_id

  return (
    <Inbox
      applicationIdentifier={applicationIdentifier}
      subscriberId={resolvedSubscriberId}
      {...(backendUrl ? { backendUrl } : {})}
      {...(socketUrl ? { socketUrl } : {})}
      appearance={{
        variables: {
          colorPrimary: '#3B66F5',
          colorPrimaryForeground: '#FFFFFF',
          colorSecondary: '#F5F8FF',
          colorSecondaryForeground: '#1E293B',
          colorCounter: '#EF4444',
          colorCounterForeground: '#FFFFFF',
          colorBackground: '#FFFFFF',
          colorRing: '#3B66F5',
          colorForeground: '#1E293B',
          colorNeutral: '#E2E8F0',
          fontSize: '14px',
        },
        elements: {
          bellIcon: {
            color: '#64748B',
          },
        },
      }}
    />
  );
}
