import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // استخدم عنوان الخلفية من متغير البيئة أو الافتراضي المحلي أثناء البناء
        destination: `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;