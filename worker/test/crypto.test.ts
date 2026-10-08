import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, randomNonce, signState, verifyState } from "../src/crypto";

const SECRET = "a-test-secret-that-is-long-enough-123";

describe("token encryption", () => {
  it("round-trips and never stores plaintext", async () => {
    const stored = await encryptToken(SECRET, "ya29.refresh-token-value");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("ya29");
    expect(await decryptToken(SECRET, stored)).toBe("ya29.refresh-token-value");
  });
  it("uses a fresh IV each time", async () => {
    expect(await encryptToken(SECRET, "x")).not.toBe(await encryptToken(SECRET, "x"));
  });
  it("fails with the wrong secret or tampered data", async () => {
    const stored = await encryptToken(SECRET, "secret-token");
    await expect(decryptToken("another-secret-long-enough-456", stored)).rejects.toThrow();
    const [iv, ct] = stored.slice(7).split(".");
    const flipped = ct!.slice(0, -4) + (ct!.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decryptToken(SECRET, `enc:v1:${iv}.${flipped}`)).rejects.toThrow();
  });
  it("rejects plaintext values and weak secrets", async () => {
    await expect(decryptToken(SECRET, "plain-token")).rejects.toThrow();
    await expect(encryptToken("short", "x")).rejects.toThrow();
  });
});

describe("OAuth state", () => {
  const now = 1_700_000_000_000;
  it("verifies a fresh state", async () => {
    const state = await signState(SECRET, "user1", "nonce123", now);
    expect(await verifyState(SECRET, state, now + 1000)).toEqual({ userId: "user1", nonce: "nonce123" });
  });
  it("expires after 10 minutes", async () => {
    const state = await signState(SECRET, "user1", "n", now);
    expect(await verifyState(SECRET, state, now + 11 * 60_000)).toBeNull();
  });
  it("rejects tampering (other user) and a different secret", async () => {
    const state = await signState(SECRET, "user1", "n", now);
    expect(await verifyState(SECRET, state.replace("user1", "user2"), now)).toBeNull();
    expect(await verifyState("different-secret-long-enough-789", state, now)).toBeNull();
  });
  it("rejects garbage", async () => {
    for (const bad of ["", "a.b.c", "a.b.c.d.e", "user1.n.9999999999999.!!!"]) {
      expect(await verifyState(SECRET, bad, now)).toBeNull();
    }
  });
  it("nonces are unique", () => expect(randomNonce()).not.toBe(randomNonce()));
});
