import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "", priority: 1 },
    { path: "/product", priority: 0.9 },
    { path: "/image-to-video", priority: 0.9 },
    { path: "/real-estate-video", priority: 0.9 },
    { path: "/templates", priority: 0.8 },
    { path: "/examples", priority: 0.8 },
    { path: "/pricing", priority: 0.9 },
    { path: "/business", priority: 0.7 },
    { path: "/login", priority: 0.3 },
    { path: "/signup", priority: 0.5 },
  ];
  const lastModified = new Date();
  return routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified,
    changeFrequency: "weekly",
    priority: route.priority,
  }));
}
