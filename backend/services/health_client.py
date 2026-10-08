"""
Google Health API v4 Client
============================
Fetches health data from https://health.googleapis.com/v4/users/me/dataTypes/

Supported data types:
  - steps
  - sleep
  - daily-resting-heart-rate
  - daily-heart-rate-variability

When no OAuth token is found for a user, all methods fall back to deterministic
mock data seeded by user_id so the dashboard always displays realistic values
in demo mode.
"""

import asyncio
import httpx
import random
import os
import zlib
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import UserToken
from dotenv import load_dotenv

load_dotenv()

HEALTH_API_BASE = "https://health.googleapis.com/v4/users/me/dataTypes"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")


class HealthAPIError(Exception):
    """A connected user's Google Health request failed (as opposed to not being connected)."""


class GoogleHealthClient:
    def __init__(self, user_id: str, db: AsyncSession) -> None:
        self.user_id = user_id
        self.db = db
        # The 4 data calls run concurrently but share one DB session, which
        # allows only one operation at a time - so token access is serialized.
        self._token_lock = asyncio.Lock()
        self._token_loaded = False
        self._token: Optional[str] = None

    # ──────────────────────────────────────────────
    # Token management
    # ──────────────────────────────────────────────

    async def _load_token_record(self) -> Optional[UserToken]:
        result = await self.db.execute(
            select(UserToken).where(UserToken.user_id == self.user_id)
        )
        return result.scalar_one_or_none()

    async def _has_token_record(self) -> bool:
        async with self._token_lock:
            return await self._load_token_record() is not None

    async def _get_valid_access_token(self) -> Optional[str]:
        """Token for this request (loaded/refreshed once, then reused). None = not connected."""
        async with self._token_lock:
            if not self._token_loaded:
                self._token = await self._fetch_valid_access_token()
                self._token_loaded = True
            return self._token

    async def _force_refresh(self) -> Optional[str]:
        async with self._token_lock:
            record = await self._load_token_record()
            refreshed = await self._refresh_tokens(record) if record else None
            self._token = refreshed.access_token if refreshed else None
            return self._token

    async def _fetch_valid_access_token(self) -> Optional[str]:
        record = await self._load_token_record()
        if record is None:
            return None

        # Refresh if expiring within 5 minutes
        needs_refresh = (
            record.token_expiry is None
            or datetime.utcnow() >= record.token_expiry - timedelta(minutes=5)
        )
        if needs_refresh and record.refresh_token:
            refreshed = await self._refresh_tokens(record)
            return refreshed.access_token if refreshed else None

        return record.access_token

    async def _refresh_tokens(self, record: UserToken) -> Optional[UserToken]:
        """Exchange refresh_token for a new access_token and persist it."""
        if not record.refresh_token:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    TOKEN_URL,
                    data={
                        "client_id": CLIENT_ID,
                        "client_secret": CLIENT_SECRET,
                        "refresh_token": record.refresh_token,
                        "grant_type": "refresh_token",
                    },
                )
            if resp.status_code != 200:
                return None

            data = resp.json()
            record.access_token = data["access_token"]
            record.token_expiry = datetime.utcnow() + timedelta(
                seconds=data.get("expires_in", 3600)
            )
            if "refresh_token" in data:
                record.refresh_token = data["refresh_token"]

            await self.db.commit()
            await self.db.refresh(record)
            return record
        except Exception:
            return None

    # ──────────────────────────────────────────────
    # Raw HTTP helper
    # ──────────────────────────────────────────────

    async def _get(self, data_type: str, params: dict | None = None) -> Optional[dict]:
        return await self._request("GET", data_type, "dataPoints", params=params)

    async def _request(
        self,
        method: str,
        data_type: str,
        suffix: str,
        params: dict | None = None,
        body: dict | None = None,
    ) -> Optional[dict]:
        """
        {method} /v4/users/me/dataTypes/{data_type}/{suffix}   (suffix: dataPoints | dataPoints:dailyRollUp)
        Returns parsed JSON, or None if the user isn't connected (callers use mock data).
        Raises HealthAPIError if the user is connected but the request fails.
        """
        token = await self._get_valid_access_token()
        if not token:
            if await self._has_token_record():
                raise HealthAPIError("Google token expired or revoked - reconnect this account")
            return None

        url = f"{HEALTH_API_BASE}/{data_type}/{suffix}"
        headers = {"Authorization": f"Bearer {token}"}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.request(method, url, headers=headers, params=params or {}, json=body)

                # Attempt one token refresh on 401
                if resp.status_code == 401:
                    new_token = await self._force_refresh()
                    if new_token:
                        headers["Authorization"] = f"Bearer {new_token}"
                        resp = await client.request(method, url, headers=headers, params=params or {}, json=body)

                if resp.status_code != 200:
                    raise HealthAPIError(
                        f"{data_type}: HTTP {resp.status_code} {resp.text[:200]}"
                    )
                return resp.json()
        except HealthAPIError:
            raise
        except Exception as exc:
            raise HealthAPIError(f"{data_type}: {exc}") from exc

    # ──────────────────────────────────────────────
    # Response parsing helpers
    # ──────────────────────────────────────────────

    @staticmethod
    def _civil_date(d: dict) -> str:
        return f"{int(d['year']):04d}-{int(d['month']):02d}-{int(d['day']):02d}"

    @staticmethod
    def _next_day(iso: str) -> str:
        return (datetime.fromisoformat(iso) + timedelta(days=1)).strftime("%Y-%m-%d")

    @staticmethod
    def _parse_ts(ts: str) -> datetime:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))

    # ──────────────────────────────────────────────
    # Public API methods
    # ──────────────────────────────────────────────

    async def get_steps(self, target_date: str) -> dict:
        """Total steps for target_date (local civil day) via the daily rollup."""
        y, m, d = (int(x) for x in target_date.split("-"))
        nxt = datetime.fromisoformat(target_date) + timedelta(days=1)
        data = await self._request(
            "POST",
            "steps",
            "dataPoints:dailyRollUp",
            body={
                "range": {
                    "start": {"date": {"year": y, "month": m, "day": d}},
                    "end": {"date": {"year": nxt.year, "month": nxt.month, "day": nxt.day}},
                },
                "windowSizeDays": 1,
            },
        )
        if data is None:
            return self._mock_steps(target_date)

        total = 0
        for pt in data.get("rollupDataPoints", []):
            if self._civil_date(pt["civilStartTime"]["date"]) == target_date:
                total += int(pt.get("steps", {}).get("countSum", 0))
        return {"steps": total, "goal": 10000, "is_mock": False}

    async def get_steps_series(self, start_date: str, end_date: str) -> list[dict]:
        """Daily step totals for [start_date, end_date] -> [{"date", "steps"}], oldest first."""
        y, m, d = (int(x) for x in start_date.split("-"))
        nxt = datetime.fromisoformat(end_date) + timedelta(days=1)
        data = await self._request(
            "POST",
            "steps",
            "dataPoints:dailyRollUp",
            body={
                "range": {
                    "start": {"date": {"year": y, "month": m, "day": d}},
                    "end": {"date": {"year": nxt.year, "month": nxt.month, "day": nxt.day}},
                },
                "windowSizeDays": 1,
            },
        )
        if data is None:
            out, cur = [], datetime.fromisoformat(start_date)
            while cur <= datetime.fromisoformat(end_date):
                day = cur.strftime("%Y-%m-%d")
                out.append({"date": day, "steps": self._mock_steps(day)["steps"]})
                cur += timedelta(days=1)
            return out
        out = [
            {"date": self._civil_date(pt["civilStartTime"]["date"]),
             "steps": int(pt.get("steps", {}).get("countSum", 0))}
            for pt in data.get("rollupDataPoints", [])
        ]
        return sorted(out, key=lambda x: x["date"])

    async def get_sleep(self, target_date: str) -> dict:
        """Sleep stages and efficiency for the night ending on target_date."""
        data = await self._get(
            "sleep",
            {
                "filter": (
                    f'sleep.interval.civil_end_time >= "{target_date}" '
                    f'AND sleep.interval.civil_end_time < "{self._next_day(target_date)}"'
                ),
                "pageSize": 25,
            },
        )
        if data is None:
            return self._mock_sleep(target_date)

        stages = {"deep": 0, "rem": 0, "light": 0, "wake": 0}
        kind = {"DEEP": "deep", "REM": "rem", "LIGHT": "light", "ASLEEP": "light", "AWAKE": "wake", "RESTLESS": "wake"}

        for dp in data.get("dataPoints", []):
            for st in dp.get("sleep", {}).get("stages", []):
                key = kind.get(st.get("type"))
                if key is None:
                    continue
                try:
                    secs = (self._parse_ts(st["endTime"]) - self._parse_ts(st["startTime"])).total_seconds()
                except (KeyError, ValueError):
                    continue
                stages[key] += int(secs / 60)

        total_min = sum(stages.values())
        asleep = total_min - stages["wake"]
        efficiency = round(asleep / total_min * 100, 1) if total_min > 0 else 0.0
        return {
            "total_minutes": total_min,
            "efficiency_pct": efficiency,
            "stages": stages,
            "is_mock": False,
        }

    async def get_asleep_minutes(self, start_date: str, end_date: str) -> dict[str, float]:
        """Minutes actually asleep per night, keyed by the date the night ENDED (wake-up day)."""
        data = await self._get(
            "sleep",
            {
                "filter": (
                    f'sleep.interval.civil_end_time >= "{start_date}" '
                    f'AND sleep.interval.civil_end_time < "{self._next_day(end_date)}"'
                ),
                "pageSize": 25,
            },
        )
        if data is None:
            out = {}
            cur = datetime.fromisoformat(start_date)
            while cur <= datetime.fromisoformat(end_date):
                m = self._mock_sleep(cur.strftime("%Y-%m-%d"))
                out[cur.strftime("%Y-%m-%d")] = m["total_minutes"] - m["stages"]["wake"]
                cur += timedelta(days=1)
            return out

        out: dict[str, float] = {}
        for dp in data.get("dataPoints", []):
            sl = dp.get("sleep", {})
            iv = sl.get("interval", {})
            if not iv.get("endTime"):
                continue
            # Sleep intervals carry UTC time + offset (no civil time): wake-up local date
            offset = int(str(iv.get("endUtcOffset", "0s")).rstrip("s") or 0)
            day = (self._parse_ts(iv["endTime"]) + timedelta(seconds=offset)).strftime("%Y-%m-%d")
            asleep = 0
            for st in sl.get("stages", []):
                if st.get("type") in ("DEEP", "REM", "LIGHT", "ASLEEP"):
                    try:
                        asleep += (self._parse_ts(st["endTime"]) - self._parse_ts(st["startTime"])).total_seconds() / 60
                    except (KeyError, ValueError):
                        continue
            out[day] = out.get(day, 0) + asleep
        return out

    async def _get_daily_series(self, data_type: str, filter_field: str, start_date: str, end_date: str) -> list[dict]:
        """Daily-type data points (one per civil date) -> [(date, dataPoint-body)], oldest first."""
        data = await self._get(
            data_type,
            {
                "filter": (
                    f'{filter_field}.date >= "{start_date}" '
                    f'AND {filter_field}.date < "{self._next_day(end_date)}"'
                ),
                "pageSize": 31,
            },
        )
        if data is None:
            return None  # type: ignore[return-value]
        return data.get("dataPoints", [])

    async def get_rhr_series(self, start_date: str, end_date: str) -> list[dict]:
        """Resting heart rate for each day in [start_date, end_date]."""
        pts = await self._get_daily_series(
            "daily-resting-heart-rate", "daily_resting_heart_rate", start_date, end_date
        )
        if pts is None:
            return self._mock_rhr_series(start_date, end_date)
        out = [
            {"date": self._civil_date(p["dailyRestingHeartRate"]["date"]),
             "rhr": float(p["dailyRestingHeartRate"]["beatsPerMinute"])}
            for p in pts if "beatsPerMinute" in p.get("dailyRestingHeartRate", {})
        ]
        return sorted(out, key=lambda x: x["date"])

    async def get_hrv_series(self, start_date: str, end_date: str) -> list[dict]:
        """Daily average HRV (ms) for each day in [start_date, end_date]. Key kept as 'rmssd'."""
        pts = await self._get_daily_series(
            "daily-heart-rate-variability", "daily_heart_rate_variability", start_date, end_date
        )
        if pts is None:
            return self._mock_hrv_series(start_date, end_date)
        out = [
            {"date": self._civil_date(p["dailyHeartRateVariability"]["date"]),
             "rmssd": round(float(p["dailyHeartRateVariability"]["averageHeartRateVariabilityMilliseconds"]), 1)}
            for p in pts if "averageHeartRateVariabilityMilliseconds" in p.get("dailyHeartRateVariability", {})
        ]
        return sorted(out, key=lambda x: x["date"])

    # ──────────────────────────────────────────────
    # Mock data generators (deterministic per user)
    # ──────────────────────────────────────────────

    def _seed(self, extra: str = "") -> int:
        """Stable seed derived from user_id + context string (hash() is randomized per process)."""
        return zlib.crc32((self.user_id + extra).encode()) % (2 ** 31)

    def _mock_steps(self, target_date: str) -> dict:
        rng = random.Random(self._seed(target_date))
        steps = rng.randint(5000, 14000)
        return {"steps": steps, "goal": 10000, "is_mock": True}

    def _mock_sleep(self, target_date: str) -> dict:
        rng = random.Random(self._seed(target_date + "sleep"))
        total = rng.randint(360, 510)   # 6–8.5 h in minutes
        wake = rng.randint(15, 45)
        deep = rng.randint(55, 100)
        rem = rng.randint(80, 130)
        light = max(0, total - wake - deep - rem)
        efficiency = round((total - wake) / total * 100, 1) if total > 0 else 85.0
        return {
            "total_minutes": total,
            "efficiency_pct": efficiency,
            "stages": {"deep": deep, "rem": rem, "light": light, "wake": wake},
            "is_mock": True,
        }

    def _mock_rhr_series(self, start_date: str, end_date: str) -> list[dict]:
        rng = random.Random(self._seed("rhr_base"))
        base = rng.uniform(52, 70)
        result = []
        current = datetime.fromisoformat(start_date)
        end = datetime.fromisoformat(end_date)
        while current <= end:
            day_rng = random.Random(self._seed(current.strftime("%Y-%m-%d") + "rhr"))
            rhr = round(base + day_rng.uniform(-4, 4), 1)
            result.append({"date": current.strftime("%Y-%m-%d"), "rhr": rhr})
            current += timedelta(days=1)
        return result

    def _mock_hrv_series(self, start_date: str, end_date: str) -> list[dict]:
        rng = random.Random(self._seed("hrv_base"))
        base = rng.uniform(28, 62)
        result = []
        current = datetime.fromisoformat(start_date)
        end = datetime.fromisoformat(end_date)
        while current <= end:
            day_rng = random.Random(self._seed(current.strftime("%Y-%m-%d") + "hrv"))
            rmssd = round(max(12, base + day_rng.uniform(-6, 6)), 1)
            result.append({"date": current.strftime("%Y-%m-%d"), "rmssd": rmssd})
            current += timedelta(days=1)
        return result
