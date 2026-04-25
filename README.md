# kom-scraper

Fallback data source for the KomQuest update pipeline. Scrapes an athlete's KOM segment list from Strava's web UI and serves it via HTTP. Used when the Strava API is rate-limited or unavailable.

## How it fits in

The KomQuest update API (Vercel) runs every hour at :00 to detect KOM gains and losses. It tries the Strava API first, but Strava aggressively rate-limits — so this scraper runs at :30 to have fresh data cached and ready as a fallback.

```
:30 every hour                     :00 every hour
┌──────────────┐                   ┌──────────────────────┐
│  kom-scraper │                   │  Update API (Vercel) │
│              │   GET /scrape     │                      │
│  Strava HTML ├──────────────────>│  1. Try Strava API   │
│  → cache.json│   (fallback)      │  2. Fallback: scraper│
└──────────────┘                   │  3. Diff with DB     │
                                   │  4. Record gains/    │
                                   │     losses           │
                                   └─────────┬────────────┘
                                             │
                                   ┌─────────▼────────────┐
                                   │  PocketBase          │
                                   │  (kom_efforts,       │
                                   │   kom_timeseries,    │
                                   │   segments)          │
                                   └──────────────────────┘
```

## What it does

1. **Authenticates with Strava** — Strava uses email + 2FA. The scraper automates the full login flow: enters the email via Playwright, then polls Gmail over IMAP to grab the one-time code as soon as it arrives. Sessions are persisted to disk and reused until they expire.

2. **Scrapes the KOM list** — Fetches `/athletes/{id}/segments/leader` page by page, parses the HTML tables with Cheerio, and collects all segment IDs. Validates that each page returned the expected 20 segments (except the last) to catch partial scrapes.

3. **Caches and serves** — Writes results to `cache.json` with a timestamp. The `/scrape` endpoint returns the cached data along with its age so the update API can decide whether to trust it.

Login requests go through a residential proxy to avoid IP blocks. The browser uses a stealth plugin and human-like input delays to avoid bot detection.

## API

```
GET /scrape
Headers: x-api-secret: <secret>

{
  "segment_ids": [123456, 789012, ...],
  "count": 1250,
  "age_minutes": 28,
  "scraping": false
}
```

## Run

```bash
# Local
bun install
bun run index.ts

# Docker
docker compose up
```

## Environment

| Variable | Description |
|---|---|
| `STRAVA_EMAIL` | Strava account email |
| `GMAIL_USER` | Gmail address for IMAP OTP retrieval |
| `GMAIL_APP_PASSWORD` | Gmail app-specific password |
| `API_SECRET` | Shared secret for `/scrape` endpoint |
| `ATHLETE_ID` | Strava athlete ID to track |
| `FLOPPY_USER` | Residential proxy username |
| `FLOPPY_PASS` | Residential proxy password |
| `SESSION_PATH` | Path to persist session state |
| `PORT` | HTTP server port (default 3001) |

## Stack

Bun, TypeScript, Playwright, Cheerio, ImapFlow, Docker

## Project structure

```
├── index.ts                  # HTTP server + hourly scheduler
├── auth.ts                   # Login with 2FA via IMAP
├── scraper.ts                # Paginated HTML extraction with retry
├── lib.ts                    # Shared utils (delays, user agent)
├── fetch-proxies.ts          # Residential proxy config
├── behaviour-functions/
│   ├── humanType.ts          # Randomized typing with typo simulation
│   ├── moveMouse.ts          # Smooth mouse movement (cubic easing)
│   ├── smoothScroll.ts       # Gradual page scrolling
│   └── hoverBeforClick.ts    # Scroll → hover → click sequence
├── Dockerfile
└── docker-compose.yml
```
