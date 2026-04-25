// smoothScrollTo.ts

import type { Locator, Page } from "playwright"

type Target = string | Locator

export async function smoothScrollTo(
  page: Page,
  target: Target,
  opts?: {
    stepPx?: number // pixels to scroll per tick
    minDelay?: number // ms min delay per step
    maxDelay?: number // ms max delay per step
    offset?: number // optional final offset (e.g., -100 to leave header space)
  }
): Promise<void> {
  const { stepPx = 80, minDelay = 6, maxDelay = 16, offset = 0 } = opts ?? {}
  const randBetween = (a: number, b: number) => a + Math.random() * (b - a)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // Resolve element and target Y on the page
  async function getTargetY(t: Target): Promise<number | null> {
    if (typeof t === "string") {
      const locator = page.locator(t).first()
      const box = await locator.boundingBox()
      if (!box) return null
      const y = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const rect = (el as HTMLElement).getBoundingClientRect()
        return rect.top + window.scrollY
      }, t)
      if (y === null) return null
      return y + offset
    } else {
      const box = await (t as Locator).boundingBox()
      if (!box) return null
      const viewportTop = box.y
      const docY = viewportTop + (await page.evaluate(() => window.scrollY))
      return docY + offset
    }
  }

  const targetY = await getTargetY(target)
  if (targetY === null) return // Element not visible — skip scroll
  const currentY = await page.evaluate(() => window.scrollY)
  if (Math.abs(targetY - currentY) < 4) return // already close

  const direction = targetY > currentY ? 1 : -1
  let y = currentY

  // Use incremental scroll steps
  while ((direction > 0 && y < targetY - 2) || (direction < 0 && y > targetY + 2)) {
    // step with slight randomness
    const step = Math.max(8, Math.round(stepPx * (0.6 + Math.random() * 0.8)))
    y = y + step * direction
    // clamp
    if (direction > 0 && y > targetY) y = targetY
    if (direction < 0 && y < targetY) y = targetY

    // perform scroll
    await page.evaluate((yy) => window.scrollTo({ top: yy, left: 0 }), Math.round(y))
    // small randomized pause to mimic human scroll
    await sleep(Math.round(randBetween(minDelay, maxDelay)))
  }

  // final minor adjustments using element.scrollIntoView if needed
  try {
    if (typeof target === "string") {
      await page.locator(target).first().scrollIntoViewIfNeeded()
    } else {
      await (target as Locator).scrollIntoViewIfNeeded()
    }
  } catch {
    // ignore
  }

  // small final pause
  await sleep(Math.round(randBetween(40, 120)))
}
