import type { MetadataRoute } from "next";

// PWA Level 1 (P1-1... P1-7): makes ConnectsWA installable to a phone home
// screen and launchable fullscreen (display: standalone) with its own icon
// and splash. No service worker / offline / push — that's Phase 2 (P2-3).
// Next.js auto-injects <link rel="manifest"> from this file convention.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ConnectsWA",
    short_name: "ConnectsWA",
    description:
      "WhatsApp CRM — shared team inbox, contacts, pipelines, and broadcasts.",
    start_url: "/",
    display: "standalone",
    // Match the app's dark shell so the splash/background doesn't flash a
    // different colour on launch. (Same value as viewport.themeColor.)
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      { src: "/icons/pwa-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/pwa-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
