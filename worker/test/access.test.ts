import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkAccess } from "../src/access";

const TEAM = "https://myteam.cloudflareaccess.com";
const AUD = "aud-tag-123";
let privateKey: CryptoKey;
let strangerKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  strangerKey = other.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  // Serve the "Access certs" endpoint
  vi.stubGlobal("fetch", async (url: string | URL) => {
    if (String(url) === `${TEAM}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });
});
afterEach(() => vi.useRealTimers());

const sign = (opts: { aud?: string; iss?: string; exp?: string; key?: CryptoKey } = {}) =>
  new SignJWT({ email: "me@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? privateKey);

const env = (over: Partial<Env> = {}) => ({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, REQUIRE_ACCESS: "true", ...over }) as Env;
const req = (headers: Record<string, string> = {}) => new Request("https://health.example.com/api/dashboard", { headers });

describe("checkAccess", () => {
  it("accepts a valid token (header)", async () => {
    expect(await checkAccess(req({ "Cf-Access-Jwt-Assertion": await sign() }), env())).toBeNull();
  });
  it("accepts a valid token (CF_Authorization cookie)", async () => {
    expect(await checkAccess(req({ Cookie: `a=b; CF_Authorization=${await sign()}` }), env())).toBeNull();
  });
  it("rejects a missing token", async () => {
    expect((await checkAccess(req(), env()))?.status).toBe(403);
  });
  it("rejects the wrong audience (another Access app)", async () => {
    expect((await checkAccess(req({ "Cf-Access-Jwt-Assertion": await sign({ aud: "other-app" }) }), env()))?.status).toBe(403);
  });
  it("rejects the wrong issuer", async () => {
    const t = await sign({ iss: "https://evil.cloudflareaccess.com" });
    expect((await checkAccess(req({ "Cf-Access-Jwt-Assertion": t }), env()))?.status).toBe(403);
  });
  it("rejects an expired token", async () => {
    const t = await sign({ exp: "-1h" as unknown as string });
    expect((await checkAccess(req({ "Cf-Access-Jwt-Assertion": t }), env()))?.status).toBe(403);
  });
  it("rejects a token signed by someone else's key", async () => {
    const t = await sign({ key: strangerKey });
    expect((await checkAccess(req({ "Cf-Access-Jwt-Assertion": t }), env()))?.status).toBe(403);
  });
  it("rejects garbage", async () => {
    expect((await checkAccess(req({ "Cf-Access-Jwt-Assertion": "not.a.jwt" }), env()))?.status).toBe(403);
  });
  it("fails closed when Access isn't configured", async () => {
    expect((await checkAccess(req(), env({ ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" })))?.status).toBe(503);
    expect((await checkAccess(req(), env({ ACCESS_AUD: "" })))?.status).toBe(503);
  });
  it("is skipped only when explicitly disabled for local dev", async () => {
    expect(await checkAccess(req(), env({ ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", REQUIRE_ACCESS: "false" }))).toBeNull();
  });
});
