# Express migration checklist

Baseline: a261a25715a0a74be340fe098ab5cb21db64ac6e; clean integration checkout.
No retailer searches are used in automated checks.

- [x] Confirm branch, commit, clean working tree, database path.
- [x] Consistent SQLite backup outside the repository; integrity ok; 61 products, 60 history rows, 2 searches.
- [x] Run the existing 61 Python/localhost/frontend tests: all passed.
- [x] Capture existing API fixtures in tests/fixtures/api-contract.json using a controlled job manager.
- [x] Protected Python internal interface and health/readiness.
- [x] Express public boundary, API validation, safe proxy, configuration and shutdown.
- [x] Preserve Jinja pages/assets/feedback through authenticated internal proxy.
- [x] Separate deployment instructions and configurations.
- [x] Existing tests, new Python/Node tests and real two-service integration.
- [x] Syntax, startup, record preservation, final diff review.
- [x] User subsequently approved commit/push to Jaiindra1/Sarathi_2.


## Recorded verification

- Baseline 61 tests passed before runtime edits.
- Final combined Python tests: 75 passed, no failures/skips.
- Node tests: 33 passed, no failures/skips; npm audit: 0 reported vulnerabilities.
- Standalone Express and Python entries started on separate localhost ports.
- No automated test ran live retailer searches or real SMTP delivery.
- A separate existing process on port 5000 continued adding search observations
  during implementation. Original backup identities remain present; no restore,
  reset or overwrite was performed. Additional consistent backup and final counts
  are reported in the handoff. Startup checks use isolated ports.
- Local .env/api-node.env were generated once with a matched random token and
  remain ignored. Neither configuration contains real SMTP credentials.

Final pre-push backup: ../sqlite-backups/products-before-push-20261030-162105.sqlite3; integrity ok; 122 products, 122 history rows, 4 searches. All original record identities remain. Python syntax: 43 files passed; JavaScript syntax passed.
