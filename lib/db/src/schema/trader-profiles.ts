import { pgTable, serial, integer, text, boolean, timestamp, varchar, json, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const traderProfilesTable = pgTable("trader_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  mainCategory: varchar("main_category", { length: 100 }).notNull(),
  additionalServices: json("additional_services").$type<string[]>().default([]),
  businessAddress: text("business_address"),
  town: varchar("town", { length: 100 }).notNull(),
  postcode: varchar("postcode", { length: 20 }).notNull(),
  serviceAreas: json("service_areas").$type<string[]>().default([]),
  businessDescription: text("business_description"),
  website: varchar("website", { length: 255 }),
  openingHours: text("opening_hours"),
  logoUrl: text("logo_url"),
  galleryUrls: json("gallery_urls").$type<string[]>().default([]),
  socialLinks: json("social_links").$type<{ facebook?: string; twitter?: string; instagram?: string; linkedin?: string }>(),
  plan: varchar("plan", { length: 20 }),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),
  rating: real("rating"),
  reviewCount: integer("review_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTraderProfileSchema = createInsertSchema(traderProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTraderProfile = z.infer<typeof insertTraderProfileSchema>;
export type TraderProfile = typeof traderProfilesTable.$inferSelect;
