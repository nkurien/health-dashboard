import * as auth from "./auth";
import { todayIn } from "./dates";
import { buildUserMetrics, invalidateMetrics } from "./metrics";
import { currentUser } from "./session";
import { isUserId, USER_IDS } from "./types";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function withHeaders(resp: Response, extra: Record<string, string> = {}): Response {
  const out = new Response(resp.body, resp);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) out.headers.set(k, v);
  return out;
}

/** CORS is only for local development (frontend on :3000, Worker on :8787). Off in production. */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !env.DEV_CORS_ORIGIN || origin !== env.DEV_CORS_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

/** State-changing requests must come from our own pages. */
function sameOriginOk(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // non-browser client; Access has already authenticated it
  const own = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : new URL(request.url).origin;
  return origin === own || origin === env.DEV_CORS_ORIGIN;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const today = () => todayIn(env.TIMEZONE);

  if (pathname === "/health" && method === "GET") return json({ status: "ok" });

  let m: RegExpMatchArray | null;

  if (pathname === "/api/dashboard" && method === "GET") {
    const date = today();
    const [user1, user2] = await Promise.all(USER_IDS.map((id) => buildUserMetrics(env, id, date)));
    return json({ date, user1, user2 });
  }

  if ((m = pathname.match(/^\/api\/metrics\/([^/]+)$/)) && method === "GET") {
    if (!isUserId(m[1]!)) return json({ detail: "user_id must be 'user1' or 'user2'" }, 400);
    return json(await buildUserMetrics(env, m[1], today()));
  }

  if ((m = pathname.match(/^\/api\/refresh\/([^/]+)$/)) && method === "POST") {
    if (!isUserId(m[1]!)) return json({ detail: "user_id must be 'user1' or 'user2'" }, 400);
    await invalidateMetrics(m[1], today());
    return json(await buildUserMetrics(env, m[1], today()));
  }

  if (pathname === "/auth/signin" && method === "GET") return auth.signin(env);
  if (pathname === "/auth/signout" && method === "GET") return auth.signout(env);
  if (pathname === "/auth/status" && method === "GET") return auth.status(env);
  if (pathname === "/auth/callback" && method === "GET") return auth.callback(request, env);

  if ((m = pathname.match(/^\/auth\/login\/([^/]+)$/)) && method === "GET") {
    if (!isUserId(m[1]!)) return json({ detail: "Invalid user_id. Use 'user1' or 'user2'." }, 400);
    return auth.login(env, m[1]);
  }

  if ((m = pathname.match(/^\/auth\/disconnect\/([^/]+)$/)) && method === "POST") {
    if (!isUserId(m[1]!)) return json({ detail: "Invalid user_id" }, 400);
    return auth.disconnect(env, m[1]);
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) return json({ detail: "Not found" }, 404);

  // Everything else is the static frontend
  return env.ASSETS.fetch(request);
}

/** Reachable without being signed in: the sign-in handshake itself and the health check. */
const PUBLIC_PATHS = new Set(["/health", "/auth/signin", "/auth/callback", "/auth/signout"]);

/** Returns a Response if the visitor must not proceed (not configured / not signed in). */
async function gate(request: Request, env: Env): Promise<Response | null> {
  if (env.REQUIRE_AUTH === "false") return null; // local development only
  const { pathname } = new URL(request.url);
  if (PUBLIC_PATHS.has(pathname)) return null;

  // Fail closed if sign-in isn't set up: nobody gets in
  if (!env.APP_SECRET || !env.ALLOWED_EMAILS?.trim()) {
    console.error("REQUIRE_AUTH is on but APP_SECRET / ALLOWED_EMAILS are not set");
    return new Response("Service not configured", { status: 503 });
  }
  if (await currentUser(request, env)) return null;

  // Pages send the browser to sign in; API calls just get a 401
  const wantsPage = request.method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/auth/");
  return wantsPage
    ? new Response(null, { status: 302, headers: { Location: "/auth/signin" } })
    : Response.json({ detail: "Not signed in" }, { status: 401 });
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const denied = await gate(request, env);
    if (denied) return withHeaders(denied);

    if (request.method === "POST" && !sameOriginOk(request, env)) {
      return withHeaders(new Response("Forbidden", { status: 403 }), cors);
    }

    try {
      return withHeaders(await route(request, env), cors);
    } catch (err) {
      console.error(JSON.stringify({ msg: "unhandled error", path: new URL(request.url).pathname, error: err instanceof Error ? err.message : String(err) }));
      return withHeaders(Response.json({ detail: "Internal error" }, { status: 500 }), cors);
    }
  },
} satisfies ExportedHandler<Env>;
