# MyLocalTrade Brand Asset Provenance Record

Date of record: 13 August 2026
Prepared as a factual provenance record for Service Provider LTD (operator of MyLocalTrade).
This document records what the Git repository and the Replit workspace can and cannot prove.
It is **not** a legal opinion and makes no legal guarantees.

## 1. The logo mark

The MyLocalTrade logo is a white crossed screwdriver-and-wrench glyph on a blue (#2563EB-family)
rounded-square background. All in-repo variants carry the same mark.

### Exact files and first Git commits

| File | Dimensions | First commit | Date | Commit subject |
|---|---|---|---|---|
| `artifacts/mobile/assets/images/icon.png` | 1024×1024 | `bf4da0f` | 2026-03-20 | feat: MyLocalTrade.co.uk - full mobile app + API server |
| `artifacts/mobile/assets/images/splash-icon.png` | 1024×1024 | `bf4da0f` | 2026-03-20 | (same — initial build commit) |
| `artifacts/api-server/src/assets/logo.png` (email logo) | 256×256 | `e080a28` | 2026-05-08 | Update emails to use the application logo and improve asset handling |
| `artifacts/mobile/assets/images/logo.png` | 160×160 | `41330fb` | 2026-05-30 | Improve loading speed for the account screen logo |
| `artifacts/mobile/assets/images/logo@2x.png` / `logo@3x.png` | 320/480 px | `41330fb` | 2026-05-30 | (same) |
| `attached_assets/mylocaltrade-logo.png` | 160×160 | `41330fb` | 2026-05-30 | (byte-identical to `logo.png`) |

SHA-256 checksums of the files as of this record:

```
049c8f40cc3646ed64cb9d5b518424ff4010b27dbd38357ccc6d01bda6e9f113  artifacts/mobile/assets/images/icon.png
153c80a4a624e56a678041a18045afa3055d5c23cca07762bc374454d9788ec6  artifacts/mobile/assets/images/splash-icon.png
bd7b16e5fd401551b9912b327c354b3ea8522f7ac7f7931fcb4721d1d51f4cfd  artifacts/mobile/assets/images/logo.png
34d63ae899856c9d8741e49175959a58dea6b40ad87c0770cef96cf109c4bb12  artifacts/mobile/assets/images/logo@2x.png
cccd9b1b086d2c3ffa369c7c2c75e0425e543d339410b21fb50e20aa2aeaf44c  artifacts/mobile/assets/images/logo@3x.png
21dd16f8ec93aa35f2d21db6c4a04383deec13ff5fd9d15ca8aba815fe682c79  artifacts/api-server/src/assets/logo.png
bd7b16e5fd401551b9912b327c354b3ea8522f7ac7f7931fcb4721d1d51f4cfd  attached_assets/mylocaltrade-logo.png
```

### Findings

1. **Introduced with the original project.** The mark first entered the repository in the initial
   application build commit (`bf4da0f`, 20 March 2026) created during the first Replit Agent build
   session of this project. All later logo files are derived resizes of the same mark.
2. **No exact external or third-party asset identified.** A search of the repository, its full Git
   history, and a visual review found no third-party brand, trademark, stock photograph, watermark,
   or attribution-encumbered element in the mark. The crossed-tools motif is a common, generic
   iconographic subject; no exact match to a specific external source file or icon-library glyph
   has been identified, and none was recorded at creation time. Because no exact source and licence
   have been identified, **no assumption is made either way about third-party licence terms
   (including attribution requirements)** — there is simply no identified external source to
   licence-check.
3. **No generation prompt preserved.** No original image-generation prompt, generation log, or
   other creation record survives in the repository or workspace. Git shows *when* each file
   entered the repository, not *how* it was created. Accordingly, **Git provenance by itself does
   not prove exclusive copyright ownership**; it proves first appearance inside this project on
   20 March 2026 and continuous use since.
4. **Operated for Service Provider LTD at creation.** The project metadata file (`replit.md`) as of
   the same initial commit `bf4da0f` (20 March 2026) already recorded
   `Company: Service Provider LTD`, and the public site metadata names Service Provider LTD as
   author/legal entity. The repository therefore shows the project was operated for
   Service Provider LTD from the date the logo first appeared.
5. **Replit terms on AI output.** Replit's documentation and Terms of Service (as consulted on
   13 August 2026) state that Replit does not claim ownership of software, code, or content
   produced through the platform, including Agent-generated content — customers own the
   applications they build. **Caveat:** the workspace cannot retrieve the historical text of the
   Terms exactly as they stood on 20 March 2026; Service Provider LTD should retain an archived
   copy of the Terms version in force on that date (see §3).

## 2. The RCS banner

No banner image (any file named "banner" or at RCS banner dimensions, e.g. 1440×448) exists
anywhere in the repository or its Git history. The banner shown in the RCS approval form
(user-supplied capture, preserved at `docs/evidence/rcs-form-capture-2026-08-13.png`; original upload `attached_assets/Screenshot_2026-08-13_at_21.53.57_1786654440493.png` is gitignored)
visually composites the project logo with MyLocalTrade text on a blue gradient.

### Addendum — 13 August 2026: Google-hosted RCS asset inspected (read-only)

The user supplied the public Google-hosted asset URL used by the RCS agent:
`https://agent-logos.storage.googleapis.com/_/mrda0gwxrsia6VMDenOlov9P`

Properties of the downloaded file, unmodified:

