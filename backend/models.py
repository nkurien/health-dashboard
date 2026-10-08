from sqlalchemy import Column, String, Integer, Float, DateTime, Text
from sqlalchemy.sql import func
from database import Base


class UserToken(Base):
    """Stores OAuth tokens for each dashboard user (user1 / user2)."""

    __tablename__ = "user_tokens"

    user_id = Column(String, primary_key=True, index=True)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)
    google_sub = Column(String, nullable=True)   # Google account unique ID
    display_name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class MetricsSnapshot(Base):
    """Cache table for daily health metrics per user."""

    __tablename__ = "metrics_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, index=True, nullable=False)
    date = Column(String, nullable=False)         # YYYY-MM-DD
    steps = Column(Integer, nullable=True)
    step_goal = Column(Integer, nullable=True)
    sleep_json = Column(Text, nullable=True)       # JSON: {total_minutes, efficiency_pct, stages}
    hrv_today = Column(Float, nullable=True)       # RMSSD ms
    hrv_7d_json = Column(Text, nullable=True)      # JSON: [{date, rmssd}]
    rhr_today = Column(Float, nullable=True)       # bpm
    rhr_7d_json = Column(Text, nullable=True)      # JSON: [{date, rhr}]
    readiness_score = Column(Integer, nullable=True)
    readiness_label = Column(String, nullable=True)
    cached_at = Column(DateTime, server_default=func.now())
