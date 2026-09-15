import { GasokProof } from "@/components/GasokProof";
import { XIcon } from "@/components/Icons";
import { MARK_PATH } from "@/components/Logo";
import { TypedHeadline } from "@/components/TypedHeadline";
import { X_HANDLE, X_URL } from "@/lib/site";

// The mark without its tile: two closed outlines, one per half of the W, cropped
// to the letterform. Each half becomes a CSS mask so the halves can move on
// their own and hold live content (the flowing light) inside them.
const W_VIEWBOX = "48 120 304 200";
const [LEFT_HALF, RIGHT_HALF] = MARK_PATH.split(/(?=M)/);

function maskUrl(d: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${W_VIEWBOX}'><path d='${d}'/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
}

function Half({ side, d }: { side: "left" | "right"; d: string }) {
  return (
    <div
      className={`cs-w-half cs-w-${side}`}
      style={{ "--mask": maskUrl(d) } as React.CSSProperties}
    >
      <div className="cs-liquid">
        <span className="cs-liquid-blob cs-liquid-a" />
        <span className="cs-liquid-blob cs-liquid-b" />
        <span className="cs-liquid-spin">
          <span className="cs-liquid-blob cs-liquid-c" />
        </span>
        <span className="cs-liquid-blob cs-liquid-d" />
      </div>
    </div>
  );
}

/**
 * Full screen splash. The mark and backdrop are pure CSS (see "coming soon" in
 * globals.css) and every element's resting style is its final state, so reduced
 * motion simply switches the animations off. Only the typed headline and the
 * GASOK card ship client code.
 */
export function ComingSoon() {
  return (
    <main className="cs-stage">
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <div className="cs-w" role="img" aria-label="Writ Fi">
          <div aria-hidden="true" className="cs-w-glow" />
          <Half side="left" d={LEFT_HALF} />
          <Half side="right" d={RIGHT_HALF} />
          <div aria-hidden="true" className="cs-seam">
            <span className="cs-seam-flash" />
            <span className="cs-seam-glint" />
          </div>
        </div>

        <TypedHeadline text="Coming soon" className="cs-headline" />

        <p className="cs-domain">
          writ<span>.fi</span>
        </p>

      </div>

      {/* one bottom row, so the X link stays level with the card at any card height */}
      <div className="cs-dock">
        <div className="cs-social">
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Writ Fi on X (@${X_HANDLE})`}
            className="cs-social-link"
          >
            <XIcon className="cs-social-icon" />
          </a>
        </div>

        <GasokProof />
      </div>
    </main>
  );
}
