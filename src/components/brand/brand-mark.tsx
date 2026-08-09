import type { SVGProps } from "react";

// Brand mark for ConnectsWA — a message bubble with an upward arrow
// (chat + growth/outreach). Single source of truth for the on-screen
// logo glyph so the sidebar and auth pages never drift.
//
// NOTE: the favicon in `src/app/icon.tsx` intentionally mirrors these
// same paths by hand rather than importing this component — that route
// renders through next/og at the edge and can't pull in a React tree.
// If you change the glyph here, update icon.tsx to match.
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 14V8" />
      <path d="m9.5 10.5 2.5-2.5 2.5 2.5" />
    </svg>
  );
}
