import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // سيقوم بسحب الرابط من متغير البيئة NEXT_PUBLIC_BACKEND_URL
        // إذا لم يكن موجوداً، سيفشل الطلب بوضوح بدلاً من التخبط في localhost
        destination: `${process.env.NEXT_PUBLIC_BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;