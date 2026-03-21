import type React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Email Unsubscribe Error - Lucid",
  description: "There was a problem unsubscribing",
};

export default function UnsubscribeErrorLayout({
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
