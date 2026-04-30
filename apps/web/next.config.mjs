/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true
  },
  transpilePackages: ["@bounty/shared"]
};

export default nextConfig;
