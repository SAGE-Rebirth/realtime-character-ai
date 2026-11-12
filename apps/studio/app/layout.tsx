import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MetaAvatar Studio",
  description: "Real-time conversational avatars powered by Gemini Live",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
