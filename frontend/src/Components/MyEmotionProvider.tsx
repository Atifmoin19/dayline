import type { ReactNode } from "react";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";

/** Wraps the app in an Emotion cache keyed to a per-page-load CSP nonce. Split out of
 * main.tsx (bootstrap-only) so that file has no component export alongside its
 * `createRoot(...).render(...)` bootstrap call — react-refresh's fast-refresh rule requires a
 * file to export either only components or no components at all. */
export function MyEmotionProvider({
  nonce,
  children,
}: Readonly<{
  nonce: string;
  children: ReactNode;
}>) {
  const cache = createCache({ nonce: nonce, key: "css" });
  return <CacheProvider value={cache}>{children}</CacheProvider>;
}
