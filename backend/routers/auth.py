import os
import secrets
from urllib.parse import urlencode
import httpx
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import UserToken
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/auth", tags=["auth"])

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.getenv("REDIRECT_URI", "http://localhost:8000/auth/callback")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SCOPES = " ".join([
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
])

VALID_USER_IDS = {"user1", "user2"}

# In-memory CSRF state store (keyed by csrf_token → user_id)
# Use Redis in a multi-process production deployment
_csrf_states: dict[str, str] = {}


@router.get("/login/{user_id}", summary="Initiate Google OAuth 2.0 for a dashboard user")
async def login(user_id: str):
    if user_id not in VALID_USER_IDS:
        raise HTTPException(status_code=400, detail="Invalid user_id. Use 'user1' or 'user2'.")

    if not CLIENT_ID:
        raise HTTPException(
            status_code=503,
            detail="Google OAuth not configured. Copy backend/.env.example → .env and fill in credentials.",
        )

    csrf_token = secrets.token_urlsafe(32)
    state = f"{user_id}|{csrf_token}"
    _csrf_states[csrf_token] = user_id

    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",  # Forces refresh_token to be issued every time
    }
    query_string = urlencode(params)
    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{query_string}", status_code=302)


@router.get("/callback", summary="Google OAuth 2.0 callback")
async def callback(
    code: str = None,
    state: str = None,
    error: str = None,
    db: AsyncSession = Depends(get_db),
):
    if error:
        return RedirectResponse(url=f"{FRONTEND_URL}/?error={error}")
    if not code or not state:
        return RedirectResponse(url=f"{FRONTEND_URL}/?error=missing_params")

    # Parse and validate CSRF state
    try:
        user_id, csrf_token = state.split("|", 1)
    except ValueError:
        return RedirectResponse(url=f"{FRONTEND_URL}/?error=invalid_state")

    expected_user = _csrf_states.pop(csrf_token, None)
    if expected_user != user_id:
        return RedirectResponse(url=f"{FRONTEND_URL}/?error=csrf_mismatch")

    # Exchange authorisation code for tokens
    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            return RedirectResponse(url=f"{FRONTEND_URL}/?error=token_exchange_failed")

        token_data = token_resp.json()

        # Fetch display name and email
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        userinfo = userinfo_resp.json() if userinfo_resp.status_code == 200 else {}

    expiry = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))

    # Upsert token record
    result = await db.execute(select(UserToken).where(UserToken.user_id == user_id))
    record = result.scalar_one_or_none()

    if record:
        record.access_token = token_data["access_token"]
        record.refresh_token = token_data.get("refresh_token", record.refresh_token)
        record.token_expiry = expiry
        record.google_sub = userinfo.get("id")
        record.display_name = userinfo.get("name", user_id)
        record.email = userinfo.get("email")
    else:
        record = UserToken(
            user_id=user_id,
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_expiry=expiry,
            google_sub=userinfo.get("id"),
            display_name=userinfo.get("name", user_id),
            email=userinfo.get("email"),
        )
        db.add(record)

    await db.commit()

    return RedirectResponse(url=f"{FRONTEND_URL}/?connected={user_id}")


@router.get("/status", summary="Returns connection status for both dashboard users")
async def auth_status(db: AsyncSession = Depends(get_db)):
    result1 = await db.execute(select(UserToken).where(UserToken.user_id == "user1"))
    result2 = await db.execute(select(UserToken).where(UserToken.user_id == "user2"))

    t1 = result1.scalar_one_or_none()
    t2 = result2.scalar_one_or_none()

    return {
        "user1": {
            "connected": t1 is not None,
            "display_name": t1.display_name if t1 else None,
            "email": t1.email if t1 else None,
        },
        "user2": {
            "connected": t2 is not None,
            "display_name": t2.display_name if t2 else None,
            "email": t2.email if t2 else None,
        },
    }


@router.post("/disconnect/{user_id}", summary="Revoke stored tokens for a user")
async def disconnect(user_id: str, db: AsyncSession = Depends(get_db)):
    if user_id not in VALID_USER_IDS:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    result = await db.execute(select(UserToken).where(UserToken.user_id == user_id))
    record = result.scalar_one_or_none()
    if record:
        await db.delete(record)
        await db.commit()

    from services.cache import metrics_cache
    await metrics_cache.invalidate(user_id)

    return {"disconnected": user_id}
