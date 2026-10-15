"use client";
import {
  CheckIcon,
  ClockIcon,
  DropletIcon,
  GiftIcon,
  HeartIcon,
  LeafIcon,
  LockIcon,
  MenuIcon,
  MessageSquareDashedIcon,
  RecycleIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SparklesIcon,
  StarIcon,
  ThermometerIcon,
  TruckIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { googleFontsHref } from "@/lib/brand/fonts";
import { highlightPlaceholders } from "@/lib/listing/text";
import type { BrandKit, ProductListing, StoreContent } from "@/lib/schemas";
import { cn, formatMoney } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  leaf: LeafIcon,
  shield: ShieldCheckIcon,
  truck: TruckIcon,
  sparkle: SparklesIcon,
  heart: HeartIcon,
  clock: ClockIcon,
  thermometer: ThermometerIcon,
  droplet: DropletIcon,
  recycle: RecycleIcon,
  star: StarIcon,
  gift: GiftIcon,
  check: CheckIcon,
  return: Undo2Icon,
  lock: LockIcon,
};

export interface PreviewImage {
  url: string;
  alt: string;
}

export type PreviewPage = "home" | "product";

/**
 * In-app mock of the storefront (homepage and product page) using the brand kit. It is a visual
 * approximation of a Shopify theme, not the theme itself. Layout responds to the frame width
 * (container queries), so the mobile toggle shows the real mobile layout.
 */
export function StorefrontPreview({
  brand,
  listing,
  content,
  images,
  currency,
  logoUrl,
  page,
  onNavigate,
  device,
}: {
  brand: BrandKit;
  listing: ProductListing | null;
  content: StoreContent;
  images: PreviewImage[];
  currency: string;
  logoUrl: string | null;
  page: PreviewPage;
  onNavigate: (p: PreviewPage) => void;
  device: "desktop" | "mobile";
}) {
  const palette = brand.palette ?? {
    primary: "#1f2937",
    secondary: "#4b5563",
    accent: "#b45309",
    background: "#ffffff",
    text: "#111827",
    surface: "#f3f4f6",
  };
  const heading = brand.fonts?.heading.family ?? "Georgia";
  const body = brand.fonts?.body.family ?? "system-ui";
  const families = brand.fonts ? [heading, body] : [];
  const vars = {
    "--sf-bg": palette.background,
    "--sf-text": palette.text,
    "--sf-primary": palette.primary,
    "--sf-secondary": palette.secondary,
    "--sf-accent": palette.accent,
    "--sf-surface": palette.surface,
    "--sf-heading": `"${heading}", Georgia, serif`,
    "--sf-body": `"${body}", system-ui, sans-serif`,
  } as React.CSSProperties;
  const storeName = content.settings.storeName || brand.selectedName || "Your store";
  const price = listing?.variants[0]?.price;

  return (
    <div
      className={cn(
        "mx-auto w-full transition-[max-width]",
        device === "mobile" ? "max-w-[390px]" : "max-w-none",
      )}
    >
      {families.length ? <link rel="stylesheet" href={googleFontsHref(families)} /> : null}
      <div
        className="@container overflow-hidden rounded-lg border shadow-sm"
        style={{
          ...vars,
          background: "var(--sf-bg)",
          color: "var(--sf-text)",
          fontFamily: "var(--sf-body)",
        }}
        data-testid="storefront-preview"
      >
        {content.announcementBar ? (
          <p
            className="px-4 py-2 text-center text-xs"
            style={{ background: "var(--sf-primary)", color: "var(--sf-bg)" }}
          >
            {content.announcementBar}
          </p>
        ) : null}
        <header
          className="flex items-center justify-between gap-4 border-b px-4 py-3 @3xl:px-8"
          style={{ borderColor: "color-mix(in srgb, var(--sf-text) 12%, transparent)" }}
        >
          <MenuIcon className="size-5 @3xl:hidden" aria-hidden="true" />
          <button
            type="button"
            className="min-w-0 truncate rounded"
            onClick={() => onNavigate("home")}
            aria-label={`${storeName} home`}
          >
            {logoUrl ? (
              // The wordmark is generated server-side; plain <img> keeps the mock honest.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={storeName}
                className="h-7 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <span className="text-lg" style={{ fontFamily: "var(--sf-heading)" }}>
                {storeName}
              </span>
            )}
          </button>
          <nav aria-label="Preview main menu" className="hidden gap-5 text-sm @3xl:flex">
            {content.menus.main.map((m) => (
              <span key={m.url + m.title}>{m.title}</span>
            ))}
          </nav>
          <span className="flex items-center gap-3">
            <SearchIcon className="size-5" aria-hidden="true" />
            <ShoppingBagIcon className="size-5" aria-hidden="true" />
          </span>
        </header>

        {page === "home" ? (
          <HomePage
            content={content}
            listing={listing}
            image={images[0] ?? null}
            price={price != null ? formatMoney(price, currency) : null}
            onShop={() => onNavigate("product")}
          />
        ) : (
          <ProductPage
            listing={listing}
            images={images}
            price={price != null ? formatMoney(price, currency) : null}
          />
        )}

        <footer
          className="grid gap-4 border-t px-4 py-8 text-sm @3xl:grid-cols-[1fr_auto] @3xl:px-8"
          style={{
            background: "var(--sf-surface)",
            borderColor: "color-mix(in srgb, var(--sf-text) 12%, transparent)",
          }}
        >
          <div className="grid gap-1">
            <p className="text-base" style={{ fontFamily: "var(--sf-heading)" }}>
              {storeName}
            </p>
            {content.settings.tagline ? (
              <p className="opacity-80">{content.settings.tagline}</p>
            ) : null}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Preview footer menu">
            {content.menus.footer.map((m) => (
              <li key={m.url + m.title}>{m.title}</li>
            ))}
          </ul>
          <p className="text-xs opacity-70 @3xl:col-span-2">© {storeName}</p>
        </footer>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-2xl @3xl:text-3xl" style={{ fontFamily: "var(--sf-heading)" }}>
      {children}
    </h3>
  );
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-medium"
      style={{ background: "var(--sf-primary)", color: "var(--sf-bg)" }}
    >
      {children}
    </button>
  );
}

