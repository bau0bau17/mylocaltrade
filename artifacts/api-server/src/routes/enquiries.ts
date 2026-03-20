import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { enquiriesTable, usersTable, traderProfilesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { authMiddleware, customerOnly } from "../lib/auth";
import { CreateEnquiryBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/enquiries", authMiddleware, customerOnly, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { traderId, message, serviceRequired, preferredDate, phone } = CreateEnquiryBody.parse(req.body);

    const [trader] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, traderId))
      .limit(1);

    if (!trader) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    const [customer] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const [enquiry] = await db
      .insert(enquiriesTable)
      .values({
        traderId,
        customerId: userId,
        message,
        serviceRequired,
        preferredDate: preferredDate || null,
        phone: phone || null,
        status: "pending",
      })
      .returning();

    res.status(201).json({
      id: enquiry.id,
      traderId: enquiry.traderId,
      customerId: enquiry.customerId,
      customerName: customer?.fullName || "Unknown",
      customerEmail: customer?.email || "",
      traderBusinessName: trader.businessName,
      message: enquiry.message,
      serviceRequired: enquiry.serviceRequired,
      preferredDate: enquiry.preferredDate,
      phone: enquiry.phone,
      status: enquiry.status,
      createdAt: enquiry.createdAt.toISOString(),
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Create enquiry failed");
    res.status(500).json({ error: "Failed to create enquiry" });
  }
});

router.get("/enquiries", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;

    let enquiries;

    if (userRole === "trader") {
      const [profile] = await db
        .select()
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId))
        .limit(1);

      if (!profile) {
        res.json({ enquiries: [], total: 0 });
        return;
      }

      enquiries = await db
        .select({
          enquiry: enquiriesTable,
          customer: usersTable,
          trader: traderProfilesTable,
        })
        .from(enquiriesTable)
        .innerJoin(usersTable, eq(enquiriesTable.customerId, usersTable.id))
        .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
        .where(eq(enquiriesTable.traderId, profile.id))
        .orderBy(desc(enquiriesTable.createdAt));
    } else {
      enquiries = await db
        .select({
          enquiry: enquiriesTable,
          customer: usersTable,
          trader: traderProfilesTable,
        })
        .from(enquiriesTable)
        .innerJoin(usersTable, eq(enquiriesTable.customerId, usersTable.id))
        .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
        .where(eq(enquiriesTable.customerId, userId))
        .orderBy(desc(enquiriesTable.createdAt));
    }

    const formatted = enquiries.map(({ enquiry: e, customer: c, trader: t }) => ({
      id: e.id,
      traderId: e.traderId,
      customerId: e.customerId,
      customerName: c.fullName,
      customerEmail: c.email,
      traderBusinessName: t.businessName,
      message: e.message,
      serviceRequired: e.serviceRequired,
      preferredDate: e.preferredDate,
      phone: e.phone,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    }));

    res.json({ enquiries: formatted, total: formatted.length });
  } catch (error: any) {
    req.log.error({ err: error }, "Get enquiries failed");
    res.status(500).json({ error: "Failed to get enquiries" });
  }
});

export default router;
