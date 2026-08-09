import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the ConnectsWA brand mark —
// corporate-blue rounded square + white message-bubble-with-upward-arrow
// glyph — mirroring the shared <BrandMark> used in the sidebar and auth
// pages (`src/components/brand/brand-mark.tsx`). This route renders through
// next/og at the edge and can't import that React component, so the paths
// are duplicated here by hand; keep the two in sync. Next.js renders this
// at build time and auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2563EB", // corporate blue (aligned with the "cobalt" theme)
          borderRadius: 6,
        }}
      >
        <svg
          width="20"
          height="20"
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
    { ...size },
  );
}
