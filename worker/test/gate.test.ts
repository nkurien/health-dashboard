import { describe, expect, it } from "vitest";
import { signSession } from "../src/crypto";
import worker from "../src/index";

const SECRET = "a-test-secret-that-is-long-enough-123";

/** Minimal Env: enough for the paths these tests reach. */
const makeEnv = (over: Partial<Env> = {}): Env =>
  ({
    REQUIRE_AUTH: "true",
    APP_SECRET: SECRET,
    ALLOWED_EMAILS: "me@gmail.com,partner@gmail.com",
    PUBLIC_URL: "https://health.example.com",
    TIMEZONE: "Europe/London",
    DEV_CORS_ORIGIN: "",
    ASSETS: { fetch: async () => new Response("<html>app</html>") },
    DB: { prepare: () => ({ all: async () => ({ results: [] }) }) },
    ...over,
  }) as unknown as Env;

const call = (path: string, env: Env, init: RequestInit & { cookie?: string } = {}) => {
  const { cookie, ...rest } = init;
  const request = new Request(`https://health.example.com${path}`, {
    ...rest,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(rest.headers as object) },
  });
  type Req = Parameters<NonNullable<typeof worker.fetch>>[0];
  return worker.fetch!(request as Req, env) as Promise<Response>;
};
const session = async (email: string, now = Date.now()) => `hj_session=${await signSession(SECRET, email, now)}`;

describe("signed-out visitors", () => {
  it("are sent to sign in when they open a page", async () => {
    const r = await call("/", makeEnv());
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/auth/signin");
  });
  it("get 401 from the API and can't change anything", async () => {
    expect((await call("/api/dashboard", makeEnv())).status).toBe(401);
    expect((await call("/api/metrics/user1", makeEnv())).status).toBe(401);
    expect((await call("/auth/status", makeEnv())).status).toBe(401);
    expect((await call("/api/refresh/user1", makeEnv(), { method: "POST" })).status).toBe(401);
    expect((await call("/auth/disconnect/user1", makeEnv(), { method: "POST" })).status).toBe(401);
    expect((await call("/auth/login/user1", makeEnv())).status).toBe(401);
  });
  it("can reach only the health check and the sign-in handshake", async () => {
    expect((await call("/health", makeEnv())).status).toBe(200);
    expect([302, 503]).toContain((await call("/auth/signin", makeEnv())).status); // 503 here: no Google client in the stub env
    expect((await call("/auth/callback", makeEnv())).status).toBe(302); // back to the app with error=missing_params
  });
});

describe("cookies that must not work", () => {
  it("forged, garbage, wrong-secret and expired cookies", async () => {
    const bad = [
      "hj_session=garbage",
      "hj_session=abc.123.def",
      `hj_session=${await signSession("another-secret-long-enough-456", "me@gmail.com")}`,
      await session("me@gmail.com", Date.now() - 31 * 24 * 60 * 60 * 1000),
    ];
    for (const cookie of bad) expect((await call("/api/dashboard", makeEnv(), { cookie })).status).toBe(401);
  });
  it("a valid session for an email that is not (or no longer) on the allowlist", async () => {
    expect((await call("/api/dashboard", makeEnv(), { cookie: await session("stranger@gmail.com") })).status).toBe(401);
    const removed = makeEnv({ ALLOWED_EMAILS: "partner@gmail.com" });
    expect((await call("/api/dashboard", removed, { cookie: await session("me@gmail.com") })).status).toBe(401);
  });
});

describe("signed-in, allow-listed visitors", () => {
  it("reach the app and the API", async () => {
    const cookie = await session("me@gmail.com");
    const page = await call("/", makeEnv(), { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("app");
    expect((await call("/auth/status", makeEnv(), { cookie })).status).toBe(200);
  });
  it("are still subject to the same-origin rule on POSTs", async () => {
    const cookie = await session("me@gmail.com");
    const r = await call("/auth/disconnect/user1", makeEnv(), { method: "POST", cookie, headers: { Origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });
});

describe("fails closed", () => {
  it("serves nothing (503) when the allowlist or secret is missing", async () => {
    expect((await call("/", makeEnv({ ALLOWED_EMAILS: "" }))).status).toBe(503);
    expect((await call("/api/dashboard", makeEnv({ ALLOWED_EMAILS: "  " }))).status).toBe(503);
    expect((await call("/", makeEnv({ APP_SECRET: "" }))).status).toBe(503);
  });
  it("is skipped only when REQUIRE_AUTH is explicitly 'false' (local dev)", async () => {
    expect((await call("/", makeEnv({ REQUIRE_AUTH: "false" }))).status).toBe(200);
    expect((await call("/", makeEnv({ REQUIRE_AUTH: "" }))).status).toBe(302); // anything but "false" keeps the gate on
  });
});
