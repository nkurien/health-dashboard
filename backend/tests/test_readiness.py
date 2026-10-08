from services.readiness import (
    compute_readiness, compute_7d_average, compute_baseline, weighted_sleep_hours, label_for,
)

SLEEP_OK = [390, 390, 390]  # 6.5 h, the neutral reference


def score(hrv=36, hrv_base=36, rhr=76, rhr_base=76, sleep=SLEEP_OK):
    return compute_readiness(hrv, hrv_base, rhr, rhr_base, list(sleep))["score"]


class TestComputeReadiness:
    def test_neutral_day_is_base(self):
        assert score() == 60

    def test_hrv_dominates(self):
        assert score(hrv=45) > 80
        assert score(hrv=27) < 40

    def test_one_percent_hrv_is_under_a_point(self):
        assert 0 < score(hrv=36 * 1.05) - score() <= 5

    def test_lower_rhr_and_more_sleep_help_modestly(self):
        assert score(rhr=72) > score()
        assert score(sleep=(540, 540, 540)) > score()
        assert score(rhr=72) - score() < 6

    def test_hrv_missing_gives_no_score(self):
        r = compute_readiness(None, 36, 76, 76, SLEEP_OK)
        assert r["score"] is None and r["label"] == "Unavailable" and r["components"] == {}
        assert compute_readiness(36, None, 76, 76, SLEEP_OK)["score"] is None

    def test_rhr_and_sleep_are_optional(self):
        r = compute_readiness(36, 36, None, None, [None, None, None])
        assert r["score"] == 60 and list(r["components"]) == ["hrv"]

    def test_score_clamped(self):
        assert score(hrv=500) == 100
        assert score(hrv=1) == 0

    def test_components_are_signed_contributions(self):
        r = compute_readiness(40, 36, 78, 76, SLEEP_OK)
        assert r["components"]["hrv"] > 0 and r["components"]["rhr"] < 0

    def test_matches_recorded_fitbit_days(self):
        """Fitbit readiness vs ours, from real data (inputs: HRV, baseline, RHR, baseline, nights min)."""
        days = [  # fitbit, hrv, hrv_base, rhr, rhr_base, asleep minutes (newest first)
            (66, 36.2, 35.8, 75, 75, [462, 342, 444]),
            (53, 34.0, 36.2, 76, 75, [342, 444, 288]),
            (31, 27.8, 36.2, 78, 75, [258, None, 336]),
        ]
        for fitbit, h, hb, r, rb, sl in days:
            assert abs(score(h, hb, r, rb, sl) - fitbit) <= 12


class TestSleepWeighting:
    def test_missing_nights_use_remaining_weights(self):
        assert weighted_sleep_hours([480, None, None]) == 8.0

    def test_nothing(self):
        assert weighted_sleep_hours([None, None, None]) is None

    def test_cap(self):
        assert weighted_sleep_hours([900, 900, 900]) == 9.0


class TestLabels:
    def test_boundaries(self):
        assert [label_for(x) for x in (100, 85, 84, 70, 69, 55, 54, 40, 39, 0)] == [
            "Optimal", "Optimal", "Good", "Good", "Moderate", "Moderate", "Fair", "Fair", "Poor", "Poor",
        ]


class TestStats:
    def test_7d_average(self):
        assert compute_7d_average([{"v": 10}, {"v": 20}], "v") == 15.0

    def test_average_empty(self):
        assert compute_7d_average([], "v") is None

    def test_baseline_is_median(self):
        assert compute_baseline([{"v": 1}, {"v": 2}, {"v": 100}], "v") == 2
