# Two-service deployment

These configurations are prepared, not deployed or verified on Render.

## Public Express service

- Docker runtime, repository root build context, Dockerfile.express.
- No command override; starts node src/server.js, unprivileged node user.
- Use Render's PORT, SCRAPER_SERVICE_URL, SCRAPER_SERVICE_TOKEN and
  SCRAPER_REQUEST_TIMEOUT_MS (20000 default).
- SCRAPER_SERVICE_URL must be the Python service's internal HTTP origin, for
  example http://<actual-internal-host>:10000. Obtain the actual address from
  Render; do not use this placeholder or localhost.
- HTTP health path /healthz is liveness; /readyz also checks Python readiness.
- No SQLite mount, Python packages, Chrome, SMTP credentials, or user data here.

## Internal Python service

- Deploy as a private service, in the same Render workspace and region.
- Docker runtime, root Dockerfile and no command override.
- Set SCRAPER_SERVICE_TOKEN to exactly the same high-entropy secret as Express.
- Set PORT to the configured internal listening port (normally 10000).
- Set SQLITE_DATABASE_PATH to /var/data/products.sqlite3 and mount persistent
  storage at /var/data. Ensure UID 10001 can write the database and its directory.
- Restore a verified SQLite backup to this mount before accepting traffic.
  Do not bake the database into either image or automatically reset/seed it.
- Retain CHROME_BINARY_PATH=/usr/bin/chromium, CHROMEDRIVER_PATH=/usr/bin/chromedriver,
  CHROME_NO_SANDBOX=1 and the existing Selenium navigation settings.
- If the deployment currently uses eager and an 8-second timeout, preserve
  SELENIUM_PAGE_LOAD_STRATEGY=eager and SELENIUM_PAGE_LOAD_TIMEOUT=8. The migration
  does not change these defaults or add another shared-memory flag.
- Keep SEARCH_DIAGNOSTICS=1 when collecting diagnostic evidence.
- Configure MAIL_SERVER, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD and
  FEEDBACK_RECIPIENT here for actual feedback delivery. SMTP remains Python-owned.
- Existing preflight runs before Gunicorn. Gunicorn is explicitly one gthread
  worker, two HTTP threads, timeout 30, with conflicting env arguments disabled.
- Private services use Render TCP health checks; Express can query the internal
  /readyz endpoint. Health/readiness never launch a browser or visit retailers.

## Security and transition

The public browser connects only to Express. Every internal Python search, page,
feedback, static, and compatibility route requires the service token. Only
/healthz and /readyz are token-free and reveal no paths or credentials.
Internal Jinja rendering is deliberately retained; Express proxies its output
without redesigning the UI. main.py remains available to existing tests/CLI
imports, but it is not a deployment entry point. Deploy internal_server:app.

The service token must be generated independently (at least 32 URL-safe characters)
and stored as environment secrets, never committed or put in browser code.
Express forwards the original request ID, does not resubmit work automatically,
and owns no job map or database. Do not deploy Python as a public web service.

Render disks are available to paid services and cannot be shared across services.
A free-only deployment cannot guarantee persistent local SQLite data. Free web
services cannot receive private-network requests. Confirm the required plan and
storage before deployment; no paid resources are provisioned by this code.

## Shutdown and limits

Express drains HTTP connections on SIGINT/SIGTERM, with a 10-second close deadline.
Python's local runner stops admitting new searches and waits for active work.
Gunicorn retains its graceful shutdown behavior and worker shutdown deadline.
Do not treat either process stopping or an HTTP timeout as safe Selenium
cancellation. A stuck driver can still require process termination, and an
interrupted search can leave a processing search summary with prior committed
observations. SQLite transactions protect each observation/history update.

Python restarts lose job/request-ID mappings; persisted observations/history
remain only if the disk is durable. Jobs cannot be reconstructed from these rows.

## Manual production acceptance (still required)

1. Build both images; verify matching Chromium/ChromeDriver and preflight logs.
2. Confirm private Python cannot be reached publicly; unauthenticated internal
   search requests must return 401.
3. Confirm both health/readiness paths and database permissions.
4. Open Express's public URL and inspect 202 submission, short status polling,
   terminal results and warning display. Test a second tab while busy.
5. Execute a real retailer search and inspect outcomes without assuming blocking.
6. Verify real SMTP feedback delivery separately.
7. Restart/redeploy and compare SQLite integrity/row counts; verify the old
   in-memory job reports unavailable and a fresh request can be submitted.

References:
- https://render.com/docs/private-network
- https://render.com/docs/disks
- https://render.com/docs/health-checks
- https://render.com/docs/free
