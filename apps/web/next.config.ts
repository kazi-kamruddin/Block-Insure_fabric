import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@grpc/grpc-js", "@hyperledger/fabric-gateway"],
};

export default nextConfig;
