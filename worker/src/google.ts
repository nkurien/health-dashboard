const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

type OAuthEnv = Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "PUBLIC_URL">;

export const redirectUri = (env: Pick<Env, "PUBLIC_URL">) => `${env.PUBLIC_URL}/auth/callback`;

export function buildAuthUrl(env: OAuthEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: SCOPES,
    state,
    access_type: "offline",
    prompt: "consent", // makes Google issue a refresh token every time
  });
  return `${AUTH_URL}?${params}`;
}

/** Sign-in only asks who you are (email) — no health data scopes. */
export function buildSigninUrl(env: OAuthEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

function parseTokens(json: unknown): GoogleTokens | null {
  if (typeof json !== "object" || json === null) return null;
  const j = json as Record<string, unknown>;
  if (typeof j.access_token !== "string") return null;
  return {
    access_token: j.access_token,
    refresh_token: typeof j.refresh_token === "string" ? j.refresh_token : undefined,
    expires_in: typeof j.expires_in === "number" ? j.expires_in : 3600,
  };
}

async function tokenRequest(env: OAuthEnv, form: Record<string, string>): Promise<GoogleTokens | null> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...form }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    console.warn(JSON.stringify({ msg: "google token request failed", status: resp.status, grant: form.grant_type }));
    return null;
  }
  return parseTokens(await resp.json());
}

export const exchangeCode = (env: OAuthEnv, code: string) =>
  tokenRequest(env, { code, redirect_uri: redirectUri(env), grant_type: "authorization_code" });

export const refreshAccessToken = (env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">, refreshToken: string) =>
  tokenRequest({ ...env, PUBLIC_URL: "" }, { refresh_token: refreshToken, grant_type: "refresh_token" });

export async function fetchUserInfo(accessToken: string): Promise<{ id?: string; name?: string; email?: string; verified_email?: boolean }> {
  const resp = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  return resp.ok ? ((await resp.json()) as { id?: string; name?: string; email?: string; verified_email?: boolean }) : {};
}
