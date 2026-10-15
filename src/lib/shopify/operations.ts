/**
 * Admin GraphQL documents used by the push. Mutation names and input shapes were checked
 * against the Admin API schema (2026-10) before writing; see DECISIONS.md "Shopify push (M10)".
 */

export const SHOP_QUERY = /* GraphQL */ `
  query StoreForgeShop {
    shop {
      name
      myshopifyDomain
      currencyCode
    }
    location {
      id
      name
    }
    themes(first: 25, roles: [UNPUBLISHED, DEVELOPMENT]) {
      nodes {
        id
        name
        role
      }
    }
  }
`;

export const SHOP_POLICIES_QUERY = /* GraphQL */ `
  query StoreForgePolicies {
    shop {
      shopPolicies {
        id
        type
        body
      }
    }
  }
`;

const PRODUCT_FIELDS = /* GraphQL */ `
  id
  handle
  title
  status
  media(first: 250) {
    nodes {
      id
      alt
    }
  }
  variants(first: 250) {
    nodes {
      id
      sku
      selectedOptions {
        name
        value
      }
      inventoryItem {
        id
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

export const PRODUCT_LOOKUP_QUERY = /* GraphQL */ `
  query StoreForgeProduct($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      ${PRODUCT_FIELDS}
    }
  }
`;

export const PRODUCT_VARIANTS_PAGE_QUERY = /* GraphQL */ `
  query StoreForgeVariants($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: 250, after: $after) {
        nodes {
          id
          sku
          selectedOptions {
            name
            value
          }
          inventoryItem {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export const STAGED_UPLOADS_CREATE = /* GraphQL */ `
  mutation StoreForgeStagedUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_SET = /* GraphQL */ `
  mutation StoreForgeProductSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product {
        ${PRODUCT_FIELDS}
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const INVENTORY_SET_QUANTITIES = /* GraphQL */ `
  mutation StoreForgeInventory($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) {
      inventoryAdjustmentGroup {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const COLLECTION_LOOKUP_QUERY = /* GraphQL */ `
  query StoreForgeCollection($identifier: CollectionIdentifierInput!) {
    collectionByIdentifier(identifier: $identifier) {
      id
      handle
      ruleSet {
        appliedDisjunctively
      }
    }
  }
`;

export const COLLECTION_CREATE = /* GraphQL */ `
  mutation StoreForgeCollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_UPDATE = /* GraphQL */ `
  mutation StoreForgeCollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PAGE_LOOKUP_QUERY = /* GraphQL */ `
  query StoreForgePage($query: String!) {
    pages(first: 5, query: $query) {
      nodes {
        id
        handle
      }
    }
  }
`;

export const PAGE_BY_ID_QUERY = /* GraphQL */ `
  query StoreForgePageById($id: ID!) {
    page(id: $id) {
      id
      handle
    }
  }
`;

export const PAGE_CREATE = /* GraphQL */ `
  mutation StoreForgePageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const PAGE_UPDATE = /* GraphQL */ `
  mutation StoreForgePageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const SHOP_POLICY_UPDATE = /* GraphQL */ `
  mutation StoreForgePolicy($shopPolicy: ShopPolicyInput!) {
    shopPolicyUpdate(shopPolicy: $shopPolicy) {
      shopPolicy {
        id
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const MENUS_QUERY = /* GraphQL */ `
  query StoreForgeMenus {
    menus(first: 50) {
      nodes {
        id
        handle
        title
      }
    }
  }
`;

export const MENU_CREATE = /* GraphQL */ `
  mutation StoreForgeMenuCreate(
    $title: String!
    $handle: String!
    $items: [MenuItemCreateInput!]!
  ) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const MENU_UPDATE = /* GraphQL */ `
  mutation StoreForgeMenuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const THEME_QUERY = /* GraphQL */ `
  query StoreForgeTheme($id: ID!) {
    theme(id: $id) {
      id
      name
      role
      processing
      processingFailed
    }
  }
`;

export const THEME_CREATE = /* GraphQL */ `
  mutation StoreForgeThemeCreate($source: URL!, $name: String!) {
    themeCreate(source: $source, name: $name, role: UNPUBLISHED) {
      theme {
        id
        name
        role
        processing
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const THEME_FILES_UPSERT = /* GraphQL */ `
  mutation StoreForgeThemeFiles($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles {
        filename
      }
      userErrors {
        filename
        message
        code
      }
    }
  }
`;
