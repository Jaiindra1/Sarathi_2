"""Validated configuration for the internal HTTP process; no secret defaults."""
import os
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class InternalConfig:
    token: str
    port: int
    host: str


def load_config():
    token = os.getenv("SCRAPER_SERVICE_TOKEN", "")
    if re.fullmatch(r"[A-Za-z0-9_\-]{32,256}", token) is None:
        raise ValueError("SCRAPER_SERVICE_TOKEN must contain 32-256 URL-safe characters.")
    raw_port = os.getenv("PORT", "5000")
    if not raw_port.isascii() or not raw_port.isdecimal() or not 1 <= int(raw_port) <= 65535:
        raise ValueError("PORT must be an integer from 1 to 65535.")
    host = os.getenv("SCRAPER_BIND_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "0.0.0.0", "::1"}:
        raise ValueError("SCRAPER_BIND_HOST must be a loopback or wildcard bind address.")
    return InternalConfig(token, int(raw_port), host)
