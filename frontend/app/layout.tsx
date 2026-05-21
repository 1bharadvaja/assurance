import "./globals.css";
import "reactflow/dist/style.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Assurance Studio",
  description:
    "Interactive proof regression testing for mission-critical autonomy.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-ink-950 text-ink-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
