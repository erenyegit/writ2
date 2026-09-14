"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { giwaSepolia } from "@/lib/chain";
import { LogoMark } from "@/components/Logo";
import { shortAddr } from "@/lib/format";

const nav = [
  { href: "/", label: "earn" },
  { href: "/trade", label: "trade" },
  { href: "/positions", label: "positions" },
];

export function Header() {
  const pathname = usePathname();
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== giwaSepolia.id;

  // wagmi discovers every EIP-6963 wallet in the browser as its own connector.
  // Picking connectors[0] silently locked out anyone whose wallet was not first.
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picking) return;
    const close = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [picking]);

  const onConnect = () => {
    if (connectors.length === 1) connect({ connector: connectors[0] });
    else setPicking((v) => !v);
  };

  return (
    <header className="sticky top-0 z-20 border-b border-inkline bg-ink-900/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Writ Fi home">
            <LogoMark size={30} />
            <span className="font-display text-[20px] font-bold tracking-tight text-char">
              Writ Fi
            </span>
          </Link>
          <nav className="hidden items-center gap-1.5 sm:flex">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-full px-3.5 py-1.5 font-mono text-[12px] tracking-wider transition ${
                  pathname === n.href
                    ? "bg-ink-800 font-semibold text-char"
                    : "text-steel-400 hover:bg-ink-850 hover:text-char"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-md border border-hairline px-2.5 py-1.5 md:inline-flex">
            <span className="dot bg-yield" />
            <span className="micro !text-steel-400">giwa sepolia</span>
          </span>
          {!isConnected ? (
            <div className="relative" ref={pickerRef}>
              <button className="btn-primary" disabled={isPending} onClick={onConnect}>
                {isPending ? "connecting…" : "connect"}
              </button>
              {picking && (
                <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-md border border-hairline bg-ink-900 shadow-soft">
                  {connectors.length === 0 && (
                    <p className="px-3 py-3 text-[12px] leading-relaxed text-steel-400">
                      no wallet detected. install a browser wallet, or open this page inside your
                      wallet&apos;s own browser.
                    </p>
                  )}
                  {connectors.map((c) => (
                    <button
                      key={c.uid}
                      className="block w-full px-3 py-2.5 text-left text-[12px] text-steel-300 transition hover:bg-ink-850 hover:text-char"
                      onClick={() => {
                        setPicking(false);
                        connect({ connector: c });
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : wrongChain ? (
            <button className="btn-primary" onClick={() => switchChain({ chainId: giwaSepolia.id })}>
              switch to giwa
            </button>
          ) : (
            <button className="btn-ghost normal-case" onClick={() => disconnect()}>
              <span className="dot bg-yield" />
              {shortAddr(address!)}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
