import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Inventory Tracker",
    short_name: "Inventory",
    description: "Track everything you own, what you're selling, and what it's worth.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f6f4",
    theme_color: "#2a78d6",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
