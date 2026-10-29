import { requireLocalToken } from "./local-access";

/** A fixed account process capability, never refreshed from a different session. */
export function createAuthenticatedSidecarFetch(authToken: string, fetchImpl: typeof fetch = fetch): typeof fetch {
  const token = requireLocalToken(authToken);
  return (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
      throw new Error("Sidecar URL must use a loopback HTTP address");
    }
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers, redirect: "error", cache: "no-store" });
  };
}
