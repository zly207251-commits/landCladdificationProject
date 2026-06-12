import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // استخدم الرابط الأخضر الذي حصلت عليه من Ngrok هنا
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "https://bakeshop-corridor-malt.ngrok-free.dev",
  },
};

export default nextConfig;