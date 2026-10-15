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
