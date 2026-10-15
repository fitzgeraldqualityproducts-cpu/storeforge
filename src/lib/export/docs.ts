import { placeholderSummary } from "@/lib/content/structure";
import type { BrandKit, ImageMode, ProductListing, StoreContent } from "@/lib/schemas";
import { formatMoney } from "@/lib/utils";
import { contrastRatio } from "@/lib/brand/contrast";
import { DAWN_VERSION } from "./theme";

/** Markdown files in the bundle, written for a merchant who has never imported before. */

export interface ReadmeInput {
  storeName: string;
  listing: ProductListing;
  content: StoreContent;
  brand: BrandKit;
  imageMode: ImageMode;
  csvFormat: "current" | "legacy";
  imageCount: number;
  publicImages: { baseUrl: string; expiresAt: string | null; isLocal: boolean } | null;
  hasLogo: boolean;
}

export function importReadme(i: ReadmeInput): string {
  const { listing, content } = i;
  const policies = content.pages.filter((p) => p.kind === "policy");
  const pages = content.pages.filter((p) => p.kind !== "policy");
  const smart = content.collections.filter((c) => c.rules);
  const fontNotes = [i.brand.fonts?.heading, i.brand.fonts?.body]
    .filter((f): f is NonNullable<typeof f> => Boolean(f && !f.inShopifyLibrary))
    .map((f) => `- ${f.family} isn't in Shopify's font library. ${f.note}`);
  const steps: string[] = [];
  let n = 0;
  const step = (title: string, body: string) =>
    steps.push(`## ${++n}. ${title}\n\n${body.trim()}\n`);

  step(
    "Before you start",
    `
- Log in to your Shopify admin.
- Unzip this bundle somewhere you can find it.
- Everything here is a **draft**: the product imports with status **Draft**, so nothing is visible to customers until you make it Active.
- Policies and terms are starting templates, **not legal advice**. Have a qualified lawyer review them before you publish.
`,
  );

  step(
    "Add the Dawn theme",
    `
The theme files in \`theme/\` are for **Dawn** (Shopify's free default theme), checked against Dawn ${DAWN_VERSION}.

1. Go to **Online Store → Themes**.
2. If Dawn isn't installed, open **Theme library → Add theme → Dawn**.
3. On the Dawn theme, open the **…** menu and choose **Duplicate**. You'll edit the copy, never your live theme.
`,
  );

  const imageStep =
    i.imageMode === "public_url" && i.publicImages
      ? `
The CSV links to your images at \`${i.publicImages.baseUrl}\`. Shopify downloads them during the import, so those links must work from the internet.
${i.publicImages.isLocal ? "\n> **Warning:** that address is on your own computer (localhost). Shopify can't reach it, so images won't import. Deploy StoreForge or expose it with a tunnel and export again, or use the \"Upload images after import\" option.\n" : ""}${i.publicImages.expiresAt ? `\nThe links stop working at **${i.publicImages.expiresAt}** (UTC). Import before then.\n` : ""}`
      : `
The CSV has no image links (Shopify can only import images from public URLs). After importing:

1. Open the product in **Products**.
2. In **Media**, click **Add** and upload the files in \`products/images/\` in the order listed in \`products/image-mapping.csv\` (position 1 first).
3. Paste each image's alt text from \`image-mapping.csv\` (click the image → **Add alt text**).
4. For variant images, open each variant listed in the "Use for variants" column and choose its image.
`;

  step(
    "Import the product",
    `
1. Go to **Products → Import**.
2. Choose \`products/products.csv\` (${i.csvFormat === "current" ? "Shopify's current column names" : "Shopify's classic column names"}).
3. Leave "Overwrite products with matching handles" unticked the first time, then **Upload and preview → Import products**.
4. You'll get an email when it's done. The product is **${listing.title}** (${listing.variants.length} variant${listing.variants.length === 1 ? "" : "s"}, from ${formatMoney(Math.min(...listing.variants.map((v) => v.price)), content.settings.currency)}).

If Shopify shows "Choose column headings", re-export with the other CSV column format in StoreForge's export step.

### Images (${i.imageCount})
${imageStep}
`,
  );

  step(
    "Create your pages",
    `
For each file below: **Online Store → Pages → Add page**, enter the title, click **Show HTML** (the \`<>\` button) in the editor, paste the file's contents and save. Use the handle shown so the menus link correctly (under **Search engine listing → Edit → URL handle**).

${pages.map((p) => `- **${p.title}**: \`pages/${p.handle}.html\` → handle \`${p.handle}\``).join("\n")}
`,
  );

  step(
    "Add your policies",
    `
