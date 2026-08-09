import { renderBrandIcon } from "@/lib/brand/brand-icon";

// PWA manifest icon, 512×512, purpose "maskable". Full-bleed with a smaller
// glyph so Android's adaptive-icon mask never clips it. From app/manifest.ts.
export const runtime = "edge";

export function GET() {
  return renderBrandIcon(512, { rounded: false, glyphScale: 0.5 });
}
