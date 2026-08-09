import { ImageResponse } from "next/og";

// Raster ConnectsWA mark for the favicon, apple-touch icon, and PWA
// manifest icons — rendered through next/og (Satori). This mirrors the
// DOM <BrandMark> glyph (`src/components/brand/brand-mark.tsx`): a message
// bubble with an upward arrow. If you change the glyph in one place, change
// it here too. Two renderers exist on purpose — <BrandMark> paints live DOM
// SVG in the app, this paints rasterized PNGs at build/request time where a
// React component tree can't be imported.

const BRAND_BLUE = "#2563EB";

/**
 * Build a square PNG of the brand mark at `size` px.
 * - `rounded` (default true): rounded-square background — for the favicon,
 *   apple-touch, and manifest "any" icons.
 * - `rounded: false`: full-bleed background — for apple (iOS applies its own
 *   mask) and Android "maskable" icons.
 * - `glyphScale`: glyph size as a fraction of the canvas. Drop it for the
 *   maskable variant so the glyph stays inside the adaptive-icon safe zone.
 */
export function renderBrandIcon(
  size: number,
  { rounded = true, glyphScale = 0.62 }: { rounded?: boolean; glyphScale?: number } = {},
) {
  const glyph = Math.round(size * glyphScale);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_BLUE,
          borderRadius: rounded ? Math.round(size * 0.22) : 0,
        }}
      >
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M12 14V8" />
          <path d="m9.5 10.5 2.5-2.5 2.5 2.5" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
