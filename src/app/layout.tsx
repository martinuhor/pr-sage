import "@/styles/globals.css";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "PR Sage — AI Code Review Agent",
  description:
    "Real-time AI-powered pull request reviews using Vercel AI SDK, AI Gateway, and eve durable agents.",
  openGraph: {
    title: "PR Sage",
    description: "AI-powered code reviews, powered by the Vercel AI platform.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          "min-h-screen bg-zinc-950 text-zinc-50 font-sans antialiased"
        )}
      >
        {children}
      </body>
    </html>
  );
}
