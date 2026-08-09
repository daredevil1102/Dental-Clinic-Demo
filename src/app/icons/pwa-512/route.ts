import { renderBrandIcon } from "@/lib/brand/brand-icon";

// PWA manifest icon, 512×512, purpose "any". Referenced from app/manifest.ts.
export const runtime = "edge";

export function GET() {
  return renderBrandIcon(512);
}
