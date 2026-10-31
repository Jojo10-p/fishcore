import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return ["", "/solutions", "/simulateur", "/demande", "/a-propos", "/faq", "/contact", "/mentions-legales", "/confidentialite", "/conditions"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p === "" || p === "/solutions" ? "weekly" : "monthly",
    priority: p === "" ? 1 : 0.7,
  }));
}
