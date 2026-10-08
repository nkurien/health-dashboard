# Readiness-score calibration

Goal: make our "Recovery" score track Fitbit's own readiness score as closely as possible.
Google's API doesn't expose Fitbit's number, so we fit our own to it.
The deployed formula lives in `worker/src/readiness.ts` (mirrored by `worker/test/readiness.test.ts`).

## Findings so far (user1, 50 labelled days, Aug 16 – Oct 8 2026; that is the whole Fitbit history)

- Fitbit's score is driven almost entirely by **HRV relative to the person's own 30-day median**
  (~0.8 points per +1% HRV, better expressed in SDs, see below). Percent-HRV alone predicts unseen days to **~4.3 points** (predicting the
  average would be ~10).
- Everything else we tried adds **nothing measurable** beyond that (all combos tie at ~4.3 LOO):
  resting HR, non-REM HR, deep-sleep RMSSD, respiratory rate, SpO2, skin temperature,
  sleep duration (last night / weighted last 3), deep-sleep share, previous-day steps / active zone minutes.
  Sleep + deep% gave the best in-sample fit but not a significant out-of-sample gain.
- Days with no Fitbit score (Aug 18, Sep 17, Sep 30, Oct 3) are days with missing watch data.
- Remaining error is probably Fitbit inputs the API doesn't expose (its own activity load, a different HRV window, etc.).

### HRV parameter sweep (Oct 8)

Swept HRV baseline window (7-90 days), mean vs median, transform, multi-day smoothing and HRV source
(192 variants, single feature, 50 days). Findings:

- **z-score beats percent-above-median**: `(HRV - median30) / SD30` gives LOO 3.66 / future-holdout 2.97-3.25 vs
  4.30 / 3.32-3.85 for percent. z won at every window 21-90 days, so it isn't one lucky setting.
- Windows 21-90 days are all fine; 7 and 14 days are clearly worse. Mean vs median: no real difference.
- Averaging HRV over 2-3 nights is much worse (7-8): Fitbit uses a single night.
- Deep-sleep RMSSD instead of overnight HRV is much worse (8.3).
- RHR (z or absolute) and last night's sleep still add nothing once HRV is a z-score, so they were dropped from the score. They are still returned as display-only components for the dashboard's "why" lines.
- Caveat: best-of-192 selection bias; the 21-day mean z (LOO 3.47) is probably luck, so we kept the plain 30-day median.
- Biggest remaining misses: Sep 15 (fitbit 70, ours 59, HRV at its median), Sep 11, Sep 1, Aug 24 (ours ~8 too high).

Deployed formula: `59 + 13.8 * (HRV - median30) / SD30` (SD floored at 5% of the median), clamped 0-100.
(Previously: `60 + 84*(HRV/median30 - 1) + 0.9*RHR term + 1.3*sleep term`, LOO 4.3.)

## Method

`fit.py` compares every combination of up to 4 candidate signals using
**leave-one-out** error and a **train-on-past / test-on-future** split, on days that have all candidates.
Only trust a feature if it improves *both*. Prefer the simplest model that ties.

## Data (git-ignored: `data/` holds personal health data)

- `data/fitbit_scores_<user>.csv` — `date,score` from the Fitbit app (one row per day that has a score)
- `data/<user>.features.json` — every daily signal from Google, produced by `export_features.mjs`

### Getting data

```bash
# 1. Scores: Fitbit app -> readiness history -> a date,score CSV (save as data/fitbit_scores_user1.csv)
# 2. Features (user1 works today; needs the local Worker connection):
node calibration/export_features.mjs user1 --from 2025-01-01
# 3. Fit:
python3 calibration/fit.py user1          # needs numpy
```

Google keeps ~300 days of HRV / RHR / respiratory rate / SpO2 (since Jan 2025), skin temperature
since mid-June 2026, and steps/sleep further back. The Fitbit app only shows a limited score history.

**For user2** (partner): her tokens are only in the *production* database (encrypted with the production
`APP_SECRET`). To export locally she must sign in at `http://localhost:8787` after adding
`http://localhost:8787/auth/callback` to the Google OAuth client's redirect URIs
(`cd worker && npm run dev`), then use `export_features.mjs user2`.

## Next ideas

- More labelled days (more is better; the history exists back to Jan 2025): re-run `fit.py`.
- Robust spread (MAD instead of SD), or baselines that exclude outlier nights.
- Nonlinearity at the extremes (very low / very high HRV), e.g. a piecewise term; wait for more days first.
- Exercise sessions / workout load (`exercise` data type) as an activity-load signal.
- A separate fit for the partner; check whether one formula serves both.

## Applying a better formula

1. Update the constants/terms in `worker/src/readiness.ts` and the header comment.
2. Update `worker/test/readiness.test.ts` (and re-run `cd worker && npm test`).
3. `cd worker && npm run deploy`.
