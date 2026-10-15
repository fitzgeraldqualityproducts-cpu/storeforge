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

## AI layer (M5)

- **Structured output**: one tool per task whose `input_schema` is generated from the Zod schema (`z.toJSONSchema`, input side). Current Claude models reject forced `tool_choice` ("any"/"tool"), so the tool is offered with `tool_choice: auto` (+ `disable_parallel_tool_use`) and the system prompt says to call it; a reply without the call counts as a failed attempt. Output is validated with Zod plus task-specific checks (guardrails, lengths); failures are sent back as an `is_error` tool_result, max 2 retries, then a user-visible error.
- **Streaming**: requests use `messages.stream(...).finalMessage()` so long generations never hit HTTP timeouts.
- **Effort**: `output_config.effort` = medium for generation, low for alt text and the scrape fallback.
- **Refusals** (`stop_reason: "refusal"`) stop immediately with a clear message; they aren't retried. No server-side refusal fallback is configured (it is a beta, and the categories it retries don't apply to store copy).
- **Fixture mode** (`AI_MODE=fixture`): each task has a deterministic generator built from the project's real inputs, so tests and offline demos exercise the full pipeline. The scrape fallback reports nothing in fixture mode rather than invent page data.
- **Logging**: every call (live or fixture) writes an `AiCall` row with tokens, latency, attempts and error; shown on `/admin/runs` in dev.
- **Guardrails** are deterministic regexes (`src/lib/guardrails`) for fake reviews/ratings, urgency, medical claims, unverifiable superlatives, credentials and supplier mentions. They run on AI output (violations trigger a retry) and on source text as rule-based risk flags. Rule flags are kept even if the AI disagrees; AI flags duplicating a rule's category+severity are dropped. Risk acknowledgements survive re-runs (stable ids) and don't mark downstream steps stale.
- **Prompt injection**: scraped text and merchant notes are wrapped in `<source>` tags and every prompt says to treat them as data.
- **Vision**: up to 8 images per call, downscaled to 1568px JPEG. Images added after the analysis get alt text from a lighter `describeImages` call during image processing.

## Brand kit (M6)

- **Two jobs**: `brand_names` (6 candidates) and `brand_details` (tagline, voice, palette, fonts, logo for one name), both started from `POST /api/projects/:id/brand` with `{action: "names" | "details", name?}`. The pipeline runs names (if none) then details for the selected name, the merchant's own name from Step 1, or the first candidate. A merchant-supplied brand name is listed first and used by default.
- **Name checks** run in code on every candidate: length (≤ 14 preferred), digits/symbols, a pronounceability heuristic (vowel ratio ≥ 20%, no 4-consonant clusters, no triple letters), watched trademarks, and similarity to the brand on the source page. Failing candidates are sent back to the model. Domain suggestions are normalized to `name.tld` and are never described as available; the UI links to ICANN's registration lookup labelled "Check availability" and says it wasn't checked.
- **Contrast** is enforced in code after generation, not trusted from the model: text vs background and surface, and the button label (background colour) on primary, all ≥ 4.5:1. Colours are adjusted by shifting HSL lightness (hue kept); the background is never changed. Accent on background is an advisory 3:1 check. Merchants can edit freely; failing required checks are shown live and will block export (M11 pre-flight).
- **Fonts**: a table of Google Fonts families whose Shopify `font_picker` handles were verified on shopify.dev (e.g. `playfair_display_n4`, and the irregular `ebgaramond_n4`). Anything not in the table is marked "requires a theme upload" with a named library fallback, rather than guessing a handle. The prompt lists only verified families.
- **Logo**: the name is set in the heading font and converted to SVG outlines with opentype.js, laid out glyph by glyph with pair kerning (opentype.js's shaping throws on some GSUB formats used by popular fonts, e.g. Karla, DM Sans, Rubik). The TTF comes from the Google Fonts CSS API (which serves TrueType to clients that don't ask for WOFF2) and is cached under `data/cache/fonts`. Colour: primary if it reaches 3:1 on the background, else the text colour. PNG: 1200px wide, transparent, via sharp. Offline or with `FONT_DOWNLOADS=off`, the SVG falls back to live `<text>` with a generic stack and the UI says so.
- **Edits** (PATCH): fonts are re-resolved server-side, hex colours normalized, and the logo redrawn when the name, heading font or palette changes. Logo SVG/paths sent by the client are ignored. The logo route serves the SVG with a restrictive CSP.
