import { chromium } from "playwright-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { ImapFlow } from "imapflow"
import { existsSync } from "fs"
import { humanType } from "./behaviour-functions/humanType"
import { hoverBeforeClick } from "./behaviour-functions/hoverBeforClick"
import { moveMouse } from "./behaviour-functions/moveMouse"
import { randomDelay, USER_AGENT } from "./lib"
import { getLoginProxy } from "./fetch-proxies"
import { sendDiscord, COLOR } from "./discord"

const SESSION_PATH = process.env.SESSION_PATH || "./session.json"
const STRAVA_EMAIL = process.env.STRAVA_EMAIL!
const GMAIL_USER = process.env.GMAIL_USER!
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!

chromium.use(StealthPlugin())

async function snapshotLastUid(): Promise<number> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false,
  })
  await client.connect()
  const lock = await client.getMailboxLock("INBOX")
  const existing = await client.search({ subject: "Your one-time code" })
  const lastUid = existing.length > 0 ? existing[existing.length - 1]! : 0
  lock.release()
  await client.logout()
  return lastUid
}

async function fetchStravaCode(lastKnownUid: number): Promise<string> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false,
  })

  await client.connect()
  const lock = await client.getMailboxLock("INBOX")

  try {
    for (let i = 0; i < 45; i++) {
      await client.noop() // Force IMAP to refresh
      const all = await client.search({
        subject: "Your one-time code",
      })

      // Only consider emails newer than what existed before
      const newMessages = all.filter((uid) => uid > lastKnownUid)

      if (newMessages.length > 0) {
        const msg = await client.fetchOne(newMessages[newMessages.length - 1]!, { source: true })
        const raw = msg.source.toString()
        // Match the 6-digit code from the email body (after "share it with anyone" text)
        const match = raw.match(/Don.*?share.*?anyone[\s\S]*?(\d{6})/)
        if (match) {
          await client.messageFlagsAdd(newMessages[newMessages.length - 1]!, ["\\Seen"])
          return match[1]!
        }
      }

      console.log(`Waiting for Strava code... (${i + 1}/45)`)
      await new Promise((r) => setTimeout(r, 2000))
    }

    throw new Error("Timed out waiting for Strava verification code")
  } finally {
    lock.release()
    await client.logout()
  }
}

async function login(): Promise<string> {
  // Get residential proxy for login
  let proxy: { server: string; username: string; password: string } | undefined
  try {
    proxy = getLoginProxy()
    console.log(`[AUTH] Using residential proxy`)
  } catch (err) {
    console.log("[AUTH] No proxy configured, proceeding without")
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--enable-gpu",
      "--enable-accelerated-2d-canvas",
      "--disable-infobars",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--start-maximized",
      "--lang=en-DE",
      "--disable-extensions",
      "--disable-default-apps",
    ],
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  })

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 50.1109, longitude: 8.6821 },
    locale: "en-DE",
    timezoneId: "Europe/Berlin",
    permissions: ["geolocation"],
    userAgent: USER_AGENT,
    colorScheme: "light",
  })

  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(15000)

  await page.goto("https://www.strava.com/login", { waitUntil: "domcontentloaded" })
  await randomDelay()

  // Dismiss cookie banner
  try {
    const cookieBtn = page.locator("#CybotCookiebotDialogBodyLevelButtonAccept, #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll").first()
    await cookieBtn.waitFor({ state: "visible", timeout: 5000 })
    await cookieBtn.click({ force: true })
    await randomDelay()
    console.log("[AUTH] Cookie banner dismissed")
  } catch {
    // No cookie banner, continue
  }

  // Enter email with human-like typing (mobile selectors)
  const emailInput = page.locator("#mobile-email")
  await emailInput.waitFor({ state: "visible", timeout: 10000 })
  await moveMouse(page, emailInput)
  await emailInput.click({ force: true })
  await randomDelay()
  await humanType(page, "#mobile-email", STRAVA_EMAIL, {
    minDelay: 40,
    maxDelay: 160,
    mistakeRate: 0.03,
  })

  await randomDelay()

  // Snapshot IMAP UIDs before triggering the email
  const lastKnownUid = await snapshotLastUid()

  // Submit email
  await page.locator("#mobile-login-button").waitFor({ state: "visible", timeout: 5000 })
  await hoverBeforeClick(page, "#mobile-login-button")

  // Wait for code input
  console.log("Waiting for Strava to send verification code...")
  try {
    await page.locator('input[type="number"]').first().waitFor({ state: "visible", timeout: 15000 })
  } catch {
    await page.screenshot({ path: "./dumps/debug-login.png" })
    console.log("Screenshot saved — OTP page did not load")
    throw new Error("OTP page did not load — check debug-login.png")
  }
  await randomDelay()

  // Fetch code from Gmail via IMAP
  const code = await fetchStravaCode(lastKnownUid)
  console.log(`Got verification code: ${code}`)

  // Enter code with human-like typing
  const codeInput = page.locator('input[type="number"]').first()
  await moveMouse(page, codeInput)
  await codeInput.click()
  await randomDelay()
  for (const digit of code) {
    await page.keyboard.type(digit)
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 120))
  }
  await codeInput.dispatchEvent("input")

  await randomDelay()

  // Submit code
  const nextBtn = page.getByRole("button", { name: "Next" })
  await nextBtn.waitFor({ state: "visible", timeout: 5000 })
  await hoverBeforeClick(page, nextBtn)

  await page.waitForURL("**/dashboard**", { timeout: 30000, waitUntil: "domcontentloaded" })
  console.log("Login successful")
  await sendDiscord("scraper", "**Login successful** ✓\nSession renewed via residential proxy + IMAP OTP", COLOR.green)

  // Save full storage state for session reuse
  await context.storageState({ path: SESSION_PATH })

  const cookies = await context.cookies()
  const sessionCookie = cookies.find((c) => c.name === "_strava4_session")

  if (!sessionCookie) {
    await browser.close()
    throw new Error("Login succeeded but no session cookie found")
  }

  await browser.close()
  return buildCookieString()
}

function buildCookieString(): string {
  const stored = JSON.parse(require("fs").readFileSync(SESSION_PATH, "utf-8"))
  const stravaCookies = stored.cookies?.filter((c: any) =>
    c.domain.includes("strava.com")
  ) || []
  return stravaCookies.map((c: any) => `${c.name}=${c.value}`).join("; ")
}

async function isSessionValid(cookieStr: string): Promise<boolean> {
  const res = await fetch("https://www.strava.com/dashboard", {
    headers: { Cookie: cookieStr },
    redirect: "manual",
  })
  if (res.status === 200) return true
  if (res.status === 302) {
    const location = res.headers.get("location") || ""
    return !location.includes("/login")
  }
  return false
}

export async function ensureSession(): Promise<string> {
  if (existsSync(SESSION_PATH)) {
    const cookieStr = buildCookieString()
    if (cookieStr && (await isSessionValid(cookieStr))) {
      return cookieStr
    }
    console.log("Session expired, re-authenticating...")
    await sendDiscord("scraper", "**Session expired** — re-authenticating...", COLOR.yellow)
  }

  return await login()
}
