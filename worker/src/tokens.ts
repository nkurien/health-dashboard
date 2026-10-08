import { decryptToken, encryptToken } from "./crypto";
import { refreshAccessToken } from "./google";
import type { UserId } from "./types";

export interface TokenRecord {
  userId: UserId;
  accessToken: string;
  refreshToken: string | null;
  expiryMs: number | null;
  googleSub: string | null;
  displayName: string | null;
  email: string | null;
}

interface Row {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expiry: number | null;
  google_sub: string | null;
  display_name: string | null;
  email: string | null;
}

/** Google tokens in D1, AES-GCM encrypted at rest. */
export class TokenStore {
  constructor(private db: D1Database, private secret: string) {}

  async load(userId: UserId): Promise<TokenRecord | null> {
    const row = await this.db.prepare("SELECT * FROM user_tokens WHERE user_id = ?").bind(userId).first<Row>();
    if (!row) return null;
    return {
      userId,
      accessToken: await decryptToken(this.secret, row.access_token),
      refreshToken: row.refresh_token ? await decryptToken(this.secret, row.refresh_token) : null,
      expiryMs: row.token_expiry,
      googleSub: row.google_sub,
      displayName: row.display_name,
      email: row.email,
    };
  }

  async save(r: TokenRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO user_tokens (user_id, access_token, refresh_token, token_expiry, google_sub, display_name, email, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           access_token = excluded.access_token, refresh_token = excluded.refresh_token,
           token_expiry = excluded.token_expiry, google_sub = excluded.google_sub,
           display_name = excluded.display_name, email = excluded.email, updated_at = excluded.updated_at`,
      )
      .bind(
        r.userId,
        await encryptToken(this.secret, r.accessToken),
        r.refreshToken ? await encryptToken(this.secret, r.refreshToken) : null,
        r.expiryMs, r.googleSub, r.displayName, r.email, Date.now(),
      )
      .run();
  }

  async delete(userId: UserId): Promise<void> {
    await this.db.prepare("DELETE FROM user_tokens WHERE user_id = ?").bind(userId).run();
  }

  /** Connection status without touching (or decrypting) any token. */
  async status(): Promise<Record<UserId, { connected: boolean; display_name: string | null; email: string | null }>> {
    const { results } = await this.db
      .prepare("SELECT user_id, display_name, email FROM user_tokens")
      .all<{ user_id: string; display_name: string | null; email: string | null }>();
    const find = (id: UserId) => {
      const r = results.find((x) => x.user_id === id);
      return { connected: !!r, display_name: r?.display_name ?? null, email: r?.email ?? null };
    };
    return { user1: find("user1"), user2: find("user2") };
  }
}

/** What the Health API client needs from a token provider. */
export interface TokenSource {
  /** Valid access token, or null when there isn't one (see hasAccount). */
  get(): Promise<string | null>;
  /** Called after a 401: swap in a fresh token (no-op if someone already did). */
  refresh(stale: string): Promise<string | null>;
  /** True when this user has connected Google at all. */
  hasAccount(): Promise<boolean>;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Per-request token source. The four Google calls run in parallel, so the token
 * is loaded once (memoised) and a refresh is shared rather than repeated.
 */
export class RequestTokenSource implements TokenSource {
  private loaded?: Promise<TokenRecord | null>;
  private refreshing?: Promise<string | null>;
  private current: string | null = null;

  constructor(
    private store: TokenStore,
    private userId: UserId,
    private env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">,
  ) {}

  private load(): Promise<TokenRecord | null> {
    this.loaded ??= this.store.load(this.userId);
    return this.loaded;
  }

  async hasAccount(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async get(): Promise<string | null> {
    const record = await this.load();
    if (!record) return null;
    if (this.current) return this.current;
    const expiring = record.expiryMs === null || Date.now() >= record.expiryMs - REFRESH_MARGIN_MS;
    this.current = expiring && record.refreshToken ? await this.refresh(record.accessToken) : record.accessToken;
    return this.current;
  }

  refresh(stale: string): Promise<string | null> {
    // Someone else already replaced the token we saw fail
    if (this.current && this.current !== stale) return Promise.resolve(this.current);
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string | null> {
    const record = await this.load();
    if (!record?.refreshToken) return null;
    const fresh = await refreshAccessToken(this.env, record.refreshToken);
    if (!fresh) {
      this.current = null;
      return null;
    }
    const updated: TokenRecord = {
      ...record,
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token ?? record.refreshToken,
      expiryMs: Date.now() + fresh.expires_in * 1000,
    };
    await this.store.save(updated);
    this.loaded = Promise.resolve(updated);
    this.current = updated.accessToken;
    return this.current;
  }
}
