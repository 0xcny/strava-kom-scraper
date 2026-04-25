import type { ElementHandle, Page } from "playwright"

/**
 * Types text into an input/textarea like a human: random per-character delay,
 * longer pauses after punctuation, and optional typos+corrections.
 */
export async function humanType(
  page: Page,
  target: string | ElementHandle<HTMLElement>,
  text: string,
  opts: {
    minDelay?: number // min ms delay between chars
    maxDelay?: number // max ms delay between chars
    punctuationPauses?: boolean // add extra pause after ". , ? ! : ;"
    punctPauseMin?: number // min extra pause after punctuation
    punctPauseMax?: number // max extra pause after punctuation
    mistakeRate?: number // probability per char of a typo (0-1)
    correctionDelayMin?: number // delay before correcting a typo
    correctionDelayMax?: number // delay before correcting a typo
  } = {}
): Promise<void> {
  const {
    minDelay = 30,
    maxDelay = 150,
    punctuationPauses = true,
    punctPauseMin = 150,
    punctPauseMax = 600,
    mistakeRate = 0.03,
    correctionDelayMin = 60,
    correctionDelayMax = 300,
  } = opts

  const isSelector = typeof target === "string"
  const randBetween = (a: number, b: number) => a + Math.random() * (b - a)
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
  const punctuation = new Set([".", ",", "?", "!", ":", ";"])

  // Choose the element to focus
  let elementHandle: ElementHandle<HTMLElement> | null = null
  if (isSelector) {
    elementHandle = (await page.$(target as string)) as ElementHandle<HTMLElement> | null
    if (!elementHandle) throw new Error(`Selector "${target}" not found`)
    await elementHandle.focus()
  } else {
    elementHandle = target as ElementHandle<HTMLElement>
    try {
      await elementHandle.focus()
    } catch {
      /* ignore */
    }
  }

  const typoChars = "abcdefghijklmnopqrstuvwxyz0123456789"

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    // Maybe make a typo
    const makeTypo = Math.random() < mistakeRate && /[a-z0-9]/i.test(ch)
    if (makeTypo) {
      let wrong = ch
      for (let attempt = 0; attempt < 10 && wrong === ch; attempt++) {
        wrong = typoChars[Math.floor(Math.random() * typoChars.length)]
      }
      await page.keyboard.type(wrong)
      await page.waitForTimeout(randBetween(correctionDelayMin, correctionDelayMax))
      await page.keyboard.press("Backspace")
      await page.waitForTimeout(randBetween(20, 120))
    }

    // Type intended char
    await page.keyboard.type(ch)

    // Random per-character delay (bias shorter delays as more natural)
    let delay = randBetween(minDelay, maxDelay)
    delay = Math.round(delay * Math.sqrt(Math.random()))
    delay = clamp(delay, minDelay, maxDelay)

    if (punctuationPauses && punctuation.has(ch)) {
      const extra = randBetween(punctPauseMin, punctPauseMax)
      await page.waitForTimeout(delay + extra)
    } else {
      await page.waitForTimeout(delay)
    }

    // Sometimes pause longer after a space
    if (ch === " " && Math.random() < 0.06) {
      await page.waitForTimeout(randBetween(80, 350))
    }
  }
}
