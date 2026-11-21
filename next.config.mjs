/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**"
      }
    ]
  },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" }
      ]
    },
    {
      source: "/manifest.webmanifest",
      headers: [{ key: "Content-Type", value: "application/manifest+json" }]
    }
  ]
};

export default nextConfig;
