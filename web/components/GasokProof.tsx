"use client";

import Image from "next/image";
import { useRef } from "react";

const SRC = "/gasok-phase-3.webp";
const WIDTH = 2000;
const HEIGHT = 1493;
const UPBIT_X = "https://x.com/Official_Upbit";

/**
 * Corner card showing the GIWA team's Phase 3 selection email. Opens the full
 * image in a native dialog, which brings Esc to close and focus handling for free.
 */
export function GasokProof() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <aside className="cs-proof" aria-label="GIWA GASOK Phase 3">
      <button
        type="button"
        className="cs-proof-card"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        <span className="cs-proof-thumb">
          <Image src={SRC} alt="" width={WIDTH} height={HEIGHT} sizes="112px" quality={85} />
        </span>
        <span className="cs-proof-copy">
          <span className="cs-proof-title">Selected for GASOK Phase 3</span>
          <span className="cs-proof-sub">GIWA Chain program presented by @Official_Upbit</span>
        </span>
        <svg viewBox="0 0 16 16" className="cs-proof-icon" aria-hidden="true">
          <path
            d="M6 3h7v7M13 3 3 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        className="cs-proof-dialog"
        aria-label="GIWA GASOK Phase 3 selection email"
        onClick={(e) => {
          // a click on the backdrop lands on the dialog element itself
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <figure className="cs-proof-figure">
          <Image
            src={SRC}
            alt="Email from the GIWA team: Writ Fi has been selected to advance to Phase 3 of the GIWA GASOK incubation program."
            width={WIDTH}
            height={HEIGHT}
            sizes="(max-width: 1120px) 94vw, 1040px"
            quality={90}
            loading="eager"
          />
          <figcaption>
            Writ Fi advanced to Phase 3 of GASOK, the GIWA Chain incubation program presented by{" "}
            <a href={UPBIT_X} target="_blank" rel="noopener noreferrer">
              @Official_Upbit
            </a>
            .
          </figcaption>
        </figure>
        <form method="dialog">
          <button type="submit" className="cs-proof-close" aria-label="Close">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </form>
      </dialog>
    </aside>
  );
}
