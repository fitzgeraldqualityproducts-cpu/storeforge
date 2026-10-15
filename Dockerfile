# StoreForge production image: Next.js server, SQLite on a mounted disk at /app/data,
# and headless Chromium for scraping JS-rendered product pages.
# Full (non-slim) image: it ships python3, make and g++ for native modules like better-sqlite3.
FROM node:22-bookworm

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# prestart creates data/ and applies database migrations before the server starts.
CMD ["npm", "start"]