function ProductImage({ image, className }: { image: PreviewImage | null; className?: string }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt={image.alt}
      className={cn("aspect-square w-full rounded-md object-cover", className)}
    />
  ) : (
    <div
      className={cn(
        "grid aspect-square w-full place-items-center rounded-md text-sm opacity-70",
        className,
      )}
      style={{ background: "var(--sf-surface)" }}
    >
      Product photo
    </div>
  );
}

function HomePage({
  content,
  listing,
  image,
  price,
  onShop,
}: {
  content: StoreContent;
  listing: ProductListing | null;
  image: PreviewImage | null;
  price: string | null;
  onShop: () => void;
}) {
  return (
    <main>
      {content.homepageSections.map((s, i) => {
        const key = `${s.type}-${i}`;
        switch (s.type) {
          case "hero":
            return (
              <section
                key={key}
                className="grid gap-6 px-4 py-12 @3xl:grid-cols-2 @3xl:items-center @3xl:px-8 @3xl:py-20"
                style={{ background: "var(--sf-surface)" }}
              >
                <div className="grid gap-4">
                  <h2
                    className="text-3xl leading-tight @3xl:text-5xl"
                    style={{ fontFamily: "var(--sf-heading)" }}
                  >
                    {s.headline}
                  </h2>
                  <p className="max-w-prose text-base opacity-85">{s.subheadline}</p>
                  <div>
                    <PrimaryButton onClick={onShop}>{s.ctaLabel}</PrimaryButton>
                  </div>
                </div>
                <ProductImage image={image} />
              </section>
            );
          case "featured_product":
            return (
              <section key={key} className="grid gap-6 px-4 py-12 @3xl:grid-cols-2 @3xl:px-8">
                <ProductImage image={image} />
                <div className="grid content-center gap-3">
                  <SectionHeading>{s.heading}</SectionHeading>
                  {listing ? <p className="text-sm opacity-80">{listing.title}</p> : null}
                  {price ? <p className="text-xl">{price}</p> : null}
                  <div>
                    <PrimaryButton onClick={onShop}>View product</PrimaryButton>
                  </div>
                </div>
              </section>
            );
          case "benefits":
            return (
              <section key={key} className="grid gap-6 px-4 py-12 @3xl:px-8">
                <SectionHeading>{s.heading}</SectionHeading>
                <ul className="grid gap-6 @xl:grid-cols-2 @4xl:grid-cols-4">
                  {s.items.map((b, j) => {
                    const Icon = ICONS[b.icon] ?? CheckIcon;
                    return (
                      <li key={j} className="grid gap-2">
                        <Icon
                          className="size-6"
                          style={{ color: "var(--sf-primary)" }}
                          aria-hidden="true"
                        />
                        <p className="font-medium">{b.title}</p>
                        <p className="text-sm opacity-80">{b.text}</p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          case "social_proof":
            return (
              <section key={key} className="grid gap-4 px-4 py-12 @3xl:px-8">
                <SectionHeading>{s.heading}</SectionHeading>
                <div
                  className="flex items-start gap-3 rounded-md border-2 border-dashed p-6 text-sm"
                  style={{ borderColor: "color-mix(in srgb, var(--sf-text) 30%, transparent)" }}
                >
                  <MessageSquareDashedIcon className="size-5 shrink-0" aria-hidden="true" />
                  <p>{s.placeholderNote}</p>
                </div>
              </section>
            );
          case "faq":
            return (
              <section
                key={key}
                className="grid gap-4 px-4 py-12 @3xl:px-8"
                style={{ background: "var(--sf-surface)" }}
              >
                <SectionHeading>{s.heading}</SectionHeading>
                <div className="grid">
                  {s.items.map((f, j) => (
                    <details
                      key={j}
                      className="border-b py-3"
                      style={{ borderColor: "color-mix(in srgb, var(--sf-text) 15%, transparent)" }}
                    >
                      <summary className="cursor-pointer font-medium">{f.question}</summary>
                      <p className="mt-2 text-sm opacity-85">{f.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            );
          case "trust_badges":
            return (
              <section key={key} className="grid gap-6 px-4 py-10 text-center @3xl:px-8">
                <SectionHeading>{s.heading}</SectionHeading>
                <ul className="grid gap-4 @xl:grid-cols-3">
                  {s.badges.map((b, j) => {
                    const Icon = ICONS[b.icon] ?? CheckIcon;
                    return (
                      <li key={j} className="grid justify-items-center gap-2 text-sm">
                        <Icon
                          className="size-6"
                          style={{ color: "var(--sf-primary)" }}
                          aria-hidden="true"
                        />
                        {b.label}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          case "newsletter":
            return (
              <section
                key={key}
                className="grid justify-items-center gap-3 px-4 py-12 text-center @3xl:px-8"
              >
                <SectionHeading>{s.heading}</SectionHeading>
                <p className="max-w-prose text-sm opacity-85">{s.text}</p>
                <div className="flex w-full max-w-sm gap-2" aria-hidden="true">
                  <span
                    className="flex h-11 flex-1 items-center rounded-md border px-3 text-left text-sm opacity-70"
                    style={{ borderColor: "color-mix(in srgb, var(--sf-text) 30%, transparent)" }}
                  >
                    Email
                  </span>
                  <span
                    className="inline-flex h-11 items-center rounded-md px-4 text-sm"
                    style={{ background: "var(--sf-primary)", color: "var(--sf-bg)" }}
                  >
                    Subscribe
                  </span>
                </div>
              </section>
            );
          case "rich_text":
            return (
              <section key={key} className="grid gap-3 px-4 py-12 @3xl:px-8">
                <SectionHeading>{s.heading}</SectionHeading>
                <p className="text-sm opacity-85">{s.text}</p>
              </section>
            );
        }
      })}
    </main>
  );
}

function ProductPage({
  listing,
  images,
  price,
}: {
  listing: ProductListing | null;
  images: PreviewImage[];
  price: string | null;
}) {
  const [active, setActive] = useState(0);
  if (!listing) {
    return (
      <p className="px-4 py-16 text-center text-sm">
        Write the product listing to preview the product page.
      </p>
    );
  }
  const options = listing.options.filter(
    (o) => !(o.name === "Title" && o.values[0] === "Default Title"),
  );
  return (
    <main className="grid gap-8 px-4 py-8 @3xl:grid-cols-2 @3xl:px-8 @3xl:py-12">
      <div className="grid content-start gap-3">
        <ProductImage image={images[active] ?? images[0] ?? null} />
        {images.length > 1 ? (
          <ul className="grid grid-cols-5 gap-2" aria-label="Preview product photos">
            {images.slice(0, 10).map((img, i) => (
              <li key={img.url}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Show photo ${i + 1}`}
                  aria-pressed={i === active}
                  className={cn("block w-full rounded-md ring-offset-2", i === active && "ring-2")}
                  style={{ "--tw-ring-color": "var(--sf-primary)" } as React.CSSProperties}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt=""
                    className="aspect-square w-full rounded-md object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="grid content-start gap-5">
        <p className="text-xs tracking-widest uppercase opacity-70">{listing.vendor}</p>
        <h2 className="text-3xl leading-tight" style={{ fontFamily: "var(--sf-heading)" }}>
          {listing.title}
        </h2>
        {price ? <p className="text-xl">{price}</p> : null}
        {options.map((o) => (
          <div key={o.name} className="grid gap-2">
            <p className="text-sm">{o.name}</p>
            <div className="flex flex-wrap gap-2">
              {o.values.map((v, i) => (
                <span
                  key={v}
                  className="rounded-full border px-4 py-1.5 text-sm"
                  style={
                    i === 0
                      ? {
                          background: "var(--sf-text)",
                          color: "var(--sf-bg)",
                          borderColor: "var(--sf-text)",
                        }
                      : { borderColor: "color-mix(in srgb, var(--sf-text) 30%, transparent)" }
                  }
                >
                  {v}
                </span>
              ))}
            </div>
          </div>
        ))}
        <PrimaryButton>Add to cart</PrimaryButton>
        <div
          className="prose-store prose-storefront text-sm"
          dangerouslySetInnerHTML={{ __html: highlightPlaceholders(listing.descriptionHtml) }}
        />
      </div>
    </main>
  );
}
