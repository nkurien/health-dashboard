/**
 * Defence in depth: Cloudflare Access already gates the domain at the edge, and
 * this verifies the signed Access token again inside the Worker. If Access is
 * ever misconfigured or bypassed, the Worker refuses to serve (fail closed)
 * instead of exposing health data.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

function cookie(request: Request, name: string): string | null {
  const m = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1] ?? null;
}

/** Returns an error Response if the request must be refused, or null if it may proceed. */
export async function checkAccess(request: Request, env: Env): Promise<Response | null> {
  const team = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
  const aud = env.ACCESS_AUD;

  if (!team || !aud) {
    if (env.REQUIRE_ACCESS === "false") return null; // local development only
    console.error("Access is required but ACCESS_TEAM_DOMAIN / ACCESS_AUD are not set");
    return new Response("Service not configured", { status: 503 });
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? cookie(request, "CF_Authorization");
  if (!token) return new Response("Forbidden", { status: 403 });

  try {
    await jwtVerify(token, jwksFor(team), { issuer: team, audience: aud });
    return null;
  } catch (err) {
    console.warn(JSON.stringify({ msg: "access token rejected", error: err instanceof Error ? err.message : String(err) }));
    return new Response("Forbidden", { status: 403 });
  }
}
