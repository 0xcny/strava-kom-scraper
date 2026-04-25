FROM oven/bun:1 AS base

# Install Playwright dependencies + xvfb for headed mode
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libgtk-3-0 \
    libx11-xcb1 \
    fonts-noto-color-emoji \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install Playwright Chromium
RUN bunx playwright install chromium

COPY . .

# Remove test files and dumps
RUN rm -rf test-*.ts mark-read.ts dumps/ session.json .env

EXPOSE 3001

# xvfb-run fakes a display so Chromium runs headed without a monitor
CMD ["/bin/sh", "-c", "xvfb-run --auto-servernum --server-args='-screen 0 1024x768x24' /usr/local/bin/bun run index.ts"]
