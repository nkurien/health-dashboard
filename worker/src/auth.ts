import { randomNonce, signState, verifyState } from "./crypto";
import { buildAuthUrl, exchangeCode, fetchUserInfo } from "./google";
import { invalidateMetrics } from "./metrics";
import { todayIn } from "./dates";
import { TokenStore, type TokenRecord } from "./tokens";
import type { UserId } from "./types";

const NONCE_COOKIE = "oauth_nonce";

const isHttps = (env: Env) => env.PUBLIC_URL.startsWith("https://");
const frontend = (env: Env) => (env.FRONTEND_URL || env.PUBLIC_URL).replace(/\/+$/, "");

function nonceCookie(env: Env, value: string, maxAge: number): string {
  return `${NONCE_COOKIE}=${value}; Path=/auth; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(env) ? "; Secure" : ""}`;
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** GET /auth/login/:userId — start Google sign-in. */
export async function login(env: Env, userId: UserId): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.PUBLIC_URL) {
    return new Response("Google sign-in isn't configured (GOOGLE_CLIENT_ID / PUBLIC_URL).", { status: 503 });
  }
  const nonce = randomNonce();
  const state = await signState(env.APP_SECRET, userId, nonce);
  // The nonce is also bound to this browser by a cookie, so a state link can't be replayed elsewhere.
  return redirect(buildAuthUrl(env, state), nonceCookie(env, nonce, 600));
}

/** GET /auth/callback — Google sends the browser back here. */
export async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const back = (query: string) => redirect(`${frontend(env)}/?${query}`, nonceCookie(env, "", 0));

  const error = url.searchParams.get("error");
  if (error) return back(`error=${encodeURIComponent(error)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("error=missing_params");

  const verified = await verifyState(env.APP_SECRET, state);
  const cookieNonce = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${NONCE_COOKIE}=([^;]+)`))?.[1];
  if (!verified || !cookieNonce || cookieNonce !== verified.nonce) return back("error=csrf_mismatch");
  const userId = verified.userId as UserId;
  if (userId !== "user1" && userId !== "user2") return back("error=invalid_state");

  const tokens = await exchangeCode(env, code);
  if (!tokens) return back("error=token_exchange_failed");
  const info = await fetchUserInfo(tokens.access_token);

  const store = new TokenStore(env.DB, env.APP_SECRET);
  const existing = await store.load(userId);
  const record: TokenRecord = {
    userId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? existing?.refreshToken ?? null,
    expiryMs: Date.now() + tokens.expires_in * 1000,
    googleSub: info.id ?? null,
    displayName: info.name ?? userId,
    email: info.email ?? null,
  };
  await store.save(record);
  await invalidateMetrics(userId, todayIn(env.TIMEZONE));
  return back(`connected=${userId}`);
}

/** GET /auth/status */
export async function status(env: Env): Promise<Response> {
  return Response.json(await new TokenStore(env.DB, env.APP_SECRET).status());
}

/** POST /auth/disconnect/:userId — forget the stored tokens. */
export async function disconnect(env: Env, userId: UserId): Promise<Response> {
  await new TokenStore(env.DB, env.APP_SECRET).delete(userId);
  await invalidateMetrics(userId, todayIn(env.TIMEZONE));
  return Response.json({ disconnected: userId });
}
