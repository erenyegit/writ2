"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { giwaSepolia } from "@/lib/chain";
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

  return (
    <header className="sticky top-0 z-20 border-b border-inkline bg-ink-900/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-10">
          <Link href="/" className="font-display text-[22px] font-bold tracking-tight text-char">
            writ<span className="text-amber">_</span>
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
            <button
              className="btn-primary"
              disabled={isPending}
              onClick={() => connect({ connector: connectors[0] })}
            >
              {isPending ? "connecting…" : "connect"}
            </button>
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
