import { renderBrandIcon } from "@/lib/brand/brand-icon";

// Apple touch icon (home-screen icon on iOS/iPadOS). Full-bleed square —
// iOS applies its own rounded-corner mask, so we don't pre-round it and we
// avoid transparency. Next.js auto-injects <link rel="apple-touch-icon">.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderBrandIcon(180, { rounded: false });
}