Go to **Settings → Policies** and paste each file into its policy box (switch to HTML with the \`<>\` button):

${policies.map((p) => `- **${p.title}**: \`pages/${p.handle}.html\``).join("\n")}

Fill every \`[PLACEHOLDER]\` first: \`legal/placeholders-to-fill.md\` lists them all with where they appear.
`,
  );

  step(
    "Create collections",
    `
Shopify already has an automatic **All Products** page at \`/collections/all\`.${smart.length ? " Create these smart collections in **Products → Collections → Create collection**, choose **Smart** and add the conditions:" : ""}

${smart
  .map(
    (c) =>
      `- **${c.title}** (handle \`${c.handle}\`): products must match **${c.rules!.appliedDisjunctively ? "any" : "all"}** conditions: ${c.rules!.rules.map((r) => `${r.column.toLowerCase().replace(/_/g, " ")} ${r.relation.toLowerCase().replace(/_/g, " ")} "${r.condition}"`).join("; ")}`,
  )
  .join("\n")}

The full definitions are in \`collections/collections.json\`.
`,
  );

  step(
    "Set up navigation",
    `
Go to **Content → Menus** (in some admins: **Online Store → Navigation**).

- **Main menu** (handle \`main-menu\`): ${content.menus.main.map((m) => `${m.title} → \`${m.url}\``).join(", ")}
- **Footer menu** (handle \`footer\`): ${content.menus.footer.map((m) => `${m.title} → \`${m.url}\``).join(", ")}

Create the pages and collections first so you can pick them as links. \`navigation/menus.json\` has the same lists.
`,
  );

  step(
    "Apply the theme files",
    `
On your **Dawn copy**: **…** menu → **Edit code**. For each file, open it in the editor, replace everything with the file from this bundle, and save:

- \`theme/templates/index.json\` → **Templates › index.json** (homepage sections)
- \`theme/config/settings_data.json\` → **Config › settings_data.json** (colours, fonts, social links)
- \`theme/sections/header-group.json\` → **Sections › header-group.json** (announcement bar, header menu)
- \`theme/sections/footer-group.json\` → **Sections › footer-group.json** (footer menu, newsletter)

Then open **Customize**:
${i.hasLogo ? "- **Theme settings → Logo**: upload `theme/assets/logo.png` (or the SVG).\n" : ""}- **Image banner** section: choose a hero image (upload one of your product photos).
- **Featured product** section: check it shows **${listing.title}** (pick it if the product imported with a different handle).
- **Reviews**: there's deliberately no reviews section. When you have real reviews, add a reviews app and its block. Never add reviews you didn't receive.
${fontNotes.length ? `\n**Fonts**\n${fontNotes.join("\n")}\n` : ""}
Preview the copy, then **Publish** it when you're happy.
`,
  );

  step(
    "Store details",
    `
- **Settings → General**: store name **${content.settings.storeName}**, currency **${content.settings.currency}**.
- Announcement bar: "${content.announcementBar}"${/\[[A-Z]/.test(content.announcementBar) ? " (fill the placeholder in Customize → Announcement bar)" : ""}.
- Social links (Customize → Theme settings → Social media): ${
      Object.entries(content.settings.socialLinks)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ") || "none entered yet"
    }.
${content.settings.checkoutNotes.length ? `- Checkout ideas (Settings → Checkout):\n${content.settings.checkoutNotes.map((c) => `  - ${c}`).join("\n")}` : ""}
`,
  );

  step(
    "Before you launch",
    `
- [ ] Fill every placeholder (\`legal/placeholders-to-fill.md\`) and confirm every \`[CONFIRM: …]\` fact.
- [ ] Have a lawyer review your policies and terms.
- [ ] Set up payments (**Settings → Payments**), shipping rates (**Settings → Shipping and delivery**) and taxes (**Settings → Taxes and duties**).
- [ ] Connect your domain (**Settings → Domains**).
- [ ] Place a test order.
- [ ] Set the product to **Active** and make sure it's on the Online Store sales channel.
- [ ] Remove the store password (**Online Store → Preferences**).

StoreForge doesn't verify supplier reliability, product safety or regulatory compliance. Check those yourself before you sell.
`,
  );

  return `# Import steps for ${i.storeName}\n\nGenerated by StoreForge. Follow the steps in order.\n\n${steps.join("\n")}`;
}

