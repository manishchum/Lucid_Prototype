import type React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Email Unsubscribe - Lucid",
  description: "Manage your email preferences",
};

export default function UnsubscribeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
    </>
  );
}
