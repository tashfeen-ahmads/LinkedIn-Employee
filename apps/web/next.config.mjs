/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@le/shared", "@le/db"],
};

export default nextConfig;
