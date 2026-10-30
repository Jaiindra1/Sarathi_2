"""Exercise shipped JavaScript against a real local Flask/SQLite test server."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import socket
import time
import urllib.request
from threading import Thread
import unittest
from unittest.mock import patch

from werkzeug.serving import make_server
import main
from config import settings
from retailers.outcomes import RetailerSearchError
from services import search_service
from services.search_jobs import SearchJobs
from services.sqlite_client import connection, initialize_database
from config.internal import InternalConfig
from internal_api import create_internal_app
from test_sqlite_integration import listing


class FrontendPollingTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is needed only for JavaScript verification")
    def test_real_api_polling_rendering_and_lost_response_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "frontend.sqlite3"
            manager = SearchJobs()
            real_track = search_service.track_search

            def adapter(retailer):
                def run(query, **kwargs):
                    if query == "both-fail":
                        raise RetailerSearchError(retailer, "blocked_page")
                    return [listing(retailer=retailer)]
                return run

            class FailedRepository:
                def save_search(self, *args, **kwargs):
                    raise OSError("Controlled unavailable storage")

            def track(query, *args, **kwargs):
                if query == "storage-failure":
                    kwargs["repository"] = FailedRepository()
                return real_track(query, *args, **kwargs)

            with patch.object(settings, "SQLITE_DATABASE_PATH", database), patch.object(main, "search_jobs", manager), \
                 patch.object(search_service, "search_flipkart", side_effect=adapter("Flipkart")), \
                 patch.object(search_service, "search_amazon", side_effect=adapter("Amazon")), \
                 patch.object(search_service, "track_search", side_effect=track):
                initialize_database(database)
                token = "local_integration_token_" * 3
                internal = create_internal_app(InternalConfig(token, 5000, "127.0.0.1"))
                server = make_server("127.0.0.1", 0, internal, threaded=True)
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                process = None
                logs = tempfile.TemporaryFile()
                try:
                    with socket.socket() as sock:
                        sock.bind(("127.0.0.1", 0))
                        public_port = sock.getsockname()[1]
                    public_url = f"http://127.0.0.1:{public_port}"
                    env = dict(os.environ, PORT=str(public_port),
                               SCRAPER_SERVICE_URL=f"http://127.0.0.1:{server.server_port}",
                               SCRAPER_SERVICE_TOKEN=token, SCRAPER_REQUEST_TIMEOUT_MS="5000")
                    process = subprocess.Popen(["node", "src/server.js"], env=env, stdout=logs, stderr=logs)
                    started = False
                    for _ in range(50):
                        if process.poll() is not None:
                            break
                        try:
                            with urllib.request.urlopen(public_url + "/readyz", timeout=1) as response:
                                started = response.status == 200
                                break
                        except OSError:
                            time.sleep(0.1)
                    self.assertTrue(started, "Express/internal Python startup did not complete")
                    env["SARATHI_TEST_BASE_URL"] = public_url
                    result = subprocess.run(["node", "test_frontend_polling.cjs"], env=env,
                                            capture_output=True, text=True, encoding="utf-8", timeout=20)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    print(result.stdout.strip())
                    # Real public pages/assets and feedback go through Express.
                    for path in ("/", "/feedback", "/static/js/search.js"):
                        with urllib.request.urlopen(public_url + path, timeout=2) as response:
                            self.assertEqual(response.status, 200)
                    with patch.object(main, "send_feedback_email") as send:
                        body = b"name=Tester&email=tester%40example.com&category=Bug+report&rating=5&feature=Search&subject=Report&message=Message&website="
                        request = urllib.request.Request(public_url + "/feedback", body,
                                                         headers={"Content-Type": "application/x-www-form-urlencoded"})
                        with urllib.request.urlopen(request, timeout=2) as response:
                            self.assertIn(b"Thank you!", response.read())
                        send.assert_called_once()
                    # The lost response must not create a second stored search.
                    with connection(database) as db:
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM searches").fetchone()[0], 2)
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM products").fetchone()[0], 2)
                        self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                finally:
                    if process is not None:
                        process.terminate()
                        process.wait(timeout=10)
                    logs.close()
                    server.shutdown()
                    thread.join(timeout=3)
                    server.server_close()
                    manager._executor.shutdown(wait=True)


if __name__ == "__main__":
    unittest.main()
