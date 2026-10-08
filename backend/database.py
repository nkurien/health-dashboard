from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os
from dotenv import load_dotenv

load_dotenv()

_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./health.db")

# Ensure we use the aiosqlite async driver
if _DATABASE_URL.startswith("sqlite:///") and not _DATABASE_URL.startswith("sqlite+aiosqlite:"):
    DATABASE_URL = _DATABASE_URL.replace("sqlite:///", "sqlite+aiosqlite:///")
else:
    DATABASE_URL = _DATABASE_URL

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    """Create all tables on startup."""
    from models import UserToken, MetricsSnapshot  # noqa: F401 — ensure models are registered
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """FastAPI dependency that yields an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session
