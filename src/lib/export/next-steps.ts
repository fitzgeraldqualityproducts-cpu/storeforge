export interface NextStep {
  title: string;
  body: string;
  /** Path in the Shopify admin (admin.shopify.com/store/<store>/<path>). */
  admin?: string;
}

/** "Next steps in Shopify", tailored to how the store got there. */
export function nextSteps(path: "push" | "bundle", opts: { themePushed: boolean }): NextStep[] {
  const steps: NextStep[] = [];
  if (path === "bundle") {
    steps.push(
      {
        title: "Import the product",
        body: "Products → Import → products.csv, then add the photos as the README describes.",
        admin: "products",
      },
      {
        title: "Create pages, policies, collections and menus",
        body: "Follow README-IMPORT-STEPS.md in the bundle; every file is ready to paste.",
        admin: "pages",
      },
      {
        title: "Choose your theme",
        body: "Duplicate Dawn, paste the theme files from the bundle into the copy, preview it, then publish.",
        admin: "themes",
      },
    );
  } else {
    steps.push(
      {
        title: "Review the draft product",
        body: "Check photos, variants and prices, then set it to Active on the Online Store channel.",
        admin: "products",
      },
      {
        title: "Make pages and collections visible",
        body: "Pages were created hidden. Publish them, and add the smart collections to the Online Store sales channel.",
        admin: "pages",
      },
      {
        title: "Choose your theme",
        body: opts.themePushed
          ? "Preview the unpublished StoreForge theme in Online Store → Themes, then publish it."
          : "Duplicate Dawn and apply the theme files from the ZIP bundle, or push again with the theme option.",
        admin: "themes",
      },
    );
  }
  steps.push(
    {
      title: "Connect your domain",
      body: "Buy one or connect one you own in Settings → Domains.",
      admin: "settings/domains",
    },
    {
      title: "Set up payments",
      body: "Activate Shopify Payments or another provider in Settings → Payments.",
      admin: "settings/payments",
    },
    {
      title: "Create shipping profiles",
      body: "Set rates and zones in Settings → Shipping and delivery, using the real product weights.",
      admin: "settings/shipping",
    },
    {
      title: "Configure taxes",
      body: "Review tax collection for the places you sell to in Settings → Taxes and duties.",
      admin: "settings/taxes",
    },
    {
      title: "Get a legal review",
      body: "Fill every placeholder and have a lawyer review the policies and terms (Settings → Policies).",
      admin: "settings/legal",
    },
    {
      title: "Place a test order",
      body: "Use test mode or a real order you refund, to check checkout, emails and shipping.",
      admin: "orders",
    },
    {
      title: "Remove the store password",
      body: "When everything checks out, turn off the password in Online Store → Preferences.",
      admin: "online_store/preferences",
    },
  );
  return steps;
}
