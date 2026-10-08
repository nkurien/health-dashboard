import { SESSION_TTL_SECONDS, signSession, verifySession } from "./crypto";

export const SESSION_COOKIE = "hj_session";

const isHttps = (env: Env) => env.PUBLIC_URL.startsWith("https://");

export function cookieValue(request: Request, name: string): string | null {
  const m = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1] ?? null;
}

export function setCookie(env: Env, name: string, value: string, maxAgeSeconds: number, path = "/"): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${isHttps(env) ? "; Secure" : ""}`;
}

/** Comma/space separated ALLOWED_EMAILS secret -> lower-cased list. */
export function allowedEmails(env: Pick<Env, "ALLOWED_EMAILS">): string[] {
  return (env.ALLOWED_EMAILS ?? "").split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export const isAllowed = (env: Pick<Env, "ALLOWED_EMAILS">, email: string) =>
  allowedEmails(env).includes(email.trim().toLowerCase());

export const startSession = async (env: Env, email: string) =>
  setCookie(env, SESSION_COOKIE, await signSession(env.APP_SECRET, email), SESSION_TTL_SECONDS);

export const endSession = (env: Env) => setCookie(env, SESSION_COOKIE, "", 0);

/** The signed-in, still-allowed email for this request, or null. */
export async function currentUser(request: Request, env: Env): Promise<string | null> {
  const raw = cookieValue(request, SESSION_COOKIE);
  if (!raw) return null;
  const email = await verifySession(env.APP_SECRET, raw);
  // Re-check the allowlist every time, so removing an address locks them out immediately
  return email && isAllowed(env, email) ? email : null;
}
