"""
TTL-based in-memory cache with asyncio.Lock for thread safety.
Key format: "{user_id}:{date}" → any JSON-serialisable value.
Default TTL: 15 minutes.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Any, Optional


class TTLCache:
    def __init__(self, ttl_seconds: int = 900) -> None:
        self._cache: dict[str, tuple[Any, datetime]] = {}
        self._lock = asyncio.Lock()
        self._ttl = timedelta(seconds=ttl_seconds)

    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            value, expiry = entry
            if datetime.utcnow() > expiry:
                del self._cache[key]
                return None
            return value

    async def set(self, key: str, value: Any) -> None:
        async with self._lock:
            self._cache[key] = (value, datetime.utcnow() + self._ttl)

    async def invalidate(self, user_id: str) -> None:
        """Remove all cache entries for a given user."""
        async with self._lock:
            keys_to_delete = [k for k in self._cache if k.startswith(f"{user_id}:")]
            for key in keys_to_delete:
                del self._cache[key]

    async def clear(self) -> None:
        async with self._lock:
            self._cache.clear()


# Module-level singleton — shared across all requests
metrics_cache = TTLCache(ttl_seconds=900)
