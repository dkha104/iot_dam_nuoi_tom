# Operations UI validation — 2026-11-17

Implemented browser presentation in public/app.js and public/styles.css. Backend src/, .env, database initialization, ThingsBoard RPC code and stored images were not modified. No dependency added.

Validation:
- 16 selected Node tests passed: ui, domain, sessions, mocked ThingsBoard, demo HTTP API.
- Headless Edge checked overview at 390/768/1280/1440px, all eight pages at desktop, no horizontal document overflow or JS errors.
- Browser checks cover demo command feedback, settings draft preservation across polling, alert polling container identity, URL filter persistence, missing sensor data, out-of-range pH, unknown command and backend outage.
- Browser is restricted to 127.0.0.1:3198. The test server is explicitly demo with camera/TB/MongoDB connection variables empty; .env is not loaded.
- Camera cleanup and real MongoDB integration tests were excluded because they delete generated files/databases.
- Review corrected alert DOM container identity, stale status presentation, URL filter whitelist, command log refresh and missing laser semantics. Alerts do not reconcile while an acknowledgement control is focused.
- Screenshots are retained in run-specific directories; no cleanup performed.

## Running browser checks on another machine

Requires Node.js 22+ and development dependencies. From the repository root:

```sh
npm install
npx playwright install chromium
npm run test:ui
```

On Linux, if system browser libraries are missing, use `npx playwright install --with-deps chromium` (may require administrator privileges). On Windows PowerShell with restricted script execution, use `npm.cmd` and `npx.cmd` instead.

The default browser is Playwright Chromium. To use an already installed Edge or Chrome, set `UI_BROWSER_CHANNEL` to `msedge` or `chrome`, respectively. The script resolves project paths relative to itself, so it also supports direct invocation from another working directory. Port 3198 must be free. It never loads `.env`; all tests use demo data. Generated PNGs are ignored by Git and are retained locally, without cleanup.

Run the five named Node test files explicitly rather than the cleanup-containing full suite.

Implementation helper Python scripts are retained as requested by the no-deletion rule. They are one-time migration records, not runtime dependencies; do not rerun them. No commit or deployment was made.
