import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { traderProfilesTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

const CATEGORIES = [
  { id: "plumber", name: "Plumber", icon: "droplet" },
  { id: "electrician", name: "Electrician", icon: "zap" },
  { id: "roofer", name: "Roofer", icon: "home" },
  { id: "cleaner", name: "Cleaner", icon: "wind" },
  { id: "painter", name: "Painter", icon: "edit-3" },
  { id: "builder", name: "Builder", icon: "tool" },
  { id: "locksmith", name: "Locksmith", icon: "lock" },
  { id: "removals", name: "Removals", icon: "truck" },
  { id: "handyman", name: "Handyman", icon: "settings" },
  { id: "heating", name: "Heating & Gas", icon: "thermometer" },
  { id: "gardener", name: "Gardener", icon: "sun" },
  { id: "carpenter", name: "Carpenter", icon: "grid" },
];

router.get("/categories", async (_req, res) => {
  try {
    const counts = await db
      .select({
        category: traderProfilesTable.mainCategory,
        count: sql<number>`count(*)::int`,
      })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.isActive, true))
      .groupBy(traderProfilesTable.mainCategory);

    const countMap = new Map(counts.map(c => [c.category.toLowerCase(), c.count]));

    const categories = CATEGORIES.map(cat => ({
      ...cat,
      traderCount: countMap.get(cat.id) || countMap.get(cat.name.toLowerCase()) || 0,
    }));

    res.json({ categories });
  } catch (error) {
    res.json({
      categories: CATEGORIES.map(cat => ({ ...cat, traderCount: 0 })),
    });
  }
});

export default router;
