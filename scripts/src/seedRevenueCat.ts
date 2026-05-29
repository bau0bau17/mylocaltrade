import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
  type Duration,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "MyLocalTrade";

const APP_STORE_APP_NAME = "MyLocalTrade iOS";
const APP_STORE_BUNDLE_ID = "com.mylocaltrade.app";
const PLAY_STORE_APP_NAME = "MyLocalTrade Android";
const PLAY_STORE_PACKAGE_NAME = "com.mylocaltrade.app";

// Single entitlement model: one "Trader Subscription" granted by either the
// Monthly or the Annual product. NO basic/premium/elite tiers — the iOS app has
// a single subscription. The tiered model only exists on the web (Stripe) side.
const ENTITLEMENT_IDENTIFIER = "trader_subscription";
const ENTITLEMENT_DISPLAY_NAME = "Trader Subscription";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Default Offering";

// One product per billing period. Both attach to the single entitlement.
// Package lookup keys use RevenueCat's reserved identifiers so the client can
// read offering.monthly / offering.annual directly.
// NOTE: test-store prices below are PLACEHOLDERS for the RevenueCat test store
// only. The real customer-facing prices are set in App Store Connect.
const PRODUCTS = [
  {
    key: "monthly",
    duration: "P1M",
    storeIdentifier: "trader_subscription_monthly",
    playStoreIdentifier: "trader_subscription:monthly",
    displayName: "Trader Subscription (Monthly)",
    userFacingTitle: "Trader Subscription Monthly",
    packageIdentifier: "$rc_monthly",
    packageDisplayName: "Monthly",
    prices: [{ amount_micros: 20_000_000, currency: "GBP" }], // £20 placeholder
  },
  {
    key: "annual",
    duration: "P1Y",
    storeIdentifier: "trader_subscription_annual",
    playStoreIdentifier: "trader_subscription:annual",
    displayName: "Trader Subscription (Annual)",
    userFacingTitle: "Trader Subscription Annual",
    packageIdentifier: "$rc_annual",
    packageDisplayName: "Annual",
    prices: [{ amount_micros: 200_000_000, currency: "GBP" }], // £200 placeholder
  },
] as const;

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

