import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";

export const savedTradersTable = pgTable("saved_traders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  traderId: integer("trader_id").notNull().references(() => traderProfilesTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("unique_saved_trader").on(table.userId, table.traderId),
]);

export type SavedTrader = typeof savedTradersTable.$inferSelect;
