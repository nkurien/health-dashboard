from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from database import init_db
from routers import auth, metrics


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise the SQLite database on startup."""
    await init_db()
    yield


app = FastAPI(
    title="Health Dashboard API",
    description="Dual-User Personal Health Dashboard — Google Health API v4 backend",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Allow any localhost origin in development so any port works without reconfiguring
allow_origins = [frontend_url]
if "localhost" in frontend_url or "127.0.0.1" in frontend_url:
    # Accept both the configured URL and common dev ports
    allow_origins = [
        frontend_url,
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(metrics.router)


@app.get("/health", tags=["system"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