export function brandGuide(brand: BrandKit, storeName: string): string {
  const p = brand.palette;
  const lines = [`# ${storeName} brand guide`, ""];
  if (brand.tagline) lines.push(`> ${brand.tagline}`, "");
  if (p) {
    lines.push("## Colours", "", "| Role | Hex | Text contrast |", "|---|---|---|");
    for (const [role, hex] of Object.entries(p)) {
      lines.push(
        `| ${role} | \`${hex}\` | ${contrastRatio(p.text, hex).toFixed(2)}:1 with text colour |`,
      );
    }
    lines.push(
      "",
      `Body text on background: ${contrastRatio(p.text, p.background).toFixed(2)}:1. Button label (background colour) on primary: ${contrastRatio(p.background, p.primary).toFixed(2)}:1. WCAG AA needs 4.5:1 for body text.`,
      "",
    );
  }
  if (brand.fonts) {
    lines.push("## Fonts", "");
    for (const [role, f] of Object.entries(brand.fonts)) {
      lines.push(
        `- **${role === "heading" ? "Headings" : "Body"}**: ${f.family}${f.shopifyHandle ? ` (Shopify font picker: \`${f.shopifyHandle}\`)` : ""}${f.note ? `. ${f.note}` : ""}`,
      );
    }
    lines.push("");
  }
  if (brand.voice) {
    lines.push(
      "## Voice",
      "",
      `**Adjectives:** ${brand.voice.adjectives.join(", ")}`,
      "",
      "**Do**",
      ...brand.voice.do.map((d) => `- ${d}`),
      "",
      "**Don't**",
      ...brand.voice.dont.map((d) => `- ${d}`),
      "",
    );
  }
  lines.push(
    "## Logo",
    "",
    brand.logoSvg
      ? `\`theme/assets/logo.svg\` (${brand.logoOutlined ? "text converted to outlines, so it looks the same everywhere" : "uses live text; install the heading font or convert it to outlines in a design tool"}) and \`theme/assets/logo.png\` (1200 px wide, transparent).`
      : "No logo was generated.",
    "",
  );
  return lines.join("\n");
}

export function placeholdersDoc(content: StoreContent, listing: ProductListing | null): string {
  const summary = placeholderSummary(content);
  const listingMarkers = listing
    ? [...listing.descriptionHtml.matchAll(/\[CONFIRM:\s*([^\]]+)\]/g)].map((m) => m[1]!.trim())
    : [];
  const lines = [
    "# Placeholders to fill",
    "",
    "Replace every item below before you publish. Policies are templates, not legal advice: have a lawyer review them.",
    "",
  ];
  if (!summary.length && !listingMarkers.length) {
    lines.push("Nothing left to fill. 🎉", "");
    return lines.join("\n");
  }
  const fill = summary.filter((s) => !s.token.startsWith("[CONFIRM"));
  const confirm = summary.filter((s) => s.token.startsWith("[CONFIRM"));
  if (fill.length) {
    lines.push("## Business details", "", "| Placeholder | Times | Where |", "|---|---|---|");
    for (const s of fill) lines.push(`| \`${s.token}\` | ${s.count} | ${s.where.join(", ")} |`);
    lines.push("");
  }
  if (confirm.length || listingMarkers.length) {
    lines.push("## Facts to confirm", "");
    for (const s of confirm)
      lines.push(`- ${s.token.replace(/^\[CONFIRM:\s*|\]$/g, "")} (${s.where.join(", ")})`);
    for (const m of [...new Set(listingMarkers)]) lines.push(`- ${m} (product description)`);
    lines.push("");
  }
  return lines.join("\n");
}
