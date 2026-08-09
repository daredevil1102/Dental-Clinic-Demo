import { renderBrandIcon } from "@/lib/brand/brand-icon";

// Favicon — the ConnectsWA brand mark (corporate-blue rounded square +
// white message-bubble-with-upward-arrow glyph). The raster art lives in
// `src/lib/brand/brand-icon.tsx`, shared with apple-icon and the PWA
// manifest icons so every rendered mark stays identical. Next.js renders
// this at build time and auto-injects <link rel="icon"> into <head>; it
// takes precedence over the default src/app/favicon.ico.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return renderBrandIcon(32);
}
