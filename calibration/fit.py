#!/usr/bin/env python3
"""
Fit the recovery score to Fitbit's own readiness scores.

  python3 calibration/fit.py [user1|user2]

Needs data/<user>.features.json (export_features.mjs) and data/fitbit_scores_<user>.csv
(date,score). Requires numpy. Prints which signals predict Fitbit's score, with honest
out-of-sample error (leave-one-out and a train-on-past/test-on-future split).
"""
import csv, itertools, json, sys
from datetime import date, timedelta
from pathlib import Path
import numpy as np

MIN_COVERAGE = 0.9  # drop candidate features missing on more than 10% of labelled days
user = next((a for a in sys.argv[1:] if a.startswith("user")), "user1")
D = Path(__file__).parent / "data"
days = json.load(open(D / f"{user}.features.json"))["days"]
scores = {r["date"]: float(r["score"]) for r in csv.DictReader(open(D / f"fitbit_scores_{user}.csv"))}

iso = lambda d: d.isoformat()
prev = lambda s, n: iso(date.fromisoformat(s) - timedelta(days=n))
get = lambda s, k: (days.get(s) or {}).get(k)

def baseline(s, key, n=30, min_n=10):
    vals = [get(prev(s, i), key) for i in range(1, n + 1)]
    vals = [v for v in vals if v is not None]
    return float(np.median(vals)) if len(vals) >= min_n else None

def asleep_h(s):
    n = get(s, "sleep")
    return None if not n else (n["deep"] + n["rem"] + n["light"]) / 60

def weighted_sleep(s):
    ws, tot = 0.0, 0.0
    for w, i in ((0.5, 0), (0.3, 1), (0.2, 2)):
        h = asleep_h(prev(s, i))
        if h: ws += w; tot += w * h
    return min(tot / ws, 9.0) if ws else None

def rel(s, key):  # today relative to the person's own 30-day median
    v, b = get(s, key), baseline(s, key)
    return None if v is None or not b else v / b - 1

def diff(s, key):  # absolute difference from the 30-day median
    v, b = get(s, key), baseline(s, key)
    return None if v is None or b is None else v - b

def azm(s):
    d = days.get(s) or {}
    return None if d.get("azm_fat") is None else d["azm_fat"] + 2 * (d.get("azm_cardio", 0) + d.get("azm_peak", 0))

FEATURES = {
    "hrv_rel":        lambda s: rel(s, "hrv"),
    "hrv_deep_rel":   lambda s: rel(s, "hrv_deep_rmssd"),
    "rhr_diff":       lambda s: None if diff(s, "rhr") is None else -diff(s, "rhr"),
    "nonrem_hr_diff": lambda s: None if diff(s, "nonrem_hr") is None else -diff(s, "nonrem_hr"),
    "resp_diff":      lambda s: None if diff(s, "resp_rate") is None else -diff(s, "resp_rate"),
    "spo2_diff":      lambda s: diff(s, "spo2"),
    "skin_temp_dev":  lambda s: None if get(s, "skin_temp") is None or get(s, "skin_temp_baseline") is None else -(get(s, "skin_temp") - get(s, "skin_temp_baseline")),
    "sleep_last_h":   lambda s: asleep_h(s),
    "sleep_3n_h":     weighted_sleep,
    "deep_pct":       lambda s: None if not get(s, "sleep") else get(s, "sleep")["deep"] / max(1, sum(get(s, "sleep")[k] for k in ("deep", "rem", "light"))),
    "steps_prev_k":   lambda s: None if get(prev(s, 1), "steps") is None else get(prev(s, 1), "steps") / 1000,
    "azm_prev":       lambda s: azm(prev(s, 1)),
    "azm_3d":         lambda s: None if any(azm(prev(s, i)) is None for i in (1, 2, 3)) else sum(azm(prev(s, i)) for i in (1, 2, 3)) / 3,
}

rows = []
for s in sorted(scores):
    f = {k: fn(s) for k, fn in FEATURES.items()}
    rows.append((s, scores[s], f))
usable_by = {k: sum(1 for _, _, f in rows if f[k] is not None) for k in FEATURES}
print(f"{user}: {len(rows)} labelled days; usable per feature:", {k: v for k, v in usable_by.items()})

# Use only features available on (almost) every labelled day, then only days that have all of them
names = [k for k, v in usable_by.items() if v >= MIN_COVERAGE * len(rows)]
def build(cols):
    keep = [(s, y, f) for s, y, f in rows if all(f[c] is not None for c in cols)]
    X = np.column_stack([np.ones(len(keep))] + [[f[c] for _, _, f in keep] for c in cols])
    return keep, X, np.array([y for _, y, _ in keep])

def ols(X, y, lam=1e-6):
    P = np.eye(X.shape[1]) * lam; P[0, 0] = 0
    return np.linalg.solve(X.T @ X + P, X.T @ y)

def loo(X, y):
    p = np.empty(len(y))
    for i in range(len(y)):
        m = np.arange(len(y)) != i
        p[i] = X[i] @ ols(X[m], y[m])
    return float(np.mean(np.abs(p - y))), p

def holdout(X, y, frac=0.7):  # time-ordered: fit on the past, test on the future
    k = int(len(y) * frac)
    b = ols(X[:k], y[:k]); return float(np.mean(np.abs(X[k:] @ b - y[k:])))

# Compare on a common set of days so models are comparable
common = [(s, y, f) for s, y, f in rows if all(f[c] is not None for c in names)]
print(f"models compared on the {len(common)} days that have every candidate feature")
rows_all, rows = rows, common

y = np.array([y for _, y, _ in rows])
print(f"predict-the-average error: {np.mean(np.abs(y - y.mean())):.1f} points (score sd {y.std():.1f})\n")

results = []
for k in range(1, 5):
    for cols in itertools.combinations(names, k):
        keep, X, yy = build(list(cols))
        results.append((loo(X, yy)[0], holdout(X, yy), cols))
results.sort()
print("best models by leave-one-out error (points off, lower is better):")
for mae, ho, cols in results[:12]:
    print(f"  LOO {mae:4.1f}  future-holdout {ho:4.1f}  {' + '.join(cols)}")

def report(cols):
    keep, X, yy = build(list(cols)); b = ols(X, yy); mae, p = loo(X, yy)
    print(f"\n{' + '.join(cols)}  (n={len(keep)}, LOO error {mae:.1f}, in-sample {np.mean(np.abs(X @ b - yy)):.1f})")
    print("  score = " + f"{b[0]:.1f}" + "".join(f" {'+' if c >= 0 else '-'} {abs(c):.2f}*{n}" for c, n in zip(b[1:], cols)))
    worst = np.argsort(-np.abs(p - yy))[:5]
    print("  worst days:", ", ".join(f"{keep[i][0]} fitbit {yy[i]:.0f} vs {p[i]:.0f}" for i in worst))

report(results[0][2])
print("\nfor reference, the currently deployed formula's signals:")
report(["hrv_rel", "rhr_diff", "sleep_3n_h"])
