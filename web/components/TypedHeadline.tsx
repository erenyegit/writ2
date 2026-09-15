"use client";

import { useEffect, useState } from "react";

const START_MS = 1150; // after the halves of the mark have met
const TYPE_MS = 90;
const TYPE_JITTER_MS = 60; // uneven keystrokes read as typing, even ones as a ticker
const DELETE_MS = 45;
const HOLD_FULL_MS = 2600;
const HOLD_EMPTY_MS = 700;

/**
 * Types the text, holds, deletes it from the end, and starts over. The full
 * text is laid out invisibly underneath, so the centered block never changes
 * width while the letters come and go.
 */
export function TypedHeadline({ text, className = "" }: { text: string; className?: string }) {
  const [count, setCount] = useState(0);
  const [idle, setIdle] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      setCount(text.length);
      return;
    }

    let timer = 0;
    let n = 0;
    const later = (fn: () => void, ms: number) => {
      timer = window.setTimeout(fn, ms);
    };

    const type = () => {
      setIdle(false);
      n += 1;
      setCount(n);
      if (n < text.length) later(type, TYPE_MS + Math.random() * TYPE_JITTER_MS);
      else {
        setIdle(true);
        later(erase, HOLD_FULL_MS);
      }
    };

    const erase = () => {
      setIdle(false);
      n -= 1;
      setCount(n);
      if (n > 0) later(erase, DELETE_MS);
      else {
        setIdle(true);
        later(type, HOLD_EMPTY_MS);
      }
    };

    later(type, START_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <h1 className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="cs-type">
        <span className="cs-type-sizer">{text}</span>
        <span className="cs-type-live">
          <span className="cs-type-text">{text.slice(0, count)}</span>
          {!reduced && <span className="cs-caret" data-idle={idle} />}
        </span>
      </span>
    </h1>
  );
}
