# Decisions and defaults

Choices made where the spec left room, or where reality differed from the spec. Newest at the bottom
of each section.

## Stack and versions

- **Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript strict, Tailwind CSS 4.** Latest
  stable at build time (2026-10-15). `cacheComponents`/`partialPrefetching` from the scaffold were
  turned off: every screen here is per-project dynamic data, so opt-in caching adds risk and no value.
- **Prisma 7.10 with the `better-sqlite3` driver adapter.** Prisma 7 requires a driver adapter and
  `prisma.config.ts`. npm's `latest` tag for `prisma` pointed at an 8.0 release candidate, so the
  last stable 7.x was pinned.
- **shadcn/ui components are vendored by hand** in `src/components/ui` (new-york style, Radix
  primitives via the `radix-ui` package). The shadcn registry was unreachable from the build
  environment; the files follow the registry versions and `components.json` is present so
  `npx shadcn add …` works later.
- **Zod 4** native `z.toJSONSchema()` produces tool input schemas (no `zod-to-json-schema`).
- **Vitest 5** for unit/integration tests; each test file gets its own temp SQLite DB + data dir.
- **ESLint 9 flat config** (`eslint-config-next` + `eslint-config-prettier`), Prettier 3.

## Database and storage

- Nested documents (inputs, analysis, brand kit, listing, content…) are JSON text columns parsed
  through the Zod schemas on read. Assets, jobs, AI calls, exports and the scrape cache are tables.
- Default DB path `./data/storeforge.db`; files under `./data/projects/<projectId>/` and ZIPs under
  `./data/exports/`. `npm run dev|build|start` run `scripts/prepare-db.mjs` first, which creates
  the folders and applies migrations, so `npm install && npm run dev` works with no `.env`.
- Data retention defaults to 30 days (`DATA_RETENTION_DAYS`); cleanup runs at startup and daily.

## Jobs

- One job per project runs at a time (max 3 concurrently overall) so writes to a project's JSON
  columns stay ordered. Enqueueing a job type that is already queued/running returns the existing
  job (idempotent POSTs).
- Jobs interrupted by a restart are re-queued on startup (via `instrumentation.ts`); after 3
  attempts they fail with a "retry this step" message.

## Shopify API version

- Default `SHOPIFY_API_VERSION=2026-10` (the spec's example was `2025-07`). Shopify releases
  quarterly; on 2026-10-15 the docs list `2026-10` as the newest stable version (`2027-01` is a
  release candidate). Configurable through the env var.

## Scraping (M3)
- **SSRF guard**: http/https only, no credentials, blocks localhost/.local/.internal names and every non-unicast range (loopback, RFC1918, link-local incl. 169.254.169.254, CGNAT incl. 100.100.100.200, ULA incl. fd00:ec2::254, IPv4-mapped). Checked before each request, on every redirect hop, and again at socket connect time (guarded DNS lookup) to defeat DNS rebinding. The headless browser routes every sub-request through the same check and re-checks the redirect chain.
- **`SCRAPE_ALLOWLIST`** (comma-separated `host:port`) is the only way to fetch a private address. It exists so tests and the local verification run can scrape the fixture site on `127.0.0.1`. Leave it empty in normal use.
- **Robots.txt**: user-agent token `StoreForgeBot`; disallowed pages are not fetched (warning `robots_disallowed`). 4xx/missing robots → allowed; 5xx → treated as disallow (RFC 9309).
- **Walls**: CAPTCHA / anti-bot / login pages produce a warning and empty product data; nothing is solved or bypassed.
- **Field priority**: JSON-LD → microdata → OpenGraph → DOM. So JSON-LD `material` wins over a spec-table row.
- **Browser**: Playwright Chromium, launched from `CHROMIUM_PATH` when set (useful where the Playwright-managed browser revision is unavailable), otherwise Playwright's default. If no browser is installed the scraper degrades with a `browser_unavailable` warning.
- **Images**: only the primary URL's images are downloaded (competitor URLs are for positioning only). Max 10 scraped images, all flagged `third_party_source`.

## Images (M4)
- **Perceptual hash**: 64-bit DCT pHash computed after smoothing at 128px (blur σ=2), duplicates at Hamming ≤ 6 as the spec requires. A plain 9×8 dHash put two genuinely different angles of the same product on the same backdrop only 5 bits apart, which would have discarded real gallery shots. On the fixtures, re-encoded/resized copies (300–1000px, JPEG q40–85, WebP q50) stayed ≤ 6 bits and different shots ≥ 30 bits apart.
- **Duplicate winner**: highest pixel count; ties go to uploads over scraped images, then earlier position.
- **Quality score** (0–100): 35% resolution (short side 300→1600px), 35% sharpness (variance of the 4-neighbour Laplacian at 512px), 20% exposure (mean luma / clipped shadows; bright white backgrounds are not penalised), 10% aspect ratio; minus 35 for a watermark, 15 for text overlay, 40 for "product not visible" (vision flags). Images under 30 are set aside automatically, but never so that fewer than 3 remain.
- **Processing**: EXIF auto-rotate → flatten transparency on the canvas colour → trim uniform borders (skipped if it would remove more than 60% of a side) → fit within 2048px (never upscale) → optional square canvas with an 8% margin on white or the brand background → WebP q85 + JPEG q85 (mozjpeg). sharp writes no metadata unless asked, so EXIF/GPS/XMP are stripped (tested).
- **Ordering**: a hero you pick by hand stays first; otherwise vision roles order the gallery hero → angle → lifestyle → detail → infographic, then quality. Watermarked/text-overlay images are never the hero when a clean image exists.
- **Background removal**: remove.bg or Photoroom via `REMOVE_BG_PROVIDER`/`REMOVE_BG_API_KEY`; the toggle is disabled when unconfigured.
- Processed file names include a content digest, which doubles as the browser cache-buster. Export names (`<handle>-<position>.webp`) are assigned when the bundle is built.
