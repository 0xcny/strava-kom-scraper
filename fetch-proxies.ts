const PROXY_HOST = "geo.g-w.info"
const PROXY_PORT = 10080

export function getLoginProxy(): { server: string; username: string; password: string } {
  const user = process.env.FLOPPY_USER
  const pass = process.env.FLOPPY_PASS
  if (!user || !pass) throw new Error("Missing FLOPPY_USER or FLOPPY_PASS")

  const sessionId = Math.random().toString(36).slice(2, 10)
  const username = `user-${user}-type-residential-session-${sessionId}-country-DE-city-Berlin-rotation-15`

  return {
    server: `http://${PROXY_HOST}:${PROXY_PORT}`,
    username,
    password: pass,
  }
}
