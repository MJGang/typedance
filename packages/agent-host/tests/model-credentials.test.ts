import { describe, expect, it, vi } from "vitest";
import { createHttpModelCredentialStore } from "../src/model-credentials";

const token = "private_broker_" + "x".repeat(40);

describe("desktop credential bridge", () => {
  it("rejects remote URLs and short capabilities before sending credentials", () => {
    for (const url of ["https://example.com", "http://evil.example", "http://user:pass@127.0.0.1:4999", "http://127.0.0.1:4999/other"]) {
      expect(() => createHttpModelCredentialStore({ url, token })).toThrow(/loopback/);
    }
    expect(() => createHttpModelCredentialStore({ url: "http://127.0.0.1:4999", token: "short" })).toThrow(/desktop-issued/);
  });

  it("uses the private capability and refuses redirects on every operation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ value: "test-only-key" })));
    const store = createHttpModelCredentialStore({ url: "http://127.0.0.1:4999", token, fetch: fetcher });
    expect(await store.get()).toBe("test-only-key");
    expect(fetcher).toHaveBeenCalledWith(new URL("http://127.0.0.1:4999/secrets/model-api-key"), expect.objectContaining({ method: "GET", redirect: "error", headers: { authorization: `Bearer ${token}` } }));
    fetcher.mockImplementation(async () => new Response('{"ok":true}'));
    await store.set("replacement-test-only-key");
    await store.clear();
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(["GET", "PUT", "DELETE"]);
  });

  it("does not propagate broker error bodies or invalid secret responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret-value-that-must-not-leak", { status: 500 }));
    const store = createHttpModelCredentialStore({ url: "http://127.0.0.1:4999", token, fetch: fetcher });
    await expect(store.get()).rejects.toThrow("系统安全存储不可用");
    fetcher.mockResolvedValue(new Response('{"value":42}'));
    await expect(store.get()).rejects.toThrow("系统安全存储不可用");
    fetcher.mockResolvedValue(new Response('{"value":null}'));
    await expect(store.get()).resolves.toBeUndefined();
  });
});
