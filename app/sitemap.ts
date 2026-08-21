import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/diagnosis", "/ai-readiness", "/faq"];

  return pages.map((path) => ({
    url: `https://www.rasphia.com${path}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.8,
  }));
}
