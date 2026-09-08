import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinkedIn Employee — your AI SDR for LinkedIn",
  description:
    "Finds your buyers on LinkedIn, starts the conversation, and books the meeting. You show up and close.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
