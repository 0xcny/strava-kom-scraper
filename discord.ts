const WEBHOOKS = {
  scraper: process.env.DISCORD_WEBHOOK_SCRAPER,
  alerts: process.env.DISCORD_WEBHOOK_ALERTS,
} as const

type Channel = keyof typeof WEBHOOKS

export const COLOR = {
  green: 0x57f287,
  yellow: 0xfee75c,
  red: 0xed4245,
  blue: 0x5865f2,
} as const

export async function sendDiscord(channel: Channel, message: string, color: number = COLOR.blue) {
  const url = WEBHOOKS[channel]
  if (!url) return

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          description: message.slice(0, 4096),
          color,
          timestamp: new Date().toISOString(),
        }],
      }),
    })
  } catch {
    console.error(`[DISCORD] Failed to send to #${channel}`)
  }
}
