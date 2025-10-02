import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouTube AI Agent",
  description: "Manage your YouTube playlists with an AI agent powered by MCP tools.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
