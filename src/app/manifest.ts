import { themeRegistry } from "@/lib/theme-registry";
import type { MetadataRoute } from "next";
import messages from "../../messages/en.json";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: messages.Metadata.title, short_name: messages.Metadata.title, description: messages.Metadata.description,
    start_url: "/", scope: "/", display: "standalone",
    background_color: themeRegistry.harvest.light["--shell-canvas"], theme_color: themeRegistry.harvest.light["--brand-color"],
    icons: [192, 512].map((size) => ({ src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png" })),
  };
}