- MIME type: `image/jpeg` (Content-Type header and file signature agree)
- Pixel dimensions: **1440×448** — RCS **banner** dimensions (despite the "agent-logos" hostname)
- File size: 40,177 bytes
- SHA-256: `188d6abf3c35273b1061340bd081e162ec7a76c40ef99df1c6e3ab1b2cf65b9f`
- Exif notes `software=Picasa`, indicating Google's asset pipeline **re-encoded** the upload; this
  hash therefore identifies Google's stored copy, not necessarily the byte-exact file originally
  uploaded to the form.

Content findings:

- This asset **is the banner, not the logo**. Its content matches the banner in the RCS form
  capture: the MyLocalTrade logo tile, the wordmark "MyLocalTrade", the tagline
  "Find Trusted Local Trades Near You", and a "UK Local Trades Platform" pill on a blue gradient.
- It is **not byte-identical** to any repository logo file (expected: it is a JPEG composite,
  the repository logos are standalone PNGs), and it is not a plain resize of any single one.
- The logo tile embedded in the banner is **visually identical in every inspected detail** to the
  repository mark first committed in `bf4da0f` (crossed screwdriver-and-wrench glyph, dot on the
  screwdriver handle, slot on the wrench handle, white on blue rounded square, same proportions).
  The banner is therefore assessed as a composite **derived from the project's own logo** plus
  brand text; no third-party imagery, watermark, or stock element was identified in it.
- **Remaining gap:** the original banner source file (and the tool used to compose it) is still
  not in this project, and Google's re-encoding prevents byte-level matching to the original
  upload. The banner's creation source remains to be stated by Service Provider LTD, and the
  original design/export file should be retained as evidence (§3 item 2).
- ~~The **standalone RCS logo asset** (the square logo file/URL submitted in the form) has **not**
  yet been provided for byte-level comparison.~~ Provided and inspected later the same day — see
  the addendum below.

### Addendum — 13 August 2026 (later): Google-hosted RCS logo asset inspected (read-only)

The user supplied the second Google-hosted asset URL used by the RCS agent:
`https://agent-logos.storage.googleapis.com/_/mrda0guzD3fkztjEqB6krl9B`

Properties of the downloaded file, unmodified:

- MIME type: `image/png` (Content-Type header and file signature agree)
- Pixel dimensions: **224×224**, RGBA — the standard RCS **logo** format
- File size: 19,631 bytes
- SHA-256: `a35a304ca87c2f9fe2b9c97595372b0d1dacc258f2efa2bf003295999b9f66ed`

Comparison with the repository logo files (§1):

- **Not byte-identical** to any repository file — expected, since no repository variant is
  224×224 and Google's asset pipeline re-encodes uploads (see the banner addendum), so the hash
  identifies Google's stored copy rather than necessarily the original upload.
- **Same mark**: white crossed screwdriver-and-wrench glyph on the same blue
  (centre pixel `rgb(37,99,235)`, matching the repository icon exactly), in a rounded-square
  treatment with transparent corners like the repository's rounded `logo.png` family.
- A pixel-level RMSE comparison against repository variants resized to 224×224 measures ~8%
  difference, and the difference image shows the deviation is **confined to the glyph edges**
  (anti-aliasing/scale of the outline) — no structural difference, no added or removed element,
  no third-party content. Assessment: the RCS logo asset is a **rendering/resize of the same
  MyLocalTrade mark documented in §1**, not an exact byte-copy of any single repository file.

**Verdicts (13 August 2026):**

- **RCS logo (224×224 PNG)** — comparison **PASSED**: same project mark as documented in §1;
  no external or third-party asset identified. Caveat: byte-level identity with the original
  upload cannot be established because Google re-encodes hosted assets.
- **RCS banner (1440×448 JPEG)** — content **verified as project-derived** (composite of the §1
  logo plus MyLocalTrade brand text; no third-party element identified). The original banner
  source/export file and the tool used to compose it remain to be stated and retained by
  Service Provider LTD (§3 item 2).

## 3. Evidence Service Provider LTD should retain

To support commercial use of the logo and its authorisation for the MyLocalTrade RCS agent:

1. **This document** and the Git repository itself (first-appearance commits `bf4da0f`, `e080a28`,
   `41330fb`), plus the SHA-256 checksums above tying the reviewed files to the record.
2. **Byte-exact copies of the files actually uploaded to the RCS approval form**, with their
   SHA-256 checksums, so they can be matched against the repository files (the logo) and assessed
   (the banner).
3. **An archived copy of the Replit Terms of Service in force on 20 March 2026** (e.g. a dated
   capture from the Internet Archive of replit.com/site/terms), showing the treatment of
   AI/Agent-generated output at creation time, together with a copy of the current Terms.
4. **Proof the Replit account/subscription was held and paid for by or on behalf of
   Service Provider LTD** around March 2026 (account e-mail, invoices/receipts).
5. **A short internal statement of adoption**: a dated resolution or file note by
   Service Provider LTD stating that the crossed-tools mark first created in the project on
   20 March 2026 is adopted and used as the MyLocalTrade brand mark, and (if applicable) an
   assignment/confirmation from the individual account holder to the company.
6. **Evidence of continuous public use** (App Store listing, mylocaltrade.co.uk pages, dated
   screenshots) — relevant to unregistered-mark goodwill in the UK.
7. Optionally, consider a **UK trade mark application** for the mark/name; registration provides
   far stronger protection than copyright in a simple glyph, whose copyright strength is inherently
   limited. (This is general information, not legal advice.)

## 4. What this record deliberately does not claim

- No legal guarantee of exclusive copyright ownership is made or implied.
- No claim is made that any icon-library licence applies or does not apply, since no exact external
  source was identified.
- The RCS banner's ownership is expressly **not** confirmed (§2).
- The logo files have not been modified, regenerated, or replaced as part of this review.
