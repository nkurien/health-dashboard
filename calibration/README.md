# Readiness-score calibration

Goal: make our "Recovery" score track Fitbit's own readiness score as closely as possible.
Google's API doesn't expose Fitbit's number, so we fit our own to it.
The deployed formula lives in `worker/src/readiness.ts` (mirrored by `worker/test/readiness.test.ts`).

## Findings so far (user1, 50 labelled days, Aug 16 – Oct 8 2026)

- Fitbit's score is driven almost entirely by **HRV relative to the person's own 30-day median**
  (~0.8 points per +1% HRV). HRV alone predicts unseen days to **~4.3 points** (predicting the
  average would be ~10).
- Everything else we tried adds **nothing measurable** beyond that (all combos tie at ~4.3 LOO):
  resting HR, non-REM HR, deep-sleep RMSSD, respiratory rate, SpO2, skin temperature,
  sleep duration (last night / weighted last 3), deep-sleep share, previous-day steps / active zone minutes.
  Sleep + deep% gave the best in-sample fit but not a significant out-of-sample gain.
- Days with no Fitbit score (Aug 18, Sep 17, Sep 30, Oct 3) are days with missing watch data.
- Remaining error is probably Fitbit inputs the API doesn't expose (its own activity load, a different HRV window, etc.).

Deployed formula: `60 + 84*(HRV/median30 - 1) + 0.9*(median30 RHR - RHR) + 1.3*(weighted 3-night sleep h - 6.5)`.

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
- Different HRV baselines (7/14/60-day, mean vs median) and deep-sleep RMSSD as the main HRV signal.
- Nonlinearity at the extremes (very low / very high HRV), e.g. a piecewise or log term.
- Exercise sessions / workout load (`exercise` data type) as an activity-load signal.
- A separate fit for the partner; check whether one formula serves both.

## Applying a better formula

1. Update the constants/terms in `worker/src/readiness.ts` and the header comment.
2. Update `worker/test/readiness.test.ts` (and re-run `cd worker && npm test`).
3. `cd worker && npm run deploy`.
