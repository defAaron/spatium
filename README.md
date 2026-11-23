# Spatium

Turn one photo into a miniature walkthrough with three connected 360° viewpoints and a downloadable video. See the [PRD](docs/prd.md) and [technical architecture](docs/architecture.md).

## Run locally

Requires Node.js 22, Python 3.11 or newer, and uv.

```sh
npm ci
uv sync
uv run uvicorn spatium.main:app --reload --port 8000
```

In a second terminal, run `npm run dev` and open the local Vite URL. The bundled gas-station walkthrough opens immediately. Click **Up close**, drag to look around, or select **Play walkthrough** for a guided visit.

For the built single-origin app, run `npm run build` before starting Uvicorn and open `http://127.0.0.1:8000`.

## How it works

Spatium generates three linked 360° panoramas. Supply one still photo
and a Magic Hour key. The worker requests up to three `gpt-image-2` image edits (about 100 credits each), one per stop,
and sums the provider's reported credits. Previously generated views and the original
photo guide subsequent edits. Lighting, object counts and positions can vary between stops.

Click a ground arrow or a stop name to travel. Drag or use the arrow keys to look around.
W and S move along the route. **Turn around** faces the other direction. **Play walkthrough**
and **Download walkthrough** follow the same ten-second route and finish facing back.
Desktop Chrome exports 300 silent frames at 30 fps.

The bundled example is the live three-stop output made from Carol M. Highsmith’s
public-domain gas station photograph in Hardy, Arkansas. It opens without a key.
[Library of Congress source](https://www.loc.gov/resource/highsm.65037/)

## Same-origin release

Build with `npm ci && npm run build` and install the backend with `uv sync --locked`.
Mount a writable private persistent volume and set `SPATIUM_DATA_DIR` to its path.
The default for development is `.spatium/`. Keep the SQLite database, signing secret,
and asset directory together across restarts.

Start `.venv/bin/uvicorn spatium.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1`.
Point an HTTPS reverse proxy on the same host at port 8000, forward the original scheme,
and allow multipart requests up to 11 MiB. Serve the whole origin through this proxy.
Probe `/api/health` for readiness. The application supports one server process per volume,
one active job, and six new scenes per session per hour. Busy submissions receive HTTP 429.

Reloading the tab restores its scene. After an interrupted provider request, the UI offers
key re-entry to finish the remaining stops, or directs the user to project history for an
uncertain charge. Completed stops stay viewable. Scene access expires 24 hours after submission.
Cleanup runs at startup and once per minute. Before expiry, run
`.venv/bin/python -m spatium.metrics /path/to/volume` for per-scene timings, credits
and successful browser encodes. Interactive time includes
polling and browser load time. The report contains opaque IDs and measurements.

## Free hosted deployment

The free configuration keeps one browser origin while splitting the services:

- **Vercel** builds the frontend (`vercel.json`) and rewrites `/api/*` to the backend, so the
  session cookie and stop images stay same-origin.
- **Render** runs one free web service (`render.yaml`). Its disk is temporary, so nothing
  durable is stored there.
- **Supabase Postgres** holds scene metadata. Set `SPATIUM_DATABASE_URL` to the Supavisor
  session-pooler connection string, because Render cannot reach Supabase's IPv6-only direct host.
- **Cloudflare R2** holds the source photo and stops. Create a private bucket and an API token
  with object read and write access to it, then set `SPATIUM_R2_ACCOUNT_ID`,
  `SPATIUM_R2_ACCESS_KEY_ID`, `SPATIUM_R2_SECRET_ACCESS_KEY` and `SPATIUM_R2_BUCKET`.
  Add a lifecycle rule that deletes objects after one day as a backstop for the 24-hour expiry.
- `SPATIUM_SESSION_SECRET` (at least 32 characters) signs session cookies. Render generates it.
  Changing it signs every browser out.
- `SPATIUM_DAILY_SCENES` caps new walkthroughs per 24 hours across all visitors (50 in
  `render.yaml`), which bounds storage writes. Stop reads are cached in memory and limited to
  about two bucket reads per second, keeping usage far inside R2's free tier.

Deploy the Render blueprint first, then update the rewrite destination in `vercel.json` if
Render assigns a different hostname than `spatium-api.onrender.com`. A free Render service
sleeps after about 15 idle minutes, so the first request afterwards waits for a cold start, and
a job running when the service stops resumes with key re-entry. Without these variables,
Spatium uses SQLite and local files in `SPATIUM_DATA_DIR` as before.

## Verification

Run `uv run python -m unittest discover -s tests` for API integration checks.
Set `SPATIUM_TEST_DATABASE_URL` to a disposable Postgres database to run the store checks against Postgres.
Install FFmpeg (including ffprobe) and install Chromium with `npx playwright install chromium`, then run `npm run build` and
`npm run test:e2e`. The runner starts and stops Uvicorn and Vite on loopback ports
18767 and 18768 and gives the backend a temporary data directory.
