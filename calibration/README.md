# Readiness-score calibration

Goal: make our "Recovery" score track Fitbit's own readiness score as closely as possible.
Google's API doesn't expose Fitbit's number, so we fit our own to it.
The deployed formula lives in `worker/src/readiness.ts` (mirrored by `worker/test/readiness.test.ts`).

## Findings so far (user1, 50 labelled days: the whole Fitbit history at the time)

- Fitbit's score is driven almost entirely by **HRV relative to the person's own 30-day median**
  (~0.8 points per +1% HRV, better expressed in SDs, see below). Percent-HRV alone predicts unseen days to **~4.3 points** (predicting the
  average would be ~10).
- Everything else we tried adds **nothing measurable** beyond that (all combos tie at ~4.3 LOO):
  resting HR, non-REM HR, deep-sleep RMSSD, respiratory rate, SpO2, skin temperature,
  sleep duration (last night / weighted last 3), deep-sleep share, previous-day steps / active zone minutes.
  Sleep + deep% gave the best in-sample fit but not a significant out-of-sample gain.
- Days with no Fitbit score are days with missing watch data.
- Remaining error is probably Fitbit inputs the API doesn't expose (its own activity load, a different HRV window, etc.).

### HRV parameter sweep

Swept HRV baseline window (7-90 days), mean vs median, transform, multi-day smoothing and HRV source
(192 variants, single feature, 50 days). Findings:

- **z-score beats percent-above-median**: `(HRV - median30) / SD30` gives LOO 3.66 / future-holdout 2.97-3.25 vs
  4.30 / 3.32-3.85 for percent. z won at every window 21-90 days, so it isn't one lucky setting.
- Windows 21-90 days are all fine; 7 and 14 days are clearly worse. Mean vs median: no real difference.
- Averaging HRV over 2-3 nights is much worse (7-8): Fitbit uses a single night.
- Deep-sleep RMSSD instead of overnight HRV is much worse (8.3).
- RHR (z or absolute) and last night's sleep still add nothing once HRV is a z-score, so they were dropped from the score. They are still returned as display-only components for the dashboard's "why" lines.
- Caveat: best-of-192 selection bias; the 21-day mean z (LOO 3.47) is probably luck, so we kept the plain 30-day median.
- Biggest remaining misses: about 11 points either way, e.g. Fitbit well above ours on a day with HRV at its median.

Deployed formula: `59 + 13.8 * (HRV - median30) / SD30` (SD floored at 5% of the median), clamped 0-100.
(Previously: `60 + 84*(HRV/median30 - 1) + 0.9*RHR term + 1.3*sleep term`, LOO 4.3.)

### Squeezing further, and the residuals (second pass)

Tried a small, pre-chosen set of 15 variants and scored the *selection procedure* with nested
leave-one-out (pick the best variant on 49 days, predict the 50th):

- Nested LOO of "pick the best of 15" is **3.72**, worse than just keeping `z30med_sd` (3.48 on the
  same 46 days). Nothing beats the plain z-score by more than its standard error:
  MAD/IQR spread (+0.32 / +0.13 worse), exponentially weighted baseline (-0.14 ± 0.29),
  log-HRV z, z² / separate slope below baseline / tanh saturation, yesterday's z, RHR z,
  skin-temperature deviation (-0.06 ± 0.11), 7-vs-28-day step ratio, previous-day steps.
- The 5% SD floor never binds on this data (identical results without it).
- **Fitbit uses Google's daily HRV number as-is.** Recomputing HRV from the 5-minute samples
  (`heart-rate-variability` data type) over the main sleep is worse whichever window is used:
  mean +0.86, median +0.58, first 4 h +1.85, last 4 h +2.0, deep-only +2.45, non-REM +1.16,
  REM +4.2, ln(HF power) +3.4 points worse. So "a different HRV window" isn't the explanation.
- Residuals vs everything else the API has: |r| ≤ 0.19 for bedtime, wake time, mid-sleep shift
  vs 14-day norm, sleep length, naps, previous-day exercise sessions (minutes, kcal, AZM; nearly all
  are walks), 3-day exercise, RHR, skin temperature, steps (|r| ≈ 0.28 would be needed to be
  distinguishable from noise at n=50).
- Residuals have **zero day-to-day autocorrelation** and the fitted constants are the same in both
  halves of the data (58.8 + 13.3z vs 59.4 + 14.5z), so the misses behave like independent noise:
  Fitbit inputs we can't see, or rounding/noise in its own pipeline. The largest misses had
  nothing unusual in any signal.
- Conclusion: ~3.5 points is the floor for this data. Keep the formula; don't add terms.

## When to refit

The formula is frozen at the first fit (50 days, up to `FROZEN` in `holdout.py`). Every later labelled day is a true holdout.

- **At about 100 labels (50 of them new)**: run `python3 calibration/holdout.py user1`.
  It scores the frozen formula on the new days only and compares a refit of the same two constants.
  Change constants only if the refit wins by more than 2 standard errors.
- Re-run the nested comparison for new terms only then, and only with a short pre-registered list
  (exponentially weighted baseline, skin temperature: the two that weren't clearly worse). A new
  term must beat the frozen formula *on the new days*, not on all 100.
- Alarm: if the frozen formula's error on recent days rises above ~6 or its bias passes ±3, Fitbit
  has probably changed something (algorithm update, new device, illness period): look before refitting.

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

**For user2**: their tokens are only in the *production* database (encrypted with the production
`APP_SECRET`). To export locally they must sign in at `http://localhost:8787` after adding
`http://localhost:8787/auth/callback` to the Google OAuth client's redirect URIs
(`cd worker && npm run dev`), then use `export_features.mjs user2`.

## Second person (user2)

**First check, from the Fitbit app only:** about 50 labelled days with the app's
HRV / RHR / sleep, saved as `data/fitbit_scores_user2.csv` and `data/fitbit_app_user2.csv`. HRV exists only
on labelled days, so the 30-day baseline has gaps; requiring 15+ prior nights leaves about 35 days.

- user1's formula on user2's days: error **~4.6**, ours ~2 points low on average (not significant).
- user2's own refit has the same slope, and no better out of sample (+0.01 ± 0.30).
  **One formula serves both people.**
- Same handicap on user1 (baseline from labelled days only, integer HRV): 3.74 vs 3.50 with full data,
  so most of the extra error is likely the gappy baseline, plus a little more day-to-day noise.
- RHR, sleep hours and sleep score add nothing for user2 either.

A full export would give a complete baseline. It needs user2's local connection (above) and a `data/fitbit_scores_user2.csv`, ideally 30+ days. Then:

```bash
node calibration/export_features.mjs user2 --from 2025-01-01
python3 calibration/holdout.py user2   # user1's formula on all user2 days vs a user2 refit
```

Every user2 day is a holdout for user1's formula. If the user2 refit doesn't win by 2 SE, one formula
serves both. If it does, the usual pattern would be a different intercept (scores run higher or
lower at the same z) rather than a different slope; give user2 their own constants only for what differs.

## Next ideas

- More labelled days, then the refit check above.
- Exponentially weighted baseline, skin temperature: the only two candidates not clearly worse; retest on new days only.

## Applying a better formula

1. Update the constants/terms in `worker/src/readiness.ts` and the header comment.
2. Update `worker/test/readiness.test.ts` (and re-run `cd worker && npm test`).
3. `cd worker && npm run deploy`.
