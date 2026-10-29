import type { NextConfig } from "next";

// Version du déploiement : sert à renouveler le cache hors ligne (service worker)
// à chaque mise en production. Vercel fournit l'identifiant du commit.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_ID ?? `local-${Date.now()}`).slice(0, 12);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  // Tailwind CSS v4 via le loader Turbopack (paquet @tailwindcss/turbopack) :
  // sans cette règle, les classes Tailwind ne sont pas générées.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (et non DENY) : la caisse imprime la facture dans un cadre
          // invisible de l'application. Aucun autre site ne peut l'encadrer.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Le service worker ne doit jamais être servi depuis un cache HTTP
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
};

export default nextConfig;
