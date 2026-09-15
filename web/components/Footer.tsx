import Link from "next/link";

import { LogoMark } from "@/components/Logo";

const EMAIL = "contact@writ.fi";
const X_HANDLE = "writ_fi";

const product = [
  { href: "/", label: "Earn" },
  { href: "/trade", label: "Trade" },
  { href: "/positions", label: "Positions" },
];

function MailIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </svg>
  );
}

function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const linkClass = "text-[13px] text-steel-400 transition hover:text-char";

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-ink-900">
      <div className="mx-auto w-full max-w-6xl px-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-12 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Writ Fi home">
              <LogoMark size={30} />
              <span className="font-display text-[19px] font-bold tracking-tight text-char">
                Writ Fi
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-steel-400">
              Earn upfront premium by writing fully collateralized BTC options on GIWA.
            </p>
          </div>

          <nav aria-label="Product">
            <div className="micro mb-4">Product</div>
            <ul className="space-y-3">
              {product.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className={linkClass}>
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <div className="micro mb-4">Contact</div>
            <ul className="space-y-3">
              <li>
                <a href={`mailto:${EMAIL}`} className={`group inline-flex items-center gap-2.5 ${linkClass}`}>
                  <MailIcon className="h-4 w-4 text-steel-500 transition group-hover:text-char" />
                  {EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={`https://x.com/${X_HANDLE}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group inline-flex items-center gap-2.5 ${linkClass}`}
                >
                  <XIcon className="h-3.5 w-4 text-steel-500 transition group-hover:text-char" />
                  @{X_HANDLE}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline py-5">
          <span className="text-[12px] text-steel-500">© {new Date().getFullYear()} Writ Fi</span>
          <span className="micro !text-steel-500">Testnet · Unaudited · Not investment advice</span>
        </div>
      </div>
    </footer>
  );
}
