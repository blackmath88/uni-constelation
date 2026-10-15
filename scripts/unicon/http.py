"""Polite, cached HTTP client: one request stream, ~1 req/s, bounded retries."""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = (
    "uni-constelation-pilot/0.1 (public-data research map; "
    "+https://github.com/blackmath88/uni-constelation)"
)


class PoliteClient:
    def __init__(self, cache_dir: Path, min_interval: float = 1.0, retries: int = 3,
                 offline: bool = False):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.min_interval = min_interval
        self.retries = retries
        self.offline = offline
        self._last = 0.0
        self.stats = {"network": 0, "cache_hits": 0, "failures": 0}
        self.last_fetched_at: str | None = None  # original fetch time of the last response (cache-aware)

    def _key(self, method: str, url: str, body: bytes | None) -> Path:
        h = hashlib.sha256(method.encode() + url.encode() + (body or b"")).hexdigest()[:24]
        return self.cache_dir / f"{h}.json"

    def request_json(self, method: str, url: str, payload: dict | None = None,
                     headers: dict | None = None, use_cache: bool = True) -> dict:
        body = json.dumps(payload, sort_keys=True).encode() if payload is not None else None
        path = self._key(method, url, body)
        if use_cache and path.exists():
            self.stats["cache_hits"] += 1
            cached = json.loads(path.read_text("utf-8"))
            self.last_fetched_at = cached.get("fetchedAt")
            return cached["response"]
        if self.offline:
            raise RuntimeError(f"offline mode and no cache for {method} {url}")
        hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if body is not None:
            hdrs["Content-Type"] = "application/json"
        hdrs.update(headers or {})
        delay = 2.0
        for attempt in range(self.retries + 1):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            self.stats["network"] += 1
            try:
                req = urllib.request.Request(url, data=body, method=method, headers=hdrs)
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                self.last_fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                path.write_text(json.dumps({
                    "method": method, "url": url, "payload": payload,
                    "fetchedAt": self.last_fetched_at,
                    "response": data,
                }, ensure_ascii=False), "utf-8")
                return data
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                status = getattr(exc, "code", None)
                if status is not None and 400 <= status < 500 and status != 429:
                    self.stats["failures"] += 1
                    raise
                if attempt == self.retries:
                    self.stats["failures"] += 1
                    raise
                time.sleep(delay)
                delay *= 2
        raise AssertionError("unreachable")

    @staticmethod
    def cached_at(cache_dir: Path) -> None:  # pragma: no cover - helper for debugging
        for p in sorted(cache_dir.glob("*.json")):
            print(p.name, json.loads(p.read_text())["url"])


def qs(url: str, params: dict) -> str:
    return url + "?" + urllib.parse.urlencode(params)
