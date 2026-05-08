import { Router, type IRouter } from "express";
import { searchCompanies } from "../lib/companies-house";

const router: IRouter = Router();

router.get("/companies-house/search", async (req, res) => {
  try {
    const qRaw = (req.query.q ?? "").toString().trim();
    if (qRaw.length < 3) {
      res.json({ items: [] });
      return;
    }
    if (qRaw.length > 160) {
      res.status(400).json({ error: "Query too long" });
      return;
    }

    const hits = await searchCompanies(qRaw, 6);

    const items = hits
      .filter((h) => h.company_number && h.title)
      .slice(0, 6)
      .map((h) => {
        const a = h.address ?? {};
        const town = a.locality ?? "";
        const postcode = a.postal_code ?? "";
        const addressLine = [a.address_line_1, a.address_line_2].filter(Boolean).join(", ");
        return {
          companyNumber: h.company_number as string,
          companyName: h.title as string,
          status: h.company_status ?? null,
          addressLine: addressLine || null,
          town: town || null,
          postcode: postcode || null,
          addressSnippet: h.address_snippet ?? null,
        };
      });

    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "Companies House search failed");
    res.status(502).json({ error: "Could not reach Companies House right now." });
  }
});

export default router;
