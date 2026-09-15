import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

import { Providers } from "./providers";

export default function DeskLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24">{children}</main>
      <Footer />
    </Providers>
  );
}
