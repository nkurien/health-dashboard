import asyncio
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db, AsyncSessionLocal
from services.health_client import GoogleHealthClient, HealthAPIError
from services.readiness import compute_readiness, compute_7d_average, compute_baseline
from services.cache import metrics_cache

router = APIRouter(prefix="/api", tags=["metrics"])

VALID_USER_IDS = {"user1", "user2"}


async def _build_user_metrics(user_id: str, db: AsyncSession, target_date: str) -> dict:
    """
    Core aggregation function. Checks cache first; fetches from API on miss.
    All four Google Health API calls run concurrently via asyncio.gather.
    """
    cache_key = f"{user_id}:{target_date}"
    cached = await metrics_cache.get(cache_key)
    if cached:
        return {**cached, "from_cache": True}

    target = date.fromisoformat(target_date)
    seven_days_ago = (target - timedelta(days=6)).isoformat()
    baseline_start = (target - timedelta(days=29)).isoformat()
    sleep_start = seven_days_ago  # 7 nights: cards show them, readiness uses the latest 3
    client = GoogleHealthClient(user_id, db)

    # Fetch all data in parallel
    results = await asyncio.gather(
        client.get_steps(target_date),
        client.get_sleep(target_date),
        client.get_rhr_series(baseline_start, target_date),
        client.get_hrv_series(baseline_start, target_date),
        client.get_asleep_minutes(sleep_start, target_date),
        client.get_steps_series(seven_days_ago, target_date),
        return_exceptions=True,
    )
    names = ["steps", "sleep", "rhr", "hrv", "sleep_history", "steps_history"]
    errors: dict[str, str] = {}
    for name, res in zip(names, results):
        if isinstance(res, HealthAPIError):
            errors[name] = str(res)
        elif isinstance(res, BaseException):
            raise res
    steps_data = results[0] if "steps" not in errors else {"steps": None, "goal": 10000, "is_mock": False}
    sleep_data = results[1] if "sleep" not in errors else {
        "total_minutes": None, "efficiency_pct": None,
        "stages": {"deep": 0, "rem": 0, "light": 0, "wake": 0}, "is_mock": False,
    }
    rhr_30d = results[2] if "rhr" not in errors else []
    hrv_30d = results[3] if "hrv" not in errors else []
    asleep_by_night = results[4] if "sleep_history" not in errors else {}
    steps_series = results[5] if "steps_history" not in errors else []
    # The cards show a 7-day window; the 30-day series is only for baselines.
    rhr_series = [d for d in rhr_30d if d["date"] >= seven_days_ago]
    hrv_series = [d for d in hrv_30d if d["date"] >= seven_days_ago]

    # Extract today's snapshot values from the 7-day series
    today_rhr = next((d["rhr"] for d in rhr_30d if d["date"] == target_date), None)
    today_hrv = next((d["rmssd"] for d in hrv_30d if d["date"] == target_date), None)

    # Compute baselines excluding today (fall back to full series if needed)
    prior_rhr = [d for d in rhr_series if d["date"] != target_date]
    prior_hrv = [d for d in hrv_series if d["date"] != target_date]
    rhr_7d_avg = compute_7d_average(prior_rhr, "rhr") or compute_7d_average(rhr_series, "rhr")
    hrv_7d_avg = compute_7d_average(prior_hrv, "rmssd") or compute_7d_average(hrv_series, "rmssd")

    readiness = compute_readiness(
        today_hrv=today_hrv,
        hrv_baseline=compute_baseline([d for d in hrv_30d if d["date"] != target_date], "rmssd"),
        today_rhr=today_rhr,
        rhr_baseline=compute_baseline([d for d in rhr_30d if d["date"] != target_date], "rhr"),
        recent_asleep_min=[
            asleep_by_night.get((target - timedelta(days=i)).isoformat()) for i in range(3)
        ],
    )

    metrics = {
        "user_id": user_id,
        "date": target_date,
        "is_mock": bool(steps_data.get("is_mock") or sleep_data.get("is_mock")),
        "errors": errors,
        "from_cache": False,
        "steps": {**steps_data, "series": steps_series},
        "sleep": {
            **sleep_data,
            "series": [
                {"date": day, "asleep_minutes": round(mins)}
                for day, mins in sorted(asleep_by_night.items())
            ],
        },
        "heart": {
            "rhr_today": today_rhr,
            "rhr_7d_avg": rhr_7d_avg,
            "rhr_series": rhr_series,
            "hrv_today": today_hrv,
            "hrv_7d_avg": hrv_7d_avg,
            "hrv_series": hrv_series,
        },
        "readiness": readiness,
    }

    if not errors:  # don't pin a transient failure in the cache for 15 minutes
        await metrics_cache.set(cache_key, metrics)
    return metrics


@router.get("/dashboard", summary="Fetch metrics for both users in one call")
async def get_dashboard():
    today = date.today().isoformat()

    async def for_user(user_id: str) -> dict:
        # One DB session per user: a session can't be shared across concurrent tasks.
        async with AsyncSessionLocal() as session:
            return await _build_user_metrics(user_id, session, today)

    user1, user2 = await asyncio.gather(for_user("user1"), for_user("user2"))
    return {"date": today, "user1": user1, "user2": user2}


@router.get("/metrics/{user_id}", summary="Fetch metrics for a single user")
async def get_user_metrics(user_id: str, db: AsyncSession = Depends(get_db)):
    if user_id not in VALID_USER_IDS:
        raise HTTPException(status_code=400, detail="user_id must be 'user1' or 'user2'")
    return await _build_user_metrics(user_id, db, date.today().isoformat())


@router.post("/refresh/{user_id}", summary="Bust cache and re-fetch metrics for a user")
async def refresh_user_metrics(user_id: str, db: AsyncSession = Depends(get_db)):
    if user_id not in VALID_USER_IDS:
        raise HTTPException(status_code=400, detail="user_id must be 'user1' or 'user2'")
    await metrics_cache.invalidate(user_id)
    return await _build_user_metrics(user_id, db, date.today().isoformat())
