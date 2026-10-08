#!/usr/bin/env node
// Export every daily signal Google gives us for one person, for readiness-score calibration.
//
//   node calibration/export_features.mjs [user1|user2] [--from 2025-01-01] [--to YYYY-MM-DD]
//
// Reads that person's Google connection from the LOCAL Worker database (worker/.wrangler),
// decrypts it with APP_SECRET from worker/.dev.vars, refreshes the access token if needed, and
// writes calibration/data/<user>.features.json (git-ignored: it's personal health data).
// Needs a local connection: see calibration/README.md.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here, "..", "worker");
const args = process.argv.slice(2);
const user = args.find((a) => /^user[12]$/.test(a)) ?? "user1";
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const today = new Date().toISOString().slice(0, 10);
const FROM = opt("--from", "2025-01-01");
const TO = opt("--to", today);

const BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const civil = (d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const toCivil = (iso) => { const [year, month, day] = iso.split("-").map(Number); return { year, month, day }; };
const num = (v) => (v == null ? null : Number(v));

// ---- token: local D1 -> decrypt -> refresh if needed -------------------------------------
const vars = Object.fromEntries(readFileSync(join(worker, ".dev.vars"), "utf8").split("\n").map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const dir = join(worker, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = readdirSync(dir).find((f) => f.endsWith(".sqlite") && !f.startsWith("metadata"));
if (!file) throw new Error("No local D1 database found. Run the worker once: cd worker && npm run dev");
const row = new DatabaseSync(join(dir, file), { readOnly: true }).prepare("SELECT * FROM user_tokens WHERE user_id = ?").get(user);
if (!row) throw new Error(`${user} isn't connected in the local database. See calibration/README.md (\"Getting data\").`);

const enc = new TextEncoder();
const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
async function open(stored) {
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("health-journal-v1"), info: enc.encode("tokens") },
    await crypto.subtle.importKey("raw", enc.encode(vars.APP_SECRET), "HKDF", false, ["deriveKey"]),
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const [iv, ct] = stored.slice("enc:v1:".length).split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct)));
}
let access = await open(row.access_token);
if (!row.token_expiry || Date.now() > row.token_expiry - 300_000) {
  const refresh = await open(row.refresh_token);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: vars.GOOGLE_CLIENT_ID, client_secret: vars.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }) });
  if (!r.ok) throw new Error(`Token refresh failed (${r.status}). Reconnect ${user} in the local app.`);
  access = (await r.json()).access_token;
}
const headers = { Authorization: `Bearer ${access}` };

// ---- fetch helpers -----------------------------------------------------------------------
async function call(url, init) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
    throw new Error(`${url} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error(`${url} kept failing`);
}
async function pages(dataType, filter) {
  const out = []; let token;
  for (let i = 0; i < 400; i++) {
    const u = new URL(`${BASE}/${dataType}/dataPoints`);
    u.searchParams.set("filter", filter); u.searchParams.set("pageSize", "31");
    if (token) u.searchParams.set("pageToken", token);
    const j = await call(u);
    out.push(...(j.dataPoints ?? [])); token = j.nextPageToken;
    if (!token) break;
  }
  return out;
}
const dailyFilter = (field) => `${field}.date >= "${FROM}" AND ${field}.date < "${addDays(TO, 1)}"`;
async function rollup(dataType) {
  const out = [];
  for (let s = FROM; s <= TO; s = addDays(s, 60)) {
    const e = addDays(s, 60) > addDays(TO, 1) ? addDays(TO, 1) : addDays(s, 60);
    const j = await call(`${BASE}/${dataType}/dataPoints:dailyRollUp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ range: { start: { date: toCivil(s) }, end: { date: toCivil(e) } }, windowSizeDays: 1 }) });
    out.push(...(j.rollupDataPoints ?? []));
  }
  return out;
}

const days = {};
const day = (d) => (days[d] ??= {});
const put = (d, fields) => Object.assign(day(d), fields);

console.log(`Exporting ${user}: ${FROM} .. ${TO}`);

