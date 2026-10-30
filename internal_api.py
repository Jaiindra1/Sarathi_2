"""Authenticated internal transport around the existing application services."""
import hmac
import os
from pathlib import Path
import sqlite3

from flask import Flask, jsonify, request
import main as legacy
from config import settings
from config.internal import load_config


def readiness():
    """Read-only probes only. Local discovery does not prove browser availability."""
    database_ready = False
    db = None
    try:
        path = Path(settings.SQLITE_DATABASE_PATH).resolve()
        db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1)
        required = {
            "products": {"product_id", "product_identity_key", "current_price", "product_data"},
            "price_history": {"product_id", "search_id", "price", "recorded_at"},
            "searches": {"search_id", "data"},
        }
        database_ready = all(columns <= {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
                             for table, columns in required.items())
    except (OSError, sqlite3.Error, ValueError):
        pass
    finally:
        if db is not None:
            db.close()
    browser = os.getenv("CHROME_BINARY_PATH", "").strip()
    driver = os.getenv("CHROMEDRIVER_PATH", "").strip()
    if browser or driver:
        browser_ready = bool(browser and driver and
                             all(Path(p).is_file() and os.access(p, os.X_OK) for p in (browser, driver)))
    else:
        browser_ready = os.getenv("RENDER", "").lower() != "true"
    accepting = legacy.search_jobs.accepting
    checks = {"database": database_ready, "browser_configuration": browser_ready, "accepting": accepting}
    return checks, all(checks.values())


def create_internal_app(config=None):
    config = config or load_config()
    root = Path(__file__).resolve().parent
    app = Flask(__name__, template_folder=str(root / "templates"), static_folder=str(root / "static"))
    app.config["SERVICE_CONFIG"] = config

    @app.before_request
    def authenticate():
        if request.path in {"/healthz", "/readyz"} and request.method in {"GET", "HEAD"}:
            return None
        supplied = request.headers.get("Authorization", "")
        expected = "Bearer " + config.token
        if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
            response = jsonify(success=False, message="Service authentication required.")
            response.status_code = 401
            response.headers["Cache-Control"] = "no-store"
            return response
        return None

    @app.get("/healthz")
    def health():
        return jsonify(status="ok")

    @app.get("/readyz")
    def ready():
        checks, ok = readiness()
        response = jsonify(status="ready" if ok else "unavailable", checks=checks)
        response.status_code = 200 if ok else 503
        response.headers["Cache-Control"] = "no-store"
        return response

    # Protected compatibility routes keep existing Jinja url_for names, forms,
    # redirects and CLI/test functionality. Only Express is publicly deployed.
    app.add_url_rule("/", "home", legacy.home, methods=["GET", "POST"])
    app.add_url_rule("/feedback", "feedback", legacy.feedback, methods=["GET", "POST"])
    app.add_url_rule("/api/search", "api_search", legacy.api_search, methods=["POST"])
    app.add_url_rule("/api/search/<job_id>/status", "job_status", legacy.job_status)
    app.add_url_rule("/api/search/<job_id>/results", "job_results", legacy.job_results)
    app.add_url_rule("/internal/v1/search", "internal_search", legacy.api_search, methods=["POST"])
    app.add_url_rule("/internal/v1/search/<job_id>/status", "internal_status", legacy.job_status)
    app.add_url_rule("/internal/v1/search/<job_id>/results", "internal_results", legacy.job_results)
    return app
