import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mound Hounds Pick'em",
    short_name: "Mound Hounds",
    description: "Your INDYCAR league, race-week picks, and season standings.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f7ff",
    theme_color: "#f3f7ff",
    lang: "en-US",
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
