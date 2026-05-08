import { pgTable, serial, integer, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const pushTokensTable = pgTable(
  "push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 255 }).notNull().unique(),
    platform: varchar("platform", { length: 16 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("push_tokens_user_idx").on(t.userId),
  }),
);

export type PushToken = typeof pushTokensTable.$inferSelect;
