import type { Locator, Page } from "playwright"

type Target = string | Locator | { x: number; y: number }

export async function moveMouse(
  page: Page,
  target: Target,
  opts?: {
    steps?: number // how many intermediate mouse moves
    jitter?: number // max random jitter in pixels added to intermediate points
    minDelay?: number // min ms between step moves
    maxDelay?: number // max ms between step moves
  }
): Promise<void> {
  const { steps = 18, jitter = 4, minDelay = 5, maxDelay = 18 } = opts ?? {}

  const randBetween = (a: number, b: number) => a + Math.random() * (b - a)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // Resolve target to absolute x,y
  async function resolveTarget(t: Target): Promise<{ x: number; y: number } | null> {
    if (typeof t === "object" && "x" in t && "y" in t) return { x: t.x, y: t.y }
    if (typeof t === "string") {
      const locator = page.locator(t).first()
      const box = await locator.boundingBox()
      if (!box) return null
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    // Locator
    if (typeof t === "object") {
      const box = await (t as Locator).boundingBox()
      if (!box) return null
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    return null
  }

  const dest = await resolveTarget(target)
  if (!dest) return // Element not visible — skip mouse movement

  // Get current mouse position by asking the page for last mouse event - if not available, assume center of viewport
  // Playwright doesn't expose mouse position, so we track by injecting a small script to get last mousepos if set previously.
  const current = await page.evaluate(() => {
    // @ts-ignore - purposely keep local to page
    // If not present, fallback to center of window
    // We try to use window.__playwright_last_mouse_pos if previously created; otherwise center.
    // This is best-effort — if not present, use center.
    // NOTE: storing mouse pos on the page is only for movement starting point estimation.
    // It's okay if it doesn't exist.
    // eslint-disable-next-line no-underscore-dangle
    const p = (window as any).__playwright_last_mouse_pos
    if (p && typeof p.x === "number" && typeof p.y === "number") return p
    return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }
  })

  // Keep page-side last mouse pos up-to-date (best-effort)
  await page.evaluate(() => {
    // eslint-disable-next-line no-underscore-dangle
    if (!(window as any).__playwright_last_mouse_pos) {
      ;(window as any).__playwright_last_mouse_pos = { x: 0, y: 0 }
      window.addEventListener(
        "mousemove",
        (e) => {
          // eslint-disable-next-line no-underscore-dangle
          ;(window as any).__playwright_last_mouse_pos = { x: e.clientX, y: e.clientY }
        },
        { passive: true }
      )
    }
  })

  // Create a smooth path from current -> dest
  const points: { x: number; y: number }[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    // easeInOut cubic for more natural movement
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    const x = current.x + (dest.x - current.x) * ease + randBetween(-jitter, jitter)
    const y = current.y + (dest.y - current.y) * ease + randBetween(-jitter, jitter)
    points.push({ x, y })
  }

  for (const p of points) {
    await page.mouse.move(Math.round(p.x), Math.round(p.y))
    const delay = Math.max(1, Math.round(randBetween(minDelay, maxDelay)))
    await sleep(delay)
  }

  // Ensure final position is exact
  await page.mouse.move(Math.round(dest.x), Math.round(dest.y))
  // small final pause
  await sleep(Math.round(randBetween(minDelay, maxDelay)))

  // update last mouse pos on page
  await page.evaluate(
    (pos) => {
      // eslint-disable-next-line no-underscore-dangle
      ;(window as any).__playwright_last_mouse_pos = pos
    },
    { x: Math.round(dest.x), y: Math.round(dest.y) }
  )
}
