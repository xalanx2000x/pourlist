import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  apiBodyParser: {
    sizeLimit: '2MB',
  },
};

export default nextConfig;
