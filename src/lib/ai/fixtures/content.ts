import type { ProjectRecord } from "@/lib/db/projects";
import type { ContentOutput } from "../content";
import { toHandle } from "@/lib/listing/text";
import { fixtureProductName } from "./analysis";

/**
 * Deterministic store content for AI_MODE=fixture. Built from the project's own facts; every
 * business detail we can't know is a [BRACKETED PLACEHOLDER] for the merchant to fill.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fixtureFaq(project: ProjectRecord) {
  const a = project.analysis;
  const type = (a?.productType || "product").toLowerCase();
  const material = a?.materials[0];
  const origin = project.inputs.context.shippingOrigin;
  return [
    {
      question: `What is the ${type} made of?`,
      answer: material
        ? `It's made from ${material.toLowerCase()}. Full details are on the product page.`
        : "[CONFIRM: material]. Full details are on the product page.",
    },
    {
      question: "How big is it?",
      answer:
        "[CONFIRM: dimensions and capacity]. The product page lists every measurement we have.",
    },
    {
      question: "How do I care for it?",
      answer: "[CONFIRM: care instructions, e.g. dishwasher safe or hand wash only].",
    },
    {
      question: "Where do you ship from?",
      answer: origin ? `Orders ship from ${origin}.` : "Orders ship from [SHIPPING ORIGIN].",
    },
    {
      question: "How long does delivery take?",
      answer:
        "Orders are processed within [PROCESSING TIME] and usually arrive within [DELIVERY TIME]. You'll get a tracking link by email.",
    },
    {
      question: "How much is shipping?",
      answer: "Shipping costs are shown at checkout. [SHIPPING RATES OR FREE SHIPPING THRESHOLD].",
    },
    {
      question: "Can I return it?",
      answer:
        "Yes. You can return unused items within [RETURN WINDOW] days of delivery. See our refund policy for the steps.",
    },
    {
      question: "What if my order arrives damaged?",
      answer:
        "Contact us at [SUPPORT EMAIL] within [DAMAGE CLAIM WINDOW] days with a photo and your order number, and we'll make it right.",
    },
    {
      question: "Which payment methods do you accept?",
      answer: "All major cards and the payment options shown at checkout.",
    },
    {
      question: "How can I contact you?",
      answer: "Email [SUPPORT EMAIL] and we'll reply within [RESPONSE TIME].",
    },
  ];
}

export function fixtureContent(project: ProjectRecord): ContentOutput {
  const a = project.analysis;
  const kit = project.brandKit;
  const brand = kit?.selectedName || project.inputs.context.brandName || "[BUSINESS NAME]";
  const name = a?.productName || fixtureProductName(project);
  const type = (a?.productType || "product").toLowerCase();
  const material = a?.materials[0]?.toLowerCase();
  const uses = (a?.useCases ?? []).slice(0, 2).map((u) => u.toLowerCase());
  const diffs = (a?.differentiators ?? []).slice(0, 3);
  const tags = project.listing?.tags ?? [];
  const faq = fixtureFaq(project);

  const benefitIcons = ["leaf", "sparkle", "heart", "check"] as const;
  const benefits = [
    material
      ? {
          title: `Made from ${material}`,
          text: `A ${type} built from ${material} for everyday use.`,
        }
      : null,
    ...diffs.map((d) => {
      const [k, ...rest] = d.split(":");
      return rest.length
        ? { title: k!.trim(), text: `${rest.join(":").trim()}.` }
        : { title: d.slice(0, 40), text: `${d}.` };
    }),
    uses.length
      ? { title: "Made for your routine", text: `Ready for ${uses.join(" and ")}.` }
      : null,
  ]
    .filter((x): x is { title: string; text: string } => Boolean(x))
    .slice(0, 4);
  while (benefits.length < 3)
    benefits.push({ title: "Simple to use", text: "[CONFIRM: a key benefit of the product]." });

  const faqHtml = faq.map((f) => `<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`).join("\n");

  const p = (s: string) => `<p>${s}</p>`;
  const pages = [
    {
      handle: "about-us",
      title: "About us",
      kind: "about" as const,
      bodyHtml: [
        p(
          `${esc(brand)} started with a simple idea: a ${esc(type)} that does its job well and looks good doing it.`,
        ),
        p(
          `We chose ${material ? esc(material) : "[CONFIRM: material]"} because it suits the way people actually use a ${esc(type)}${uses.length ? `, from ${esc(uses.join(" to "))}` : ""}.`,
        ),
        `<h2>What we care about</h2>`,
        `<ul><li>Products we'd use ourselves</li><li>Clear, honest information about what you're buying</li><li>Friendly help when you need it</li></ul>`,
        p(
          `${esc(brand)} is run by [FOUNDER NAME] from [CITY]. [ADD A SENTENCE ABOUT WHY YOU STARTED THE SHOP].`,
        ),
      ].join("\n"),
    },
    {
      handle: "contact",
      title: "Contact",
      kind: "contact" as const,
      bodyHtml: [
        p("Questions about an order or a product? We're happy to help."),
        `<ul><li><strong>Email:</strong> [SUPPORT EMAIL]</li><li><strong>Phone:</strong> [PHONE (OPTIONAL)]</li><li><strong>Hours:</strong> [HOURS]</li><li><strong>Address:</strong> [BUSINESS ADDRESS]</li></ul>`,
        p("Please include your order number if your message is about an order."),
      ].join("\n"),
    },
    {
      handle: "faq",
      title: "FAQ",
      kind: "faq" as const,
      bodyHtml: faqHtml,
    },
    {
      handle: "shipping-policy",
      title: "Shipping policy",
      kind: "policy" as const,
      bodyHtml: [
        `<h2>Processing</h2>`,
        p(
          "Orders are processed within [PROCESSING TIME] business days. Orders placed on weekends or holidays are processed the next business day.",
        ),
        `<h2>Delivery</h2>`,
        p(
          "Orders ship from [SHIPPING ORIGIN]. Estimated delivery is [DELIVERY TIME] business days after dispatch for [SHIPPING REGIONS]. Delivery estimates aren't guaranteed.",
        ),
        `<h2>Costs</h2>`,
        p("Shipping costs are calculated at checkout. [FREE SHIPPING THRESHOLD, IF ANY]."),
        `<h2>International orders</h2>`,
        p(
          "[STATE WHETHER YOU SHIP INTERNATIONALLY.] Customers are responsible for any import duties or taxes charged by their country.",
        ),
        `<h2>Tracking and problems</h2>`,
        p(
          "You'll receive a tracking link by email when your order ships. If your order is lost or arrives damaged, contact [SUPPORT EMAIL] within [DAMAGE CLAIM WINDOW] days.",
        ),
      ].join("\n"),
    },
    {
      handle: "refund-policy",
      title: "Refund policy",
      kind: "policy" as const,
      bodyHtml: [
        p(
          "We want you to be happy with your order. If something isn't right, you can return it within [RETURN WINDOW] days of delivery.",
        ),
        `<h2>Eligibility</h2>`,
        p(
          "Items must be unused, in their original condition and packaging, with proof of purchase. [LIST ANY NON-RETURNABLE ITEMS].",
        ),
        `<h2>How to start a return</h2>`,
        p(
          "Email [SUPPORT EMAIL] with your order number. We'll send return instructions and the return address. Items sent back without first asking will not be accepted.",
        ),
        `<h2>Return shipping</h2>`,
        p("[STATE WHO PAYS RETURN SHIPPING]."),
        `<h2>Refunds</h2>`,
        p(
          "Once we receive and inspect your return, we'll email you. Approved refunds go back to the original payment method within [REFUND PROCESSING TIME] business days.",
        ),
        `<h2>Damaged or wrong items</h2>`,
        p(
          "Contact us within [DAMAGE CLAIM WINDOW] days of delivery with a photo, and we'll replace or refund the item.",
        ),
      ].join("\n"),
    },
    {
      handle: "privacy-policy",
      title: "Privacy policy",
      kind: "policy" as const,
      bodyHtml: [
        p(
          'This policy explains how [BUSINESS NAME] ("we") collects, uses and shares personal information when you visit or buy from [STORE URL].',
        ),
        `<h2>Information we collect</h2>`,
        `<ul><li>Details you give us: name, email, shipping and billing address, phone number and order details.</li><li>Payment information, which is processed by our payment providers.</li><li>Device and usage information collected through cookies and similar technologies.</li></ul>`,
        `<h2>How we use it</h2>`,
        `<ul><li>To process and deliver orders and handle returns.</li><li>To communicate with you about your order and, if you agree, marketing.</li><li>To prevent fraud and keep the store secure.</li><li>To comply with legal obligations.</li></ul>`,
        `<h2>Sharing</h2>`,
        p(
          "We share information with service providers who help us run the store, such as our e-commerce platform (Shopify), payment processors and shipping carriers, and where the law requires it. [LIST ANY OTHER SERVICES, E.G. EMAIL MARKETING OR ANALYTICS].",
        ),
        `<h2>Your rights</h2>`,
        p(
          "Depending on where you live, you may have the right to access, correct, delete or move your personal information, and to object to some uses. To make a request, contact [SUPPORT EMAIL].",
        ),
        `<h2>Retention</h2>`,
        p("We keep order information for [RETENTION PERIOD] or as long as the law requires."),
        `<h2>Contact</h2>`,
        p("[BUSINESS NAME], [BUSINESS ADDRESS], [SUPPORT EMAIL]."),
        p("Last updated: [DATE]."),
      ].join("\n"),
    },
    {
      handle: "terms-of-service",
      title: "Terms of service",
      kind: "policy" as const,
      bodyHtml: [
        p(
          "These terms apply to your use of [STORE URL], operated by [BUSINESS NAME]. By using the site or placing an order you agree to them.",
        ),
        `<h2>Orders and pricing</h2>`,
        p(
          "Prices are shown in [CURRENCY] and may change. We may refuse or cancel an order, for example if a product was listed at the wrong price; if we do, we'll refund any payment.",
        ),
        `<h2>Products</h2>`,
        p(
          "We try to describe and show products accurately. Colours on screen can vary slightly from the real item.",
        ),
        `<h2>Returns</h2>`,
        p('Returns are covered by our <a href="/policies/refund-policy">refund policy</a>.'),
        `<h2>Liability</h2>`,
        p(
          "To the extent the law allows, our liability for any claim related to a product is limited to the amount you paid for it. Nothing in these terms limits rights you have under consumer law.",
        ),
        `<h2>Governing law</h2>`,
        p("These terms are governed by the laws of [JURISDICTION]."),
        `<h2>Contact</h2>`,
        p("[BUSINESS NAME], [BUSINESS ADDRESS], [SUPPORT EMAIL]."),
      ].join("\n"),
    },
  ];

  const typeHandle = toHandle(a?.productType || "products");
  const collections = [
    {
      handle: typeHandle,
      title: a?.productType || "Shop",
      descriptionHtml: p(`Every ${esc(type)} in the ${esc(brand)} range.`),
      rules: {
        appliedDisjunctively: false,
        rules: [
          {
            column: "TYPE" as const,
            relation: "EQUALS" as const,
            condition: a?.productType || "Product",
          },
        ],
      },
    },
    ...(tags.length > 1
      ? [
          {
            handle: toHandle(tags[1]!),
            title: tags[1]!.replace(/\b\w/g, (c) => c.toUpperCase()),
            descriptionHtml: p(`Pieces tagged ${esc(tags[1]!)}.`),
            rules: {
              appliedDisjunctively: false,
              rules: [{ column: "TAG" as const, relation: "EQUALS" as const, condition: tags[1]! }],
            },
          },
        ]
      : []),
  ];

  return {
    announcementBar: "Free shipping on orders over [AMOUNT]",
    homepageSections: [
      {
        type: "hero" as const,
        headline: kit?.tagline || `The ${type}, done right`,
        subheadline: `${name}${material ? ` in ${material}` : ""}, from ${brand}.`,
        ctaLabel: "Shop now",
        ctaLink: "/collections/all",
      },
      { type: "featured_product" as const, heading: name },
      {
        type: "benefits" as const,
        heading: `Why ${brand}`,
        items: benefits.map((b, i) => ({ icon: benefitIcons[i % benefitIcons.length]!, ...b })),
      },
      { type: "social_proof" as const, heading: "What customers say" },
      { type: "faq" as const, heading: "Questions, answered", items: faq },
      {
        type: "trust_badges" as const,
        heading: "Shop with confidence",
        badges: [
          { icon: "truck", label: "Ships in [PROCESSING TIME] business days" },
          { icon: "return", label: "[RETURN WINDOW]-day returns" },
          { icon: "lock", label: "Secure checkout" },
        ],
      },
      {
        type: "newsletter" as const,
        heading: "Stay in the loop",
        text: `New arrivals and care tips from ${brand}, a few times a month.`,
      },
    ],
    pages,
    collections,
    checkoutNotes: [
      "Add an order note field so customers can leave gift messages.",
      "Require a phone number only if your carrier needs it.",
      "Show your refund policy link in the checkout footer.",
    ],
  };
}
