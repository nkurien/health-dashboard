# 🏃 Health Dashboard

A **dual-user personal health dashboard** comparing daily Google Health / Fitbit data side-by-side for two users. Built with FastAPI + Next.js.

![Dark glassmorphism dashboard with two user columns showing readiness scores, steps, sleep stages, and heart metrics]

> **Hosting update:** the app now runs as a single Cloudflare Worker (`worker/`) serving the static frontend and a TypeScript API, with a D1 database. See [`worker/README.md`](worker/README.md) for development and deployment. The Python backend in `backend/` is the original implementation, kept for reference.

---

## Features

- **Side-by-side comparison** — User A vs User B in a clean dark glassmorphism UI
- **Readiness Score (0–100)** — Composite of HRV, Resting HR, and Sleep Efficiency with radial gauge
- **Steps** — Progress bar toward daily goal + 7-day trend chart
- **Sleep** — Total duration, efficiency %, and stacked Deep/REM/Light/Awake breakdown
- **Heart & Recovery** — Resting Heart Rate and HRV with 7-day sparklines and delta vs baseline
- **Google Health API v4** — Unified endpoint for Fitbit + Pixel Watch data
- **Demo mode** — Realistic mock data when accounts aren't connected
- **15-minute cache** — In-memory TTL cache avoids hammering the API on every load
- **OAuth 2.0** — Separate login flows for each user; refresh tokens auto-rotated

---

## Quick Start

### 1. Google Cloud Console Setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. **APIs & Services → Library** → search **"Google Health API"** → Enable
3. **APIs & Services → Google Auth Platform** → Create consent screen
   - User type: **External**
   - Add scopes:
     - `googlehealth.activity_and_fitness.readonly`
     - `googlehealth.sleep.readonly`
     - `googlehealth.health_metrics_and_measurements.readonly`
   - **Test users**: add the Google account emails for **both User A and User B**
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Type: **Web application**
   - Redirect URI: `http://localhost:8000/auth/callback`
5. Copy Client ID and Client Secret

### 2. Backend

```bash
cd backend

# Copy and fill in credentials
cp .env.example .env
# Edit .env with your GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --port 8000
```

Backend runs at **http://localhost:8000**  
API docs: **http://localhost:8000/docs**

### 3. Frontend

```bash
cd frontend

# Copy env file (optional — defaults to localhost:8000)
cp .env.local.example .env.local

# Install dependencies (already done if you followed setup)
npm install

# Start dev server
npm run dev
```

Frontend runs at **http://localhost:3000**

### 4. Connect Accounts

1. Open **http://localhost:3000**
2. Click **"Connect Google Health"** for User A → complete Google OAuth
3. Click **"Connect Google Health"** for User B → complete Google OAuth (different account)
4. Both columns now show live data ✅

---

## Project Structure

```
health-dashboard/
├── backend/
│   ├── main.py                    # FastAPI app entrypoint
│   ├── models.py                  # SQLAlchemy models (UserToken, MetricsSnapshot)
│   ├── database.py                # Async SQLite engine
│   ├── routers/
│   │   ├── auth.py                # /auth/login, /auth/callback, /auth/status, /auth/disconnect
│   │   └── metrics.py             # /api/dashboard, /api/metrics/{user_id}, /api/refresh/{user_id}
│   ├── services/
│   │   ├── health_client.py       # Google Health API v4 + mock fallback
│   │   ├── readiness.py           # Readiness Score engine (0–100)
│   │   └── cache.py               # 15-min TTL in-memory cache
│   ├── tests/
│   │   └── test_readiness.py      # Pytest unit tests
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── layout.tsx             # Root layout (dark theme, Inter font)
    │   ├── page.tsx               # Main dashboard page
    │   └── globals.css            # Design system CSS
    ├── components/
    │   ├── DashboardHeader.tsx    # Title, date, refresh button
    │   ├── ConnectionBanner.tsx   # OAuth status + connect/disconnect
    │   ├── UserColumn.tsx         # Container for one user's cards
    │   ├── ReadinessCard.tsx      # Radial gauge + score badge
    │   ├── StepsCard.tsx          # Progress bar + bar chart
    │   ├── SleepCard.tsx          # Sleep stages + efficiency
    │   ├── HeartCard.tsx          # RHR + HRV + sparklines
    │   └── SkeletonCard.tsx       # Loading placeholder
    └── lib/
        ├── api.ts                 # Typed fetch helpers
        └── types.ts               # Shared TypeScript interfaces
```

---

## Recovery Score Formula

Google's API does not expose Fitbit's own readiness score, so this is our own, **fitted to 27 days of Fitbit's scores**. Fitbit's number turned out to be driven almost entirely by HRV relative to your own normal.

```
score = 60
      + 84  * (HRV / 30-day median HRV - 1)           # HRV: ~0.84 pts per +1%
      + 0.9 * (30-day median RHR - today's RHR)        # per bpm lower than usual
      + 1.3 * (last-3-nights sleep hours - 6.5)        # nights weighted 50/30/20
```

clamped to 0-100. HRV is required: until today's HRV has synced there is no score. RHR and sleep are optional small adjustments.

**Accuracy** (one user, 27 days): mean error 3.7 points, 19/27 days within 5, 26/27 within 10; leave-one-out error ~4.5. The old sleep-heavy formula averaged ~11 off. The RHR and sleep terms are weakly determined by this small sample; the HRV term is solid. Re-fit as more days are collected.

| Score | Label |
|---|---|
| 85-100 | Optimal |
| 70-84 | Good |
| 55-69 | Moderate |
| 40-54 | Fair |
| 0-39 | Poor |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/login/{user_id}` | Initiate Google OAuth for user1 or user2 |
| `GET` | `/auth/callback` | OAuth callback — stores tokens |
| `GET` | `/auth/status` | Connection status for both users |
| `POST` | `/auth/disconnect/{user_id}` | Delete stored tokens |
| `GET` | `/api/dashboard` | Combined metrics for both users |
| `GET` | `/api/metrics/{user_id}` | Single-user metrics |
| `POST` | `/api/refresh/{user_id}` | Bust cache and re-fetch |
| `GET` | `/health` | Backend health check |

---

## Running Tests

```bash
cd backend
source .venv/bin/activate
python -m pytest tests/ -v
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python · FastAPI · SQLAlchemy (async) · aiosqlite · httpx |
| Database | SQLite (via aiosqlite) |
| Auth | Google OAuth 2.0 (Authorization Code flow) |
| Health API | Google Health API v4 (`health.googleapis.com`) |
| Frontend | Next.js 15 · React · TypeScript · Tailwind CSS |
| Charts | Recharts |
| Icons | Lucide React |
| Fonts | Inter (Google Fonts) |
