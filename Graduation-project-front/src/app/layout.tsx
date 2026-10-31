import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CodeRAG · 代码仓库 RAG 问答系统",
  description: "基于 AST 语义切分的代码仓库检索增强问答系统，FastGPT 风格。",
  keywords: ["CodeRAG", "RAG", "代码问答", "AST 切分", "FastGPT"],
  authors: [{ name: "CodeRAG" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Inline blocking script: apply theme class BEFORE first paint to avoid FOUC.
  // Runs synchronously before React hydration, reads localStorage (set by app-header toggle).
  const themeInitScript = `(function(){try{var t=localStorage.getItem('coderag-theme');if(t==='dark'||(t===null&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <SonnerToaster position="top-center" richColors />
      </body>
    </html>
  );
}
