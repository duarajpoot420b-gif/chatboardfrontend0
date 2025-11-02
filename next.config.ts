/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "chatgpt.com",
        pathname: "/s/**",
      },
    ],
  },
};

module.exports = nextConfig;