// RevenueCat enforces lookup-key uniqueness case/punctuation-insensitively.
// Normalise so "Trader Subscription" and "trader_subscription" are treated as
// the same key when reconciling with entities created in the dashboard.
function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });
  if (listProjectsError) throw new Error("Failed to list projects");

  const existingProject = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error: createProjectError } = await createProject({
      client,
      body: { name: PROJECT_NAME },
    });
    if (createProjectError) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listAppsError || !apps || apps.items.length === 0) {
    throw new Error("No apps found");
  }

  let app: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");

  if (!app) {
    throw new Error("No app with test store found");
  } else {
    console.log("App with test store found:", app.id);
  }

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: APP_STORE_APP_NAME,
        type: "app_store",
        app_store: { bundle_id: APP_STORE_BUNDLE_ID },
      },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: PLAY_STORE_APP_NAME,
        type: "play_store",
        play_store: { package_name: PLAY_STORE_PACKAGE_NAME },
      },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });
  if (listProductsError) throw new Error("Failed to list products");

  const ensureProductForApp = async (
    targetApp: App,
    label: string,
    productIdentifier: string,
    displayName: string,
    userFacingTitle: string,
    duration: string,
    isTestStore: boolean,
  ): Promise<Product> => {
    const existingProduct = existingProducts.items?.find(
      (p) => p.store_identifier === productIdentifier && p.app_id === targetApp.id,
    );
    if (existingProduct) {
      console.log(label + " product already exists:", existingProduct.id);
      return existingProduct;
    }

    const body: CreateProductData["body"] = {
      store_identifier: productIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: displayName,
    };
    if (isTestStore) {
      body.subscription = { duration: duration as Duration };
      body.title = userFacingTitle;
    }

    const { data: createdProduct, error } = await createProduct({
      client,
      path: { project_id: project.id },
      body,
    });
    if (error) throw new Error("Failed to create " + label + " product");
    console.log("Created " + label + " product:", createdProduct.id);
    return createdProduct;
  };

  // Ensure the single entitlement exists. RevenueCat treats lookup keys as
  // unique case/punctuation-insensitively (e.g. "Trader Subscription" collides
  // with "trader_subscription"), so match on a normalised key and reuse any
  // entitlement the user already created in the dashboard rather than failing.
  let entitlement: Entitlement | undefined;
  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  const existingEntitlement = existingEntitlements.items?.find(
    (e) => normalizeKey(e.lookup_key) === normalizeKey(ENTITLEMENT_IDENTIFIER),
  );
  if (existingEntitlement) {
    console.log(
      "Entitlement already exists:",
      existingEntitlement.id,
      "(lookup_key:",
      existingEntitlement.lookup_key + ")",
    );
    entitlement = existingEntitlement;
  } else {
    const { data: newEntitlement, error } = await createEntitlement({
      client,
      path: { project_id: project.id },
      body: {
        lookup_key: ENTITLEMENT_IDENTIFIER,
        display_name: ENTITLEMENT_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create entitlement: " + JSON.stringify(error));
    console.log("Created entitlement:", newEntitlement.id);
    entitlement = newEntitlement;
  }

  // Ensure offering exists and is current.
  let offering: Offering | undefined;
  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listOfferingsError) throw new Error("Failed to list offerings");

  const existingOffering = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);
  if (existingOffering) {
    console.log("Offering already exists:", existingOffering.id);
    offering = existingOffering;
  } else {
    const { data: newOffering, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: {
        lookup_key: OFFERING_IDENTIFIER,
        display_name: OFFERING_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create offering");
    console.log("Created offering:", newOffering.id);
    offering = newOffering;
  }

  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("Set offering as current");
  }

  const { data: existingPackages, error: listPackagesError } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 50 },
  });
  if (listPackagesError) throw new Error("Failed to list packages");

  const allProductIds: string[] = [];

  for (const product of PRODUCTS) {
    console.log("\n--- Seeding product:", product.key, "---");

    const testStoreProduct = await ensureProductForApp(
      app,
      "Test Store " + product.key,
      product.storeIdentifier,
      product.displayName,
      product.userFacingTitle,
      product.duration,
      true,
    );
    const appStoreProduct = await ensureProductForApp(
      appStoreApp,
      "App Store " + product.key,
      product.storeIdentifier,
      product.displayName,
      product.userFacingTitle,
      product.duration,
      false,
    );
    const playStoreProduct = await ensureProductForApp(
      playStoreApp,
      "Play Store " + product.key,
      product.playStoreIdentifier,
      product.displayName,
      product.userFacingTitle,
      product.duration,
      false,
    );

    allProductIds.push(testStoreProduct.id, appStoreProduct.id, playStoreProduct.id);

    // Test store prices (placeholders — real prices live in App Store Connect).
    const { error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testStoreProduct.id },
      body: { prices: product.prices },
    });
    if (priceError) {
      if (
        priceError &&
        typeof priceError === "object" &&
        "type" in priceError &&
        priceError["type"] === "resource_already_exists"
      ) {
        console.log("Test store prices already exist for", product.key);
      } else {
        throw new Error("Failed to add test store prices for " + product.key);
      }
    } else {
      console.log("Added test store prices for", product.key);
    }

    // Attach all three store products to the single Trader Subscription entitlement.
    const { error: attachEntitlementError } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: entitlement.id },
      body: { product_ids: [testStoreProduct.id, appStoreProduct.id, playStoreProduct.id] },
    });
    if (attachEntitlementError) {
      if (attachEntitlementError.type === "unprocessable_entity_error") {
        console.log("Products already attached to entitlement for", product.key);
      } else {
        throw new Error("Failed to attach products to entitlement for " + product.key);
      }
    } else {
      console.log("Attached products to entitlement for", product.key);
    }

    // One package per billing period using the RC reserved lookup key.
    let pkg: Package | undefined = existingPackages.items?.find(
      (p) => p.lookup_key === product.packageIdentifier,
    );
    if (pkg) {
      console.log("Package already exists for", product.key, ":", pkg.id);
    } else {
      const { data: newPackage, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: {
          lookup_key: product.packageIdentifier,
          display_name: product.packageDisplayName,
        },
      });
      if (error) throw new Error("Failed to create package for " + product.key);
      console.log("Created package for", product.key, ":", newPackage.id);
      pkg = newPackage;
    }

    const { error: attachPackageError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testStoreProduct.id, eligibility_criteria: "all" },
          { product_id: appStoreProduct.id, eligibility_criteria: "all" },
          { product_id: playStoreProduct.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPackageError) {
      if (
        attachPackageError.type === "unprocessable_entity_error" &&
        attachPackageError.message?.includes("Cannot attach product")
      ) {
        console.log("Skipping package attach for", product.key, "- already has incompatible product");
      } else {
        throw new Error("Failed to attach products to package for " + product.key);
      }
    } else {
      console.log("Attached products to package for", product.key);
    }
  }

  const { data: testStoreApiKeys, error: testStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: app.id },
  });
  if (testStoreApiKeysError) throw new Error("Failed to list public API keys for Test Store app");

  const { data: appStoreApiKeys, error: appStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: appStoreApp.id },
  });
  if (appStoreApiKeysError) throw new Error("Failed to list public API keys for App Store app");

  const { data: playStoreApiKeys, error: playStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: playStoreApp.id },
  });
  if (playStoreApiKeysError) throw new Error("Failed to list public API keys for Play Store app");

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", app.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("Entitlement Identifier:", ENTITLEMENT_IDENTIFIER);
  console.log("Offering Identifier:", OFFERING_IDENTIFIER);
  console.log("Product IDs:", allProductIds.join(", "));
  console.log("Public API Keys - Test Store:", testStoreApiKeys?.items.map((i) => i.key).join(", ") ?? "N/A");
  console.log("Public API Keys - App Store:", appStoreApiKeys?.items.map((i) => i.key).join(", ") ?? "N/A");
  console.log("Public API Keys - Play Store:", playStoreApiKeys?.items.map((i) => i.key).join(", ") ?? "N/A");
  console.log("====================\n");
}

seedRevenueCat().catch(console.error);
