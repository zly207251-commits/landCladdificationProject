import type { Metadata } from "next";
import "./globals.css";
import HudNavigation from "./components/HudNavigation";

export const metadata: Metadata = {
  title: "Geo-AI Swarm - منصة تصنيف الأوقاف الجغرافية",
  description: "نظام فريق الوكلاء الذكي لتحليل وتصنيف المساحات الجغرافية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="font-sans">
        <HudNavigation />
        {children}
      </body>
    </html>
  );
}
