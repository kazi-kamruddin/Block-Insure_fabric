import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // mcpServer off: its dev log (.next/dev/logs) is rewritten on every browser
  // console line, and Turbopack's watcher then rebuilds and reloads the page in a loop.
  experimental: { cpus: 1, mcpServer: false },
  serverExternalPackages: ["@grpc/grpc-js", "@hyperledger/fabric-gateway"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
