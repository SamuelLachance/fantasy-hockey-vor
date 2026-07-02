import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";
const repoBase = "/fantasy-hockey-vor";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isGithubPages ? repoBase : "",
  assetPrefix: isGithubPages ? repoBase : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
