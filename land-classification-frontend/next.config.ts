import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // استخدم عنوان الخلفية من متغير البيئة أو الافتراضي المحلي أثناء البناء
        destination: `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://localhost:8000"}/:path*`,
      },
    ];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;