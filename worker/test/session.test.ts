import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../src/crypto";
import { allowedEmails, isAllowed } from "../src/session";

const SECRET = "a-test-secret-that-is-long-enough-123";
const now = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("session cookie", () => {
  it("round-trips the email (including dots and plus signs)", async () => {
    for (const email of ["a@b.com", "first.last+tag@gmail.com"]) {
      expect(await verifySession(SECRET, await signSession(SECRET, email, now), now + DAY)).toBe(email);
    }
  });
  it("expires after 30 days", async () => {
    const c = await signSession(SECRET, "a@b.com", now);
    expect(await verifySession(SECRET, c, now + 29 * DAY)).toBe("a@b.com");
    expect(await verifySession(SECRET, c, now + 31 * DAY)).toBeNull();
  });
  it("rejects a different secret and a swapped-in email", async () => {
    const c = await signSession(SECRET, "me@gmail.com", now);
    expect(await verifySession("different-secret-long-enough-789", c, now)).toBeNull();
    const [, exp, sig] = c.split(".");
    const forgedWho = btoa("attacker@evil.com").replace(/=+$/, "");
    expect(await verifySession(SECRET, `${forgedWho}.${exp}.${sig}`, now)).toBeNull();
  });
  it("rejects garbage", async () => {
    for (const bad of ["", "x", "a.b", "a.b.c.d", "!!!.999999999999999.!!!"]) {
      expect(await verifySession(SECRET, bad, now)).toBeNull();
    }
  });
});

describe("allowlist", () => {
  const env = { ALLOWED_EMAILS: " Me@Gmail.com, partner@gmail.com\nthird@x.org " };
  it("parses commas, spaces and newlines, case-insensitively", () => {
    expect(allowedEmails(env)).toEqual(["me@gmail.com", "partner@gmail.com", "third@x.org"]);
    expect(isAllowed(env, "ME@gmail.COM")).toBe(true);
  });
  it("refuses everyone else, and everyone when empty", () => {
    expect(isAllowed(env, "stranger@gmail.com")).toBe(false);
    expect(isAllowed(env, "me@gmail.com.evil.com")).toBe(false);
    expect(isAllowed({ ALLOWED_EMAILS: "" }, "me@gmail.com")).toBe(false);
  });
});
