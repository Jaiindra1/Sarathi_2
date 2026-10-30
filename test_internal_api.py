"""Protected internal transport checks; no browsers or real SMTP connections."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import main
from config import settings
from config.internal import InternalConfig, load_config
from internal_api import create_internal_app
from services.search_jobs import SearchJobs
from services.sqlite_client import initialize_database


class InternalApiTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "internal.sqlite3"
        initialize_database(self.path)
        setting = patch.object(settings, "SQLITE_DATABASE_PATH", self.path)
        setting.start()
        self.addCleanup(setting.stop)
        self.manager = SearchJobs()
        self.addCleanup(self.manager.close)
        route = patch.object(main, "search_jobs", self.manager)
        route.start()
        self.addCleanup(route.stop)
        self.token = "internal_test_token_" * 4
        self.client = create_internal_app(InternalConfig(self.token, 5000, "127.0.0.1")).test_client()
        self.headers = {"Authorization": "Bearer " + self.token}

    def test_every_internal_search_page_asset_and_compatibility_route_requires_token(self):
        for path, method in [
            ("/internal/v1/search", "POST"), ("/internal/v1/search/id/status", "GET"),
            ("/internal/v1/search/id/results", "GET"), ("/", "GET"), ("/feedback", "POST"),
            ("/static/js/search.js", "GET"), ("/api/search", "POST"),
        ]:
            for header in ({}, {"Authorization": "Bearer incorrect"}):
                response = self.client.open(path, method=method, headers=header)
                self.assertEqual(response.status_code, 401)
                self.assertNotIn(self.token, response.get_data(as_text=True))

    def test_internal_submission_uses_same_manager_and_original_job_id(self):
        request_id = uuid4().hex
        with patch.object(self.manager._executor, "submit"):
            submitted = self.client.post("/internal/v1/search", json={"query": " phone ", "request_id": request_id}, headers=self.headers)
            self.assertEqual(submitted.status_code, 202)
            duplicate = self.client.post("/internal/v1/search", json={"query": " phone ", "request_id": request_id}, headers=self.headers)
            self.assertEqual(duplicate.json["job_id"], submitted.json["job_id"])
            job_id = submitted.json["job_id"]
            response = self.client.get("/internal/v1/search/" + job_id + "/status", headers=self.headers)
            self.assertEqual(response.json["query"], "phone")
            self.assertEqual(response.json["status"], "queued")
            self.assertNotIn("request_id", response.json)
            self.assertEqual(self.client.get("/internal/v1/search/" + job_id + "/results", headers=self.headers).status_code, 202)

    def test_conflicting_query_and_busy_submission_keep_409(self):
        request_id = uuid4().hex
        with patch.object(self.manager._executor, "submit"):
            self.client.post("/internal/v1/search", json={"query": "phone", "request_id": request_id}, headers=self.headers)
            for body in ({"query": "different", "request_id": request_id}, {"query": "phone", "request_id": uuid4().hex}):
                self.assertEqual(self.client.post("/internal/v1/search", json=body, headers=self.headers).status_code, 409)

    def test_known_failed_job_is_200_and_missing_job_is_404(self):
        with patch.object(self.manager._executor, "submit"):
            submitted = self.client.post("/internal/v1/search", json={"query": "phone", "request_id": uuid4().hex}, headers=self.headers)
        job_id = submitted.json["job_id"]
        with self.manager._lock:
            self.manager._jobs[job_id].update(status="failed", message="Controlled retailer failure")
        response = self.client.get("/internal/v1/search/" + job_id + "/results", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["success"])
        self.assertEqual(response.json["status"], "failed")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.client.get("/internal/v1/search/missing/status", headers=self.headers).status_code, 404)

    def test_health_and_readiness_never_create_database_or_launch_browser(self):
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        with patch("core.browser.create_browser", side_effect=AssertionError("No browser in health checks")), \
             patch("services.sqlite_client.initialize_database", side_effect=AssertionError("No DB initialization in readiness")):
            self.assertEqual(self.client.get("/healthz").json, {"status": "ok"})
            response = self.client.get("/readyz")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["status"], "ready")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)

    def test_missing_database_is_unready_without_creating_a_file(self):
        missing = self.path.parent / "missing.sqlite3"
        with patch.object(settings, "SQLITE_DATABASE_PATH", missing):
            self.assertEqual(self.client.get("/readyz").status_code, 503)
        self.assertFalse(missing.exists())

    def test_invalid_explicit_browser_configuration_is_unready_without_navigation(self):
        with patch.dict("os.environ", CHROME_BINARY_PATH="/missing/chrome", CHROMEDRIVER_PATH="/missing/driver"):
            self.assertEqual(self.client.get("/readyz").status_code, 503)

    def test_shutting_down_rejects_new_work_but_keeps_existing_job_lookup(self):
        request_id = uuid4().hex
        with patch.object(self.manager._executor, "submit"):
            job = self.manager.submit("phone", request_id)
        self.manager.stop_accepting()
        self.assertEqual(self.manager.submit("phone", request_id)["job_id"], job["job_id"])
        self.assertEqual(self.client.get("/readyz").status_code, 503)
        with self.assertLogs("main", level="ERROR"):
            response = self.client.post("/internal/v1/search", json={"query": "phone", "request_id": uuid4().hex}, headers=self.headers)
        self.assertEqual(response.status_code, 503)

    def test_internal_factory_does_not_change_legacy_test_or_cli_application(self):
        self.assertEqual(main.app.test_client().get("/").status_code, 200)

    def test_jinja_escaping_form_bootstrap_and_asset_delivery_are_preserved(self):
        response = self.client.get("/", headers=self.headers)
        self.assertIn(b'id="search-form"', response.data)
        self.assertIn(b'data-job-id=""', response.data)
        with self.client.get("/static/js/search.js", headers=self.headers) as asset:
            self.assertEqual(asset.status_code, 200)
            asset.get_data()
        with patch.object(self.manager._executor, "submit"):
            form = self.client.post("/", data={"query": "<script>alert(1)</script>"}, headers=self.headers)
        self.assertEqual(form.status_code, 303)
        page = self.client.get(form.location, headers=self.headers)
        self.assertNotIn(b'value="<script>', page.data)
        self.assertIn(b"&lt;script&gt;", page.data)

    def feedback(self, **overrides):
        return dict(name="Tester", email="tester@example.com", category="Bug report", rating="5",
                    feature="Search", subject="A report", message="A message", website="", **overrides)

    def test_feedback_fields_validation_and_honeypot(self):
        body = self.feedback()
        with patch.object(main, "send_feedback_email") as send:
            response = self.client.post("/feedback", data=body, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"Thank you!", response.data)
            self.assertEqual(send.call_args.args[0]["rating"], 5)
            self.assertEqual(send.call_args.args[0]["message"], body["message"])
            send.reset_mock()
            body["website"] = "spam"
            self.client.post("/feedback", data=body, headers=self.headers)
            send.assert_not_called()
            body["website"] = ""; body["email"] = "invalid"
            self.assertIn(b"valid email", self.client.post("/feedback", data=body, headers=self.headers).data)

    def test_missing_smtp_configuration_is_clear_and_does_not_leak_credentials(self):
        with patch.object(main, "send_feedback_email", side_effect=RuntimeError("Email configuration is incomplete.")), \
             self.assertLogs("main", level="ERROR") as logged:
            response = self.client.post("/feedback", data=self.feedback(), headers=self.headers)
        self.assertIn(b"Feedback email is not configured", response.data)
        self.assertNotIn("Email configuration is incomplete", " ".join(logged.output))

    def test_existing_smtp_starttls_login_and_delivery_are_retained(self):
        from services import feedback_service
        with patch.object(feedback_service, "MAIL_USERNAME", "test@example.com"), \
             patch.object(feedback_service, "MAIL_PASSWORD", "not-a-real-password"), \
             patch.object(feedback_service, "FEEDBACK_RECIPIENT", "owner@example.com"), \
             patch.object(feedback_service.smtplib, "SMTP") as smtp:
            feedback_service.send_feedback_email(self.feedback())
            session = smtp.return_value.__enter__.return_value
            session.starttls.assert_called_once()
            session.login.assert_called_once_with("test@example.com", "not-a-real-password")
            session.send_message.assert_called_once()

    def test_configuration_rejects_missing_token_and_invalid_port_without_printing_values(self):
        with patch.dict("os.environ", SCRAPER_SERVICE_TOKEN="", PORT="5000"):
            with self.assertRaises(ValueError):
                load_config()
        with patch.dict("os.environ", SCRAPER_SERVICE_TOKEN=self.token, PORT="bad"):
            with self.assertRaises(ValueError) as raised:
                load_config()
            self.assertNotIn(self.token, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
