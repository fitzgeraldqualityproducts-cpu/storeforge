/** Admin API access scopes the custom app needs (spec Section 9). Safe to import on the client. */
export const REQUIRED_SCOPES = [
  "write_products",
  "read_products",
  "write_files",
  "read_files",
  "write_content",
  "read_content",
  "write_online_store_navigation",
  "read_online_store_navigation",
  "write_themes",
  "read_themes",
  "write_inventory",
] as const;

/** Needed to write Settings → Policies; without them policies are saved as hidden pages. */
export const POLICY_SCOPES = ["read_legal_policies", "write_legal_policies"] as const;
