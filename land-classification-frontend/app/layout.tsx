import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "وكيل تصنيف الأراضي - AI Land Classification",
  description: "نظام ذكاء اصطناعي لتحليل وتصنيف المساحات الجغرافية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="font-sans">
        {children}
      </body>
    </html>
  );
}
