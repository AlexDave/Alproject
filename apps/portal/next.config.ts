import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Для `next dev` не включаем `standalone`, чтобы не ломать генерацию манифестов.
  ...(process.env.NODE_ENV === "production" ? { output: "standalone" } : {}),
  transpilePackages: ["@alproject/shared"],
};

export default nextConfig;
