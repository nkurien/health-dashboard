/**
 * Keys are derived from a single APP_SECRET with HKDF:
 *  - "state"  : HMAC key signing the OAuth `state` parameter
 *  - "tokens" : AES-GCM key encrypting Google tokens before they go into D1
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
export function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const b64url = (bytes: ArrayBuffer) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (t: string) => unb64(t.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (t.length % 4)) % 4));

type DeriveParams = Parameters<SubtleCrypto["deriveKey"]>;

async function hkdf(secret: string, info: string, usages: DeriveParams[4], algorithm: DeriveParams[2]) {
  if (secret.length < 16) throw new Error("APP_SECRET is missing or too short");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("health-journal-v1"), info: enc.encode(info) },
    base, algorithm, false, usages,
  );
}

const stateKey = (secret: string) => hkdf(secret, "state", ["sign", "verify"], { name: "HMAC", hash: "SHA-256", length: 256 });
const tokenKey = (secret: string) => hkdf(secret, "tokens", ["encrypt", "decrypt"], { name: "AES-GCM", length: 256 });

const PREFIX = "enc:v1:";

export async function encryptToken(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(secret), enc.encode(plain));
  return PREFIX + b64(iv) + "." + b64(ct);
}

export async function decryptToken(secret: string, stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) throw new Error("token is not in the expected encrypted format");
  const [iv, ct] = stored.slice(PREFIX.length).split(".");
  if (!iv || !ct) throw new Error("malformed encrypted token");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(secret), unb64(ct));
  return dec.decode(plain);
}

export interface OAuthState { userId: string; nonce: string }
const STATE_TTL_MS = 10 * 60 * 1000;

/** state = "<userId>.<nonce>.<expiresAtMs>.<hmac>" — stateless, expiring, tamper-proof. */
export async function signState(secret: string, userId: string, nonce: string, now = Date.now()): Promise<string> {
  const payload = `${userId}.${nonce}.${now + STATE_TTL_MS}`;
  const sig = await crypto.subtle.sign("HMAC", await stateKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyState(secret: string, state: string, now = Date.now()): Promise<OAuthState | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, exp, sig] = parts as [string, string, string, string];
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = unb64url(sig);
  } catch {
    return null;
  }
  // crypto.subtle.verify compares in constant time
  const ok = await crypto.subtle.verify("HMAC", await stateKey(secret), sigBytes, enc.encode(`${userId}.${nonce}.${exp}`));
  if (!ok || !(Number(exp) > now)) return null;
  return { userId, nonce };
}

export function randomNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)).buffer);
}
