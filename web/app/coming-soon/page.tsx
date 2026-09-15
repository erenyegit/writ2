import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComingSoon } from "@/components/ComingSoon";
import { X_HANDLE } from "@/lib/site";

const title = "writ.fi — Coming Soon";
const description = "Writ Fi is coming soon.";
// Setting openGraph/twitter here replaces the images inherited from
// app/opengraph-image.tsx, so the card is pointed at it explicitly.
const image = { url: "/opengraph-image", width: 1200, height: 630, alt: "Writ Fi" };

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, url: "/", siteName: "Writ Fi", type: "website", images: [image] },
  twitter: { card: "summary_large_image", title, description, site: `@${X_HANDLE}`, images: [image] },
};

// Only reachable through the COMING_SOON rewrite in next.config.mjs.
export default function ComingSoonPage() {
  if (process.env.COMING_SOON !== "true") notFound();
  return <ComingSoon />;
}
