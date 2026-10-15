# StoreForge build plan

## Architecture

```
Browser (Next.js App Router, React 19 client components)
  │  TanStack Query for project state · EventSource for live job progress
  ▼
Next.js route handlers (/api/*)  ── Zod-validated input, per-IP token-bucket rate limits
  │
  ├── Job runner (in-process, persisted Job table, resumable, SSE fan-out via EventEmitter)
  │     ├── scrape/      static fetch (undici + cheerio) → Playwright fallback, SSRF guard, adapters
  │     ├── images/      sharp pipeline: dedupe (dHash), quality score, resize/pad/WebP+JPEG, EXIF strip
  │     ├── ai/          callStructured(): tool-use JSON schema from Zod, validate, retry, log usage
  │     ├── brand/       contrast math, Shopify font library mapping, SVG/PNG wordmark (opentype paths)
  │     ├── listing/     pricing math, 5-gram Jaccard similarity, variant matrix, SEO length rules
  │     ├── export/      CSV (header constant + validator), Dawn theme JSON, ZIP (archiver)
  │     └── shopify/     Admin GraphQL client (throttle-aware), dry-run planner, idempotent push
  ▼
SQLite via Prisma 7 (better-sqlite3 adapter)  +  ./data/projects/<id>/ files
```

## Folder structure

```
prisma/                 schema + migrations
scripts/                prepare-db, fixture generation
src/app/                pages (home, wizard, admin/runs) and /api route handlers
src/components/ui/      shadcn/ui components (new-york style, Radix primitives)
src/components/wizard/  wizard shell, stepper, the 7 step screens
src/components/preview/ storefront preview (homepage + product page mock)
src/lib/schemas/        Zod schemas: the source of truth for all data
src/lib/{db,jobs,scrape,images,ai,brand,listing,content,export,shopify,security,html,guardrails}
tests/unit/             Vitest unit + integration tests
tests/e2e/              Playwright happy path
tests/fixtures/         fixture product page HTML + generated sample images
```

## Data model

Zod schemas in `src/lib/schemas` define `Project`, `SourceExtraction`, `ImageAsset`,
`ProductAnalysis`, `BrandKit`, `ProductListing`, `StoreContent`, `ExportRecord`. Prisma stores
nested documents as JSON text columns on `Project` (parsed through the Zod schemas on read), with
first-class tables for `Asset`, `Job`, `AiCall`, `ExportRecord` and `ScrapeCache`.

## Milestones

1. Scaffold: Next.js 16, Tailwind 4, shadcn/ui, Prisma/SQLite, env, lint/test, schemas, layout, stepper, job runner + SSE
2. Input step: URLs, uploads (magic bytes, HEIC→JPEG), context form, rights acknowledgement
3. Scraper: SSRF guard, robots.txt, static + Playwright, parsers, adapters, image download, fixture tests
4. Image pipeline: dedupe, quality scoring, processing, gallery with reorder/delete/hero/variant mapping
5. AI layer: `callStructured`, prompts, fixture mode, analysis + risk flags UI
6. Brand kit: names, palette with contrast enforcement, fonts, SVG/PNG wordmark, editor
7. Listing: generation, pricing assistant, similarity check + auto-regenerate, variant editor
8. Store content: pages, policies, collections, menus, homepage, storefront preview
9. Export bundle: CSV + validator, theme JSON, pages, README, ZIP, public URL hosting
10. Shopify push: dry run, idempotency, throttling, per-step results
11. Pre-flight checklist, completion screen, next-steps guide, accessibility pass
12. E2E test, README with Mermaid diagram, final cleanup
