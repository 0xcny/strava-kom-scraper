import { scrapeKomList } from "./scraper"
import { ensureSession } from "./auth"
import { sendDiscord, COLOR } from "./discord"
import { existsSync } from "fs"

const PORT = Number(process.env.PORT) || 3001
const API_SECRET = process.env.API_SECRET
const CACHE_PATH = process.env.SESSION_PATH?.replace("session.json", "cache.json") || "./cache.json"
const ATHLETE_ID = process.env.ATHLETE_ID || "21856708"

let scraping = false

async function runScrape() {
  if (scraping) {
    console.log("[CRON] Scrape already in progress, skipping")
    return
  }

  const hour = new Date().getUTCHours()
  const cestHour = (hour + 2) % 24
  if (cestHour < 7) {
    console.log(`[CRON] Night time (${cestHour}:00 CEST), skipping`)
    return
  }

  scraping = true
  const startTime = Date.now()
  console.log(`[CRON] Starting scrape for athlete ${ATHLETE_ID}`)

  try {
    const cookie = await ensureSession()
    const segmentIds = await scrapeKomList(ATHLETE_ID, cookie)
    await Bun.write(
      CACHE_PATH,
      JSON.stringify({ segment_ids: segmentIds, timestamp: Date.now(), count: segmentIds.length })
    )
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[CRON] Cached ${segmentIds.length} segment IDs`)

    await sendDiscord("scraper", `**Scrape complete** ✓\n\`\`\`\nSegments: ${segmentIds.length}\nDuration: ${duration}s\n\`\`\``, COLOR.green)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[CRON] Scrape failed:", msg)

    await Promise.allSettled([
      sendDiscord("scraper", `**Scrape failed** ✗\n\`\`\`\n${msg.slice(0, 3800)}\n\`\`\``, COLOR.red),
      sendDiscord("alerts", `**Scraper error**\n\`\`\`\n${msg.slice(0, 3800)}\n\`\`\``, COLOR.red),
    ])
  } finally {
    scraping = false
  }
}

function scheduleNextRun() {
  const now = new Date()
  const next = new Date(now)
  next.setMinutes(30, 0, 0)
  if (now.getMinutes() >= 30) {
    next.setHours(next.getHours() + 1)
  }
  const delay = next.getTime() - now.getTime()
  console.log(`[CRON] Next scrape scheduled at ${next.toISOString()} (in ${Math.round(delay / 1000 / 60)}min)`)

  setTimeout(() => {
    runScrape().finally(scheduleNextRun)
  }, delay)
}

runScrape().then(scheduleNextRun)

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname !== "/scrape") {
      return new Response("Not found", { status: 404 })
    }

    const secret = req.headers.get("x-api-secret")
    if (API_SECRET && secret !== API_SECRET) {
      return new Response("Unauthorized", { status: 401 })
    }

    if (!existsSync(CACHE_PATH)) {
      return Response.json(
        { error: "No cached data yet — scrape in progress", scraping },
        { status: 503 }
      )
    }

    const cached = JSON.parse(await Bun.file(CACHE_PATH).text())
    const ageMinutes = Math.round((Date.now() - cached.timestamp) / 1000 / 60)

    return Response.json({
      segment_ids: cached.segment_ids,
      count: cached.count,
      age_minutes: ageMinutes,
      scraping,
    })
  },
})

console.log(`kom-scraper running on port ${PORT}`)
