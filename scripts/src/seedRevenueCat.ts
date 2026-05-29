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
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "MyLocalTrade";

const APP_STORE_APP_NAME = "MyLocalTrade iOS";
const APP_STORE_BUNDLE_ID = "com.mylocaltrade.app";
const PLAY_STORE_APP_NAME = "MyLocalTrade Android";
const PLAY_STORE_PACKAGE_NAME = "com.mylocaltrade.app";

const ENTITLEMENT_IDENTIFIER = "membership";
const ENTITLEMENT_DISPLAY_NAME = "MyLocalTrade Membership";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Default Offering";

const PRODUCT_DURATION = "P1M";

// One tier = one product + one package. The single "membership" entitlement is
// attached to all three so the server/client can detect an active subscription;
// the active product identifier tells us WHICH tier the trader holds.
const TIERS = [
  {
    key: "basic",
    storeIdentifier: "basic_monthly",
    playStoreIdentifier: "basic_monthly:monthly",
    displayName: "Basic Plan",
    userFacingTitle: "Basic Monthly",
    packageIdentifier: "basic",
    packageDisplayName: "Basic Monthly",
    prices: [{ amount_micros: 10_000_000, currency: "GBP" }], // £10
  },
  {
    key: "premium",
    storeIdentifier: "premium_monthly",
    playStoreIdentifier: "premium_monthly:monthly",
    displayName: "Premium Plan",
    userFacingTitle: "Premium Monthly",
    packageIdentifier: "premium",
    packageDisplayName: "Premium Monthly",
    prices: [{ amount_micros: 20_000_000, currency: "GBP" }], // £20
  },
  {
    key: "elite",
    storeIdentifier: "elite_monthly",
    playStoreIdentifier: "elite_monthly:monthly",
    displayName: "Elite Plan",
    userFacingTitle: "Elite Monthly",
    packageIdentifier: "elite",
    packageDisplayName: "Elite Monthly",
    prices: [{ amount_micros: 30_000_000, currency: "GBP" }], // £30
  },
] as const;

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

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
      body.subscription = { duration: PRODUCT_DURATION };
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

  // Ensure entitlement exists.
  let entitlement: Entitlement | undefined;
  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  const existingEntitlement = existingEntitlements.items?.find(
    (e) => e.lookup_key === ENTITLEMENT_IDENTIFIER,
  );
  if (existingEntitlement) {
    console.log("Entitlement already exists:", existingEntitlement.id);
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
    if (error) throw new Error("Failed to create entitlement");
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

  for (const tier of TIERS) {
    console.log("\n--- Seeding tier:", tier.key, "---");

    const testStoreProduct = await ensureProductForApp(
      app,
      "Test Store " + tier.key,
      tier.storeIdentifier,
      tier.displayName,
      tier.userFacingTitle,
      true,
    );
    const appStoreProduct = await ensureProductForApp(
      appStoreApp,
      "App Store " + tier.key,
      tier.storeIdentifier,
      tier.displayName,
      tier.userFacingTitle,
      false,
    );
    const playStoreProduct = await ensureProductForApp(
      playStoreApp,
      "Play Store " + tier.key,
      tier.playStoreIdentifier,
      tier.displayName,
      tier.userFacingTitle,
      false,
    );

    allProductIds.push(testStoreProduct.id, appStoreProduct.id, playStoreProduct.id);

    // Test store prices.
    const { error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testStoreProduct.id },
      body: { prices: tier.prices },
    });
    if (priceError) {
      if (
        priceError &&
        typeof priceError === "object" &&
        "type" in priceError &&
        priceError["type"] === "resource_already_exists"
      ) {
        console.log("Test store prices already exist for", tier.key);
      } else {
        throw new Error("Failed to add test store prices for " + tier.key);
      }
    } else {
      console.log("Added test store prices for", tier.key);
    }

    // Attach all three store products to the single membership entitlement.
    const { error: attachEntitlementError } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: entitlement.id },
      body: { product_ids: [testStoreProduct.id, appStoreProduct.id, playStoreProduct.id] },
    });
    if (attachEntitlementError) {
      if (attachEntitlementError.type === "unprocessable_entity_error") {
        console.log("Products already attached to entitlement for", tier.key);
      } else {
        throw new Error("Failed to attach products to entitlement for " + tier.key);
      }
    } else {
      console.log("Attached products to entitlement for", tier.key);
    }

    // One package per tier.
    let pkg: Package | undefined = existingPackages.items?.find(
      (p) => p.lookup_key === tier.packageIdentifier,
    );
    if (pkg) {
      console.log("Package already exists for", tier.key, ":", pkg.id);
    } else {
      const { data: newPackage, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: {
          lookup_key: tier.packageIdentifier,
          display_name: tier.packageDisplayName,
        },
      });
      if (error) throw new Error("Failed to create package for " + tier.key);
      console.log("Created package for", tier.key, ":", newPackage.id);
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
        console.log("Skipping package attach for", tier.key, "- already has incompatible product");
      } else {
        throw new Error("Failed to attach products to package for " + tier.key);
      }
    } else {
      console.log("Attached products to package for", tier.key);
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
