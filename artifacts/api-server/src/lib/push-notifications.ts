import { db } from "@workspace/db";
import { pushTokensTable, usersTable } from "@workspace/db/schema";
import { eq, sql, inArray } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
  errors?: { message: string }[];
}

function looksLikeExpoToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

async function sendExpoPushBatch(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    throw new Error(`Expo push failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as ExpoPushResponse;
  return json.data ?? [];
}

/**
 * Send a push notification to every registered device for the given user.
 * Tokens that the Expo service reports as invalid/unregistered are deleted.
 * Failures are logged but never thrown — push is a best-effort signal.
 *
 * Returns `true` when at least one device was successfully accepted by Expo
 * (ticket `status === "ok"`). Returns `false` when the user opted out, has no
 * valid tokens, the Expo batch failed, or every ticket came back as an error.
 * Callers that gate retry/fallback behaviour on actual delivery should use
 * the boolean rather than relying on "no exception".
 */
export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<boolean> {
  const [user] = await db
    .select({ enabled: usersTable.pushNotificationsEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || user.enabled === false) return false;

  const rows = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.userId, userId));
  const tokens = rows.map((r) => r.token).filter(looksLikeExpoToken);
  if (tokens.length === 0) return false;

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: "default",
    channelId: "default",
  }));

  let tickets: ExpoPushTicket[] = [];
  try {
    tickets = await sendExpoPushBatch(messages);
  } catch (err) {
    console.warn("[push] Expo push batch failed:", err);
    return false;
  }

  const invalid: string[] = [];
  let okCount = 0;
  tickets.forEach((t, i) => {
    if (t.status === "ok") {
      okCount += 1;
    } else if (t.status === "error") {
      const code = t.details?.error;
      if (code === "DeviceNotRegistered" || code === "InvalidCredentials") {
        invalid.push(tokens[i]);
      } else {
        console.warn(`[push] ticket error for ${tokens[i]}:`, code, t.message);
      }
    }
  });
  if (invalid.length > 0) {
    try {
      await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, invalid));
    } catch (err) {
      console.warn("[push] failed to delete invalid tokens:", err);
    }
  }
  return okCount > 0;
}

/**
 * Upsert a push token for a user. If the token previously belonged to another
 * user (e.g. account switch on the same device), reassign it.
 */
export async function registerPushToken(
  userId: number,
  token: string,
  platform: string | null,
): Promise<void> {
  await db
    .insert(pushTokensTable)
    .values({ userId, token, platform })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: { userId, platform, updatedAt: sql`NOW()` },
    });
}

export async function unregisterPushToken(userId: number, token: string): Promise<void> {
  await db
    .delete(pushTokensTable)
    .where(sql`${pushTokensTable.token} = ${token} AND ${pushTokensTable.userId} = ${userId}`);
}
