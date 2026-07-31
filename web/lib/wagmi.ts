import { createConfig, http, injected } from "wagmi";

import { giwaSepolia } from "./chain";

export const wagmiConfig = createConfig({
  chains: [giwaSepolia],
  connectors: [injected()],
  transports: { [giwaSepolia.id]: http() },
  ssr: true,
});
