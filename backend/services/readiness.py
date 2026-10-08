"""
Recovery score engine
=====================
Google's API does not expose Fitbit's readiness score, so this is our own,
fitted to 26 days of Fitbit scores (leave-one-out error ~4.5 points, vs ~9.7
for predicting the average). Fitbit's number turned out to be driven almost
entirely by HRV relative to your own normal.

    score = 60
          + 84  * (HRV / 30-day median HRV - 1)        ~ +0.84 per +1% HRV
          + 0.9 * (30-day median RHR - today's RHR)     per bpm lower than usual
          + 1.3 * (weighted last-3-nights sleep h - 6.5)

clamped to 0-100. Sleep nights are weighted 50/30/20, newest first.

HRV is required: without it there is no score (None). It usually isn't
available until the watch has synced after waking up. RHR and sleep are
optional adjustments and contribute 0 when missing.

The RHR and sleep terms are weakly determined by the data (small effect,
short history); the HRV term is solid. Re-fit as more days are collected.

Labels: >=85 Optimal | 70-84 Good | 55-69 Moderate | 40-54 Fair | <40 Poor
"""

from statistics import median
from typing import Optional

BASE = 60.0
K_HRV = 84.0           # points per 100% HRV above baseline
K_RHR = 0.9            # points per bpm below baseline
K_SLEEP = 1.3          # points per hour of weighted sleep above SLEEP_REF_H
SLEEP_REF_H = 6.5
SLEEP_CAP_H = 9.0
SLEEP_NIGHT_WEIGHTS = (0.5, 0.3, 0.2)  # most recent night first


def weighted_sleep_hours(recent_asleep_min: list[Optional[float]]) -> Optional[float]:
    """Weighted time asleep (hours) over the last nights, most recent first."""
    pairs = [
        (w, m) for w, m in zip(SLEEP_NIGHT_WEIGHTS, recent_asleep_min)
        if m is not None and m > 0
    ]
    if not pairs:
        return None
    hours = sum(w * m for w, m in pairs) / sum(w for w, _ in pairs) / 60.0
    return min(hours, SLEEP_CAP_H)


def compute_readiness(
    today_hrv: Optional[float],
    hrv_baseline: Optional[float],
    today_rhr: Optional[float],
    rhr_baseline: Optional[float],
    recent_asleep_min: list[Optional[float]],
) -> dict:
    """
    Returns {"score": int | None, "label": str, "components": {name: signed points}}.
    components are contributions relative to the neutral base score.
    score is None (label "Unavailable") when HRV or its baseline is missing.
    """
    if today_hrv is None or not hrv_baseline or hrv_baseline <= 0:
        return {"score": None, "label": "Unavailable", "components": {}}

    components = {"hrv": K_HRV * (today_hrv / hrv_baseline - 1.0)}

    if today_rhr is not None and rhr_baseline and rhr_baseline > 0:
        components["rhr"] = K_RHR * (rhr_baseline - today_rhr)

    hours = weighted_sleep_hours(recent_asleep_min)
    if hours is not None:
        components["sleep"] = K_SLEEP * (hours - SLEEP_REF_H)

    score = max(0, min(100, round(BASE + sum(components.values()))))
    return {
        "score": score,
        "label": label_for(score),
        "components": {k: round(v, 1) for k, v in components.items()},
    }


def label_for(score: int) -> str:
    if score >= 85:
        return "Optimal"
    if score >= 70:
        return "Good"
    if score >= 55:
        return "Moderate"
    if score >= 40:
        return "Fair"
    return "Poor"


def compute_7d_average(series: list[dict], field: str) -> Optional[float]:
    """Mean of `field` across a list of daily records."""
    values = [item[field] for item in series if item.get(field) is not None]
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def compute_baseline(series: list[dict], field: str) -> Optional[float]:
    """Median of `field` across a list of daily records (robust to odd days)."""
    values = [item[field] for item in series if item.get(field) is not None]
    return round(median(values), 2) if values else None
