#!/usr/bin/env python3
"""
Check the deployed recovery formula on days it has never seen, and decide whether a refit is earned.

  python3 calibration/holdout.py [user1|user2] [--since YYYY-MM-DD]

The formula's constants were fitted on user1's labels up to FROZEN. Every labelled day after that is a
true holdout: nothing about the formula was chosen by looking at it. For user1 the default holdout is
the days after FROZEN; for anyone else it is all their labelled days (the formula was never fitted to them).

Prints the frozen formula's error and bias on the holdout, then compares it with a refit of the same
two constants (leave-one-out on the holdout days). Adopt new constants only if the refit wins by more
than ~2 standard errors; see calibration/README.md ("When to refit").
Requires numpy.
"""
import csv, json, sys
from datetime import date, timedelta
from pathlib import Path
import numpy as np

# Keep in sync with worker/src/readiness.ts
BASE, K_HRV, MIN_SD_FRACTION, WINDOW = 59, 13.8, 0.05, 30
FROZEN = "2026-10-08"  # last labelled day used to fit BASE/K_HRV

args = sys.argv[1:]
user = next((a for a in args if a.startswith("user")), "user1")
since = args[args.index("--since") + 1] if "--since" in args else (FROZEN if user == "user1" else "0000-00-00")
D = Path(__file__).parent / "data"
days = json.load(open(D / f"{user}.features.json"))["days"]
scores = {r["date"]: float(r["score"]) for r in csv.DictReader(open(D / f"fitbit_scores_{user}.csv"))}

def z(s):
    hrv = (days.get(s) or {}).get("hrv")
    d0 = date.fromisoformat(s)
    prior = [(days.get((d0 - timedelta(days=i)).isoformat()) or {}).get("hrv") for i in range(1, WINDOW + 1)]
    prior = np.array([v for v in prior if v is not None], float)
    if hrv is None or len(prior) < 10: return None
    med = np.median(prior)
    return (hrv - med) / max(prior.std(), MIN_SD_FRACTION * med)

held = [(s, scores[s], z(s)) for s in sorted(scores) if s > since]
held = [(s, y, zz) for s, y, zz in held if zz is not None]
if len(held) < 10:
    sys.exit(f"{user}: only {len(held)} labelled days after {since} with HRV; need at least 10 (ideally 30+).")

S = [s for s, _, _ in held]; y = np.array([v for _, v, _ in held]); Z = np.array([v for _, _, v in held])
frozen = np.clip(np.round(BASE + K_HRV * Z), 0, 100)
X = np.column_stack([np.ones(len(Z)), Z])
refit = np.empty(len(y))
for i in range(len(y)):
    m = np.arange(len(y)) != i
    b = np.linalg.lstsq(X[m], y[m], rcond=None)[0]; refit[i] = np.clip(X[i] @ b, 0, 100)
b_all = np.linalg.lstsq(X, y, rcond=None)[0]

ef, er = np.abs(frozen - y), np.abs(refit - y)
d = er - ef; se = d.std(ddof=1) / np.sqrt(len(d))
print(f"{user}: {len(y)} holdout days ({S[0]} .. {S[-1]}), predict-the-average error {np.mean(np.abs(y - y.mean())):.1f}")
print(f"  frozen  {BASE} + {K_HRV}*z     error {ef.mean():.2f}  bias {np.mean(frozen - y):+.2f} (ours minus Fitbit)")
print(f"  refit   {b_all[0]:.1f} + {b_all[1]:.1f}*z   error {er.mean():.2f}  (leave-one-out on these days)")
print(f"  refit - frozen: {d.mean():+.2f} ± {se:.2f} (se)  ->",
      "refit is clearly better: consider new constants" if d.mean() < -2 * se else "keep the frozen formula")
print("  worst days:", ", ".join(f"{S[i]} fitbit {y[i]:.0f} vs {frozen[i]:.0f}" for i in np.argsort(-ef)[:5]))
