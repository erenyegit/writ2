import { ImageResponse } from "next/og";

import { MARK_PATH } from "@/components/Logo";

export const alt = "Writ Fi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Share card: the W without its tile, lit the same way as the coming soon
// splash, rendered from the path in components/Logo.tsx so it never drifts.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#05081a",
          backgroundImage:
            "radial-gradient(circle at 50% 48%, rgba(86, 116, 255, 0.34) 0%, rgba(20, 30, 76, 0.6) 30%, #05081a 64%)",
        }}
      >
        <svg width="456" height="300" viewBox="48 120 304 200">
          <defs>
            <linearGradient id="w" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f8f9ff" />
              <stop offset="0.45" stopColor="#c3cdfd" />
              <stop offset="1" stopColor="#6f84ea" />
            </linearGradient>
          </defs>
          <path d={MARK_PATH} fill="url(#w)" />
        </svg>
      </div>
    ),
    size,
  );
}
