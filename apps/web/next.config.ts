import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Use fallback so Next.js route handlers (e.g. app/api/auth/[...all]) always win.
    // Unmatched /api/* paths fall through to Express.
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: "http://localhost:3001/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
