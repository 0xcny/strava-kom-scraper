// hoverBeforeClick.ts

import type { Locator, Page } from "playwright"
import { moveMouse } from "./moveMouse"
import { smoothScrollTo } from "./smoothScroll"

type Target = string | Locator

interface HumanClickOptions {
  timeout?: number
  force?: boolean
  button?: "left" | "right" | "middle"
  hoverDelayMin?: number // pause after hover before click
  hoverDelayMax?: number
  moveSteps?: number
}

export async function hoverBeforeClick(page: Page, target: Target, clickOpts: HumanClickOptions = {}): Promise<void> {
  const {
    timeout = 10000,
    force = false,
    button = "left",
    hoverDelayMin = 80,
    hoverDelayMax = 220,
    moveSteps = 18,
  } = clickOpts

  const randBetween = (a: number, b: number) => a + Math.random() * (b - a)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // Resolve locator
  let locator: Locator
  if (typeof target === "string") {
    locator = page.locator(target).first()
  } else {
    locator = target as Locator
  }

  // Smooth scroll to element
  await smoothScrollTo(page, locator)

  const box = await locator.boundingBox()

  if (box) {
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await moveMouse(page, center, { steps: moveSteps, jitter: 3 })
  }

  // Hover
  try {
    await locator.hover({ force: true, timeout })
  } catch {
    await page.mouse.move(Math.round(center.x), Math.round(center.y))
  }

  // Small pause before click
  await sleep(Math.round(randBetween(hoverDelayMin, hoverDelayMax)))

  // Click
  try {
    await locator.click({ timeout, force, button })
  } catch {
    await locator.click({ timeout, force: true, button })
  }

  await sleep(Math.round(randBetween(30, 120)))
}