for (const p of await pages("daily-resting-heart-rate", dailyFilter("daily_resting_heart_rate"))) {
  const v = p.dailyRestingHeartRate; put(civil(v.date), { rhr: num(v.beatsPerMinute) });
}
for (const p of await pages("daily-heart-rate-variability", dailyFilter("daily_heart_rate_variability"))) {
  const v = p.dailyHeartRateVariability;
  put(civil(v.date), { hrv: num(v.averageHeartRateVariabilityMilliseconds), hrv_deep_rmssd: num(v.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds), nonrem_hr: num(v.nonRemHeartRateBeatsPerMinute), hrv_entropy: num(v.entropy) });
}
for (const p of await pages("daily-respiratory-rate", dailyFilter("daily_respiratory_rate"))) {
  const v = p.dailyRespiratoryRate; put(civil(v.date), { resp_rate: num(v.breathsPerMinute) });
}
for (const p of await pages("daily-oxygen-saturation", dailyFilter("daily_oxygen_saturation"))) {
  const v = p.dailyOxygenSaturation; put(civil(v.date), { spo2: num(v.averagePercentage), spo2_low: num(v.lowerBoundPercentage), spo2_sd: num(v.standardDeviationPercentage) });
}
for (const p of await pages("daily-sleep-temperature-derivations", dailyFilter("daily_sleep_temperature_derivations"))) {
  const v = p.dailySleepTemperatureDerivations;
  put(civil(v.date), { skin_temp: num(v.nightlyTemperatureCelsius), skin_temp_baseline: num(v.baselineTemperatureCelsius), skin_temp_sd30: num(v.relativeNightlyStddev30dCelsius) });
}
for (const p of await rollup("steps")) put(civil(p.civilStartTime.date), { steps: num(p.steps?.countSum) });
for (const p of await rollup("active-zone-minutes")) {
  const v = p.activeZoneMinutes ?? {};
  put(civil(p.civilStartTime.date), { azm_fat: num(v.sumInFatBurnHeartZone) ?? 0, azm_cardio: num(v.sumInCardioHeartZone) ?? 0, azm_peak: num(v.sumInPeakHeartZone) ?? 0 });
}

// Sleep: sessions keyed by the local date the night ended; stages summed in minutes
const kind = { DEEP: "deep", REM: "rem", LIGHT: "light", ASLEEP: "light", AWAKE: "wake", RESTLESS: "wake" };
const sleepPts = await pages("sleep", `sleep.interval.civil_end_time >= "${FROM}" AND sleep.interval.civil_end_time < "${addDays(TO, 1)}"`);
for (const dp of sleepPts) {
  const s = dp.sleep, iv = s?.interval; if (!iv?.endTime) continue;
  const off = parseInt(String(iv.endUtcOffset ?? "0s"), 10) || 0;
  const d = new Date(Date.parse(iv.endTime) + off * 1000).toISOString().slice(0, 10);
  const rec = day(d); const n = (rec.sleep ??= { deep: 0, rem: 0, light: 0, wake: 0, sessions: 0, in_bed_min: 0 });
  n.sessions += 1; n.in_bed_min += Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000);
  for (const st of s.stages ?? []) { const k = kind[st.type]; if (k) n[k] += Math.floor((Date.parse(st.endTime) - Date.parse(st.startTime)) / 60000); }
}

mkdirSync(join(here, "data"), { recursive: true });
const out = join(here, "data", `${user}.features.json`);
const sorted = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(out, JSON.stringify({ user, from: FROM, to: TO, generated: new Date().toISOString(), days: sorted }));
const n = (k) => Object.values(sorted).filter((d) => d[k] != null).length;
console.log(`Wrote ${out}\n  days: ${Object.keys(sorted).length} | hrv ${n("hrv")} rhr ${n("rhr")} resp ${n("resp_rate")} spo2 ${n("spo2")} skin_temp ${n("skin_temp")} steps ${n("steps")} azm ${n("azm_fat")} sleep ${n("sleep")}`);
