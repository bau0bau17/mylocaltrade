import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { traderProfilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { verifyUnsubscribeToken } from "../lib/auth";

const router: IRouter = Router();

const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0B1120; color: #E5E7EB; margin: 0; padding: 60px 20px; }
  .card { max-width: 480px; margin: 0 auto; background: #111827;
    border: 1px solid #1F2937; border-radius: 16px; padding: 40px; text-align: center; }
  h1 { color: #F9FAFB; font-size: 22px; margin: 0 0 12px; }
  p  { color: #9CA3AF; font-size: 15px; line-height: 1.6; margin: 0 0 12px; }
  .muted { color: #6B7280; font-size: 13px; margin-top: 20px; }
`;

function page(opts: { title: string; heading: string; body: string; status: number }) {
  return {
    status: opts.status,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title><style>${PAGE_STYLE}</style></head>
<body><div class="card"><h1>${opts.heading}</h1>${opts.body}</div></body></html>`,
  };
}

/**
 * One-click email unsubscribe. The signed token in `?token=` identifies the
 * trader profile and the notification kind, so this link cannot be replayed
 * against a different channel. Honours both browser GET (footer link) and
 * RFC 8058 POST (Gmail/Outlook one-click button).
 */
async function handle(req: Request, res: Response): Promise<void> {
  // Accept the token from either the query string or the form body. Mail
  // clients honouring RFC 8058 POST to the exact URL from `List-Unsubscribe`
  // (which carries `?token=...`) with body `List-Unsubscribe=One-Click` — so
  // we must check the query even on POST. Browser GET (footer link) and
  // any future server-to-server caller posting JSON `{ token }` also work.
  const tokenRaw =
    (typeof req.query.token === "string" ? req.query.token : null) ??
    (req.body && typeof req.body.token === "string" ? req.body.token : null);
  const token = tokenRaw ?? "";

  if (!token) {
    const r = page({
      status: 400,
      title: "Invalid unsubscribe link",
      heading: "Invalid link",
      body: `<p>This unsubscribe link is missing its token.</p>
        <p class="muted">You can manage notification preferences from inside the MyLocalTrade app.</p>`,
    });
    res.status(r.status).type("html").send(r.html);
    return;
  }

  let payload: { traderProfileId: number; kind: "lead_reminder" };
  try {
    payload = verifyUnsubscribeToken(token);
  } catch {
    const r = page({
      status: 400,
      title: "Invalid unsubscribe link",
      heading: "Link expired or invalid",
      body: `<p>We couldn't verify this unsubscribe link. It may have expired or already been used by a different account.</p>
        <p class="muted">You can manage notification preferences from inside the MyLocalTrade app.</p>`,
    });
    res.status(r.status).type("html").send(r.html);
    return;
  }

  // Token is single-purpose; today the only kind is `lead_reminder`. Any
  // future kinds must add their own column + branch here.
  await db
    .update(traderProfilesTable)
    .set({ leadReminderEmailEnabled: false, updatedAt: new Date() })
    .where(eq(traderProfilesTable.id, payload.traderProfileId));

  req.log.info(
    { traderProfileId: payload.traderProfileId, kind: payload.kind },
    "Unsubscribed trader from email kind",
  );

  const r = page({
    status: 200,
    title: "Unsubscribed",
    heading: "You're unsubscribed",
    body: `<p>We won't send you any more <strong>unanswered-lead</strong> emails.</p>
      <p>You'll still get push notifications about new leads (if enabled), and you can turn email reminders back on any time from your account settings in the MyLocalTrade app.</p>`,
  });
  res.status(r.status).type("html").send(r.html);
}

router.get("/email/unsubscribe", handle);
router.post("/email/unsubscribe", handle);

export default router;
