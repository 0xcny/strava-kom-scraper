import { load } from "cheerio"
import { randomDelay, USER_AGENT } from "./lib"

const BASE_URL = "https://www.strava.com/athletes"
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY = 3000

export async function scrapeKomList(athleteId: string, cookie: string): Promise<number[]> {
  const segmentIds: number[] = []
  let page = 1
  let totalPages: number | null = null

  while (totalPages === null || page <= totalPages) {
    const { ids, lastPage } = await fetchPageWithRetry(athleteId, cookie, page)

    if (page === 1) {
      if (lastPage === null) throw new Error("Could not determine total pages from first page")
      totalPages = lastPage
      console.log(`Total pages: ${totalPages}`)
    }

    if (ids.length === 0 && page <= totalPages) {
      throw new Error(`Page ${page} returned 0 segments — expected data on pages 1-${totalPages}`)
    }

    segmentIds.push(...ids)
    console.log(`Page ${page}/${totalPages}: ${ids.length} segments (total: ${segmentIds.length})`)

    page++

    if (page <= totalPages) {
      await randomDelay(1000, 2500)
    }
  }

  // Check if there's an extra page beyond what pagination showed (siteWrap)
  if (segmentIds.length === totalPages! * 20) {
    const extraPage = totalPages! + 1
    console.log(`[SCRAPER] Segment count divisible by 20 — checking extra page ${extraPage}`)
    try {
      const { ids } = await fetchPageWithRetry(athleteId, cookie, extraPage)
      if (ids.length > 0) {
        segmentIds.push(...ids)
        console.log(`Page ${extraPage}/${extraPage}: ${ids.length} segments (total: ${segmentIds.length})`)
      }
    } catch {
      // Extra page doesn't exist, that's fine
    }
  }

  // Verify completeness: every page should have had 20 segments except possibly the last
  const expectedMin = (totalPages! - 1) * 20
  if (segmentIds.length < expectedMin) {
    throw new Error(
      `Incomplete scrape: got ${segmentIds.length} segments but expected at least ${expectedMin} from ${totalPages} pages`
    )
  }

  const uniqueIds = [...new Set(segmentIds)]
  console.log(`Done: ${uniqueIds.length} unique segments scraped from ${totalPages} pages`)
  return uniqueIds
}

async function fetchPageWithRetry(
  athleteId: string,
  cookie: string,
  page: number
): Promise<{ ids: number[]; lastPage: number | null }> {
  let delay = INITIAL_RETRY_DELAY

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = `${BASE_URL}/${athleteId}/segments/leader?page=${page}&top_tens=false`
      const res = await fetch(url, {
        headers: {
          Cookie: cookie,
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-DE,en;q=0.9",
        },
      })

      if (res.status === 503 || res.status === 500) {
        console.log(`[RETRY] Page ${page}: ${res.status} on attempt ${attempt}/${MAX_RETRIES}, waiting ${delay}ms...`)
        await new Promise((r) => setTimeout(r, delay))
        delay *= 2
        continue
      }

      if (res.status === 403) {
        throw new Error(`Session expired or invalid (403 on page ${page})`)
      }

      if (!res.ok) {
        throw new Error(`Unexpected status ${res.status} on page ${page}`)
      }

      const html = await res.text()
      return parseKomPage(html)
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      console.log(`[RETRY] Page ${page}: error on attempt ${attempt}/${MAX_RETRIES}, waiting ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
    }
  }

  throw new Error(`Failed to fetch page ${page} after ${MAX_RETRIES} retries`)
}

function parseKomPage(html: string): { ids: number[]; lastPage: number | null } {
  const $ = load(html)
  const ids: number[] = []

  $("table.my-segments tbody tr").each((_, row) => {
    const segmentLink = $(row).find('td a[href*="/segments/"]').first()
    const href = segmentLink.attr("href")
    if (!href) return
    const match = href.match(/\/segments\/(\d+)/)
    if (match) {
      ids.push(Number(match[1]))
    }
  })

  let lastPage: number | null = null
  $("ul.pagination li a").each((_, el) => {
    const href = $(el).attr("href")
    if (!href) return
    const pageMatch = href.match(/page=(\d+)/)
    if (pageMatch) {
      const p = Number(pageMatch[1])
      if (!lastPage || p > lastPage) lastPage = p
    }
  })

  return { ids, lastPage }
}
