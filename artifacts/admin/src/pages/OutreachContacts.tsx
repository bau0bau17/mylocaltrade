import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, downloadAuthed } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  Download,
  FileUp,
  FileText,
  Plus,
  ShieldOff,
  Trash2,
  Upload,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (local — mirrors the admin-outreach-contacts contract).
// ---------------------------------------------------------------------------

interface OutreachContact {
  id: number;
  email: string;
  emailNormalized: string;
  contactName: string | null;
  companyName: string | null;
  businessType: string;
  companyNumber: string | null;
  website: string | null;
  sourceName: string;
  sourceDetail: string;
  obtainedAt: string;
  country: string;
  lawfulRoute: string;
  consentAt: string | null;
  consentEvidence: string | null;
  soiSaleEvidence: string | null;
  soiRelevanceEvidence: string | null;
  soiOptOutEvidence: string | null;
  b2bCompanyEvidence: string | null;
  b2bRelevanceEvidence: string | null;
  b2bLiaEvidence: string | null;
  notes: string | null;
  importedAt: string;
  eligibilityStatus: "eligible" | "blocked" | string;
  eligibilityCategory: string;
  eligibilityReason: string;
  unsubscribedAt: string | null;
  emailSuppressedAt: string | null;
  emailSuppressionReason: string | null;
}

interface ListResponse {
  contacts: OutreachContact[];
  total: number;
  limit: number;
  offset: number;
}

interface Stats {
  total: number;
  eligible: number;
  blocked: number;
  unsubscribed: number;
  suppressed: number;
  suppressionList: number;
  byCategory: Record<string, number>;
}

interface ImportRowResult {
  rowNumber: number;
  email: string;
  status:
    | "accepted"
    | "invalid"
    | "duplicate_in_file"
    | "duplicate_existing"
    | "duplicate_early_access"
    | "suppressed";
  reason: string;
  eligibility?: { status: string; category: string; reason: string };
}

interface ImportSummary {
  total: number;
  accepted: number;
  acceptedEligible: number;
  acceptedBlocked: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
}

interface ValidateResponse {
  summary: ImportSummary;
  results: ImportRowResult[];
}

interface CommitResponse extends ValidateResponse {
  success: true;
  inserted: number;
}

interface OutreachEvent {
  id: number;
  kind: string;
  performedBy: number | null;
  details: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Labels + badges.
// ---------------------------------------------------------------------------

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  limited_company: "Limited company",
  llp: "LLP",
  sole_trader: "Sole trader",
  partnership: "Partnership",
  individual: "Individual",
  unknown: "Unknown",
};

const ROUTE_LABELS: Record<string, string> = {
  confirmed_consent: "Confirmed consent",
  soft_opt_in: "Soft opt-in",
  corporate_b2b: "Corporate B2B",
  none: "None claimed",
};

const CATEGORY_LABELS: Record<string, string> = {
  CONFIRMED_CONSENT: "Confirmed consent",
  SOFT_OPT_IN: "Soft opt-in",
  CORPORATE_B2B: "Corporate B2B",
  SOLE_TRADER_OR_INDIVIDUAL: "Sole trader / individual",
  UNKNOWN: "Unknown",
  OPTED_OUT: "Opted out",
};

const IMPORT_STATUS_LABELS: Record<string, string> = {
  accepted: "Will import",
  invalid: "Invalid",
  duplicate_in_file: "Duplicate in file",
  duplicate_existing: "Already imported",
  duplicate_early_access: "On Early Access list",
  suppressed: "On suppression list",
};

function EligibilityBadge({ contact }: { contact: OutreachContact }) {
  const successClass =
    "bg-[hsl(var(--success-tint))] text-[hsl(var(--success))] border-transparent font-medium";
  const destructiveClass =
    "bg-[hsl(var(--destructive-tint))] text-[hsl(var(--destructive))] border-transparent font-medium";
  const mutedClass = "bg-muted text-muted-foreground border-transparent font-medium";
  if (contact.unsubscribedAt) {
    return (
      <Badge variant="outline" className={mutedClass} data-testid={`badge-eligibility-${contact.id}`}>
        Opted out
      </Badge>
    );
  }
  if (contact.emailSuppressedAt) {
    return (
      <Badge variant="outline" className={mutedClass} data-testid={`badge-eligibility-${contact.id}`}>
        Suppressed
      </Badge>
    );
  }
  const eligible = contact.eligibilityStatus === "eligible";
  return (
    <Badge
      variant="outline"
      className={eligible ? successClass : destructiveClass}
      data-testid={`badge-eligibility-${contact.id}`}
    >
      {eligible ? "Eligible" : "Blocked"}
    </Badge>
  );
}

function StatCard({ label, value, testId }: { label: string; value: number | undefined; testId: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums" data-testid={testId}>
          {value ?? "—"}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Contact form (shared by add + edit).
// ---------------------------------------------------------------------------

type FormState = Record<string, string>;

const EMPTY_FORM: FormState = {
  email: "",
  contact_name: "",
  company_name: "",
  business_type: "unknown",
  company_number: "",
  website: "",
  source_name: "",
  source_detail: "",
  date_obtained: "",
  country: "United Kingdom",
  lawful_route: "none",
  consent_date: "",
  consent_evidence: "",
  soi_sale_evidence: "",
  soi_relevance_evidence: "",
  soi_opt_out_evidence: "",
  b2b_company_evidence: "",
  b2b_relevance_evidence: "",
  b2b_lia_evidence: "",
  notes: "",
};

function contactToForm(contact: OutreachContact): FormState {
  return {
    email: contact.email,
    contact_name: contact.contactName ?? "",
    company_name: contact.companyName ?? "",
    business_type: contact.businessType,
    company_number: contact.companyNumber ?? "",
    website: contact.website ?? "",
    source_name: contact.sourceName,
    source_detail: contact.sourceDetail,
    date_obtained: contact.obtainedAt?.slice(0, 10) ?? "",
    country: contact.country,
    lawful_route: contact.lawfulRoute,
    consent_date: contact.consentAt?.slice(0, 10) ?? "",
    consent_evidence: contact.consentEvidence ?? "",
    soi_sale_evidence: contact.soiSaleEvidence ?? "",
    soi_relevance_evidence: contact.soiRelevanceEvidence ?? "",
    soi_opt_out_evidence: contact.soiOptOutEvidence ?? "",
    b2b_company_evidence: contact.b2bCompanyEvidence ?? "",
    b2b_relevance_evidence: contact.b2bRelevanceEvidence ?? "",
    b2b_lia_evidence: contact.b2bLiaEvidence ?? "",
    notes: contact.notes ?? "",
  };
}

function FormField({
  form,
  setForm,
  name,
  label,
  placeholder,
  type = "text",
  textarea = false,
  disabled = false,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  textarea?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`oc-${name}`} className="text-slate-900 text-xs">
        {label}
      </Label>
      {textarea ? (
        <Textarea
          id={`oc-${name}`}
          value={form[name] ?? ""}
          onChange={(e) => setForm({ ...form, [name]: e.target.value })}
          placeholder={placeholder}
          className="text-slate-900 min-h-[60px]"
          disabled={disabled}
          data-testid={`input-${name}`}
        />
      ) : (
        <Input
          id={`oc-${name}`}
          type={type}
          value={form[name] ?? ""}
          onChange={(e) => setForm({ ...form, [name]: e.target.value })}
          placeholder={placeholder}
          className="text-slate-900"
          disabled={disabled}
          data-testid={`input-${name}`}
        />
      )}
    </div>
  );
}

function ContactFormFields({
  form,
  setForm,
  emailLocked,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  emailLocked: boolean;
}) {
  const route = form.lawful_route;
  return (
    <div className="space-y-3 text-slate-900">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField form={form} setForm={setForm} name="email" label="Email *" disabled={emailLocked} />
        <FormField form={form} setForm={setForm} name="contact_name" label="Contact name" />
        <FormField form={form} setForm={setForm} name="company_name" label="Company name" />
        <div className="space-y-1">
          <Label className="text-slate-900 text-xs">Business type *</Label>
          <Select value={form.business_type} onValueChange={(v) => setForm({ ...form, business_type: v })}>
            <SelectTrigger className="text-slate-900" data-testid="select-business-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormField form={form} setForm={setForm} name="company_number" label="Companies House number" placeholder="e.g. 12345678" />
        <FormField form={form} setForm={setForm} name="website" label="Website" />
        <FormField form={form} setForm={setForm} name="source_name" label="Source name *" placeholder="e.g. Companies House" />
        <FormField form={form} setForm={setForm} name="source_detail" label="Source detail *" placeholder="URL / register reference" />
        <FormField form={form} setForm={setForm} name="date_obtained" label="Date obtained * (YYYY-MM-DD)" type="date" />
        <FormField form={form} setForm={setForm} name="country" label="Country *" />
      </div>
      <div className="space-y-1">
        <Label className="text-slate-900 text-xs">Lawful route *</Label>
        <Select value={form.lawful_route} onValueChange={(v) => setForm({ ...form, lawful_route: v })}>
          <SelectTrigger className="text-slate-900" data-testid="select-lawful-route"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(ROUTE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-slate-500">
          Eligibility is decided by the server from the evidence below — a route claim without
          sufficient evidence is stored but BLOCKED.
        </p>
      </div>
      {route === "confirmed_consent" && (
        <div className="rounded-md border border-slate-200 p-3 space-y-3">
          <div className="text-xs font-medium text-slate-900">Confirmed consent evidence</div>
          <FormField form={form} setForm={setForm} name="consent_date" label="Consent date * (YYYY-MM-DD)" type="date" />
          <FormField form={form} setForm={setForm} name="consent_evidence" label="Consent evidence * (what exactly they agreed to, where it is recorded)" textarea />
        </div>
      )}
      {route === "soft_opt_in" && (
        <div className="rounded-md border border-slate-200 p-3 space-y-3">
          <div className="text-xs font-medium text-slate-900">Soft opt-in evidence (all three required)</div>
          <FormField form={form} setForm={setForm} name="soi_sale_evidence" label="Sale / negotiation evidence *" textarea />
          <FormField form={form} setForm={setForm} name="soi_relevance_evidence" label="Similar products/services relevance *" textarea />
          <FormField form={form} setForm={setForm} name="soi_opt_out_evidence" label="Opt-out offered at collection *" textarea />
        </div>
      )}
      {route === "corporate_b2b" && (
        <div className="rounded-md border border-slate-200 p-3 space-y-3">
          <div className="text-xs font-medium text-slate-900">
            Corporate B2B evidence (Ltd/LLP + company number + all three required)
          </div>
          <FormField form={form} setForm={setForm} name="b2b_company_evidence" label="Corporate status verification *" textarea />
          <FormField form={form} setForm={setForm} name="b2b_relevance_evidence" label="Relevance to their role/business *" textarea />
          <FormField form={form} setForm={setForm} name="b2b_lia_evidence" label="Documented legitimate interests assessment (LIA) *" textarea />
        </div>
      )}
      <FormField form={form} setForm={setForm} name="notes" label="Notes" textarea />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page.
// ---------------------------------------------------------------------------

export default function OutreachContacts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [eligibility, setEligibility] = useState("all");
  const [businessType, setBusinessType] = useState("all");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<FormState>({ ...EMPTY_FORM });
  const [importOpen, setImportOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const listKey = ["admin", "outreach-contacts", "list", { q, eligibility, businessType, offset }];
  const { data, isLoading, error } = useQuery({
    queryKey: listKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (eligibility !== "all") params.set("eligibility", eligibility);
      if (businessType !== "all") params.set("businessType", businessType);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      return api<ListResponse>(`/api/admin/outreach-contacts?${params.toString()}`);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["admin", "outreach-contacts", "stats"],
    queryFn: () => api<Stats>("/api/admin/outreach-contacts/stats"),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "outreach-contacts"] });
  };

  const addMutation = useMutation({
    mutationFn: (form: FormState) =>
      api<{ contact: OutreachContact }>("/api/admin/outreach-contacts", {
        method: "POST",
        body: form,
      }),
    onSuccess: (res) => {
      setAddOpen(false);
      setAddForm({ ...EMPTY_FORM });
      invalidateAll();
      toast({
        title:
          res.contact.eligibilityStatus === "eligible"
            ? "Contact added — eligible"
            : "Contact added — BLOCKED",
        description: res.contact.eligibilityReason,
      });
    },
    onError: (err) => {
      toast({
        title: "Could not add contact",
        description: err instanceof ApiError ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const contacts = data?.contacts ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Outreach contacts</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Legally controlled contact import (UK GDPR / PECR). Eligibility is computed
            server-side from recorded evidence and re-checked before every send — there is no
            admin override. Fully separate from the Early Access list.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() =>
              downloadAuthed("/api/admin/outreach-contacts/template", "outreach-contacts-template.csv").catch(() =>
                toast({ title: "Download failed", variant: "destructive" }),
              )
            }
            data-testid="button-template"
          >
            <FileText className="w-4 h-4 mr-1.5" /> CSV template
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              downloadAuthed("/api/admin/outreach-contacts/export", "outreach-contacts-export.csv").catch(() =>
                toast({ title: "Download failed", variant: "destructive" }),
              )
            }
            data-testid="button-export"
          >
            <Download className="w-4 h-4 mr-1.5" /> Export
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import">
            <Upload className="w-4 h-4 mr-1.5" /> Import CSV
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-contact">
            <Plus className="w-4 h-4 mr-1.5" /> Add contact
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={stats?.total} testId="stat-total" />
        <StatCard label="Eligible" value={stats?.eligible} testId="stat-eligible" />
        <StatCard label="Blocked" value={stats?.blocked} testId="stat-blocked" />
        <StatCard label="Opted out" value={stats?.unsubscribed} testId="stat-unsubscribed" />
        <StatCard label="Suppressed" value={stats?.suppressed} testId="stat-suppressed" />
        <StatCard label="Suppression list" value={stats?.suppressionList} testId="stat-suppression-list" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          placeholder="Search email, company or contact…"
          className="max-w-xs"
          data-testid="input-search"
        />
        <Select
          value={eligibility}
          onValueChange={(v) => {
            setEligibility(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-[160px]" data-testid="select-eligibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="eligible">Eligible</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={businessType}
          onValueChange={(v) => {
            setBusinessType(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-[180px]" data-testid="select-business-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All business types</SelectItem>
            {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiError ? error.message : "Could not load contacts."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm" data-testid="empty-contacts">
              No contacts yet. Import a CSV or add one manually.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium">Company</th>
                    <th className="text-left px-4 py-2.5 font-medium">Business type</th>
                    <th className="text-left px-4 py-2.5 font-medium">Lawful route</th>
                    <th className="text-left px-4 py-2.5 font-medium">Eligibility</th>
                    <th className="text-left px-4 py-2.5 font-medium">Imported</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contacts.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setDetailId(row.id)}
                      data-testid={`row-contact-${row.id}`}
                    >
                      <td className="px-4 py-3 font-medium">{row.email}</td>
                      <td className="px-4 py-3">{row.companyName || "—"}</td>
                      <td className="px-4 py-3">{BUSINESS_TYPE_LABELS[row.businessType] ?? row.businessType}</td>
                      <td className="px-4 py-3">{ROUTE_LABELS[row.lawfulRoute] ?? row.lawfulRoute}</td>
                      <td className="px-4 py-3"><EligibilityBadge contact={row} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(row.importedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Add contact dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!addMutation.isPending) setAddOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-add-contact">
          <DialogHeader>
            <DialogTitle>Add outreach contact</DialogTitle>
            <DialogDescription className="text-slate-500">
              Record where and how the address was obtained, and the lawful route with its
              evidence. The server decides eligibility.
            </DialogDescription>
          </DialogHeader>
          <ContactFormFields form={addForm} setForm={setAddForm} emailLocked={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate(addForm)}
              disabled={addMutation.isPending || !addForm.email.trim()}
              data-testid="button-save-contact"
            >
              {addMutation.isPending ? "Saving…" : "Save contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={invalidateAll}
      />

      {detailId !== null && (
        <ContactDetailDialog
          contactId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={invalidateAll}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV import wizard.
// ---------------------------------------------------------------------------

function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ValidateResponse | null>(null);
  const [committed, setCommitted] = useState<CommitResponse | null>(null);

  const reset = () => {
    setCsvText("");
    setFileName("");
    setPreview(null);
    setCommitted(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const validateMutation = useMutation({
    mutationFn: (csv: string) =>
      api<ValidateResponse>("/api/admin/outreach-contacts/import/validate", {
        method: "POST",
        body: { csv },
      }),
    onSuccess: (res) => setPreview(res),
    onError: (err) => {
      toast({
        title: "CSV could not be validated",
        description: err instanceof ApiError ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const commitMutation = useMutation({
    mutationFn: (csv: string) =>
      api<CommitResponse>("/api/admin/outreach-contacts/import/commit", {
        method: "POST",
        body: { csv },
      }),
    onSuccess: (res) => {
      setCommitted(res);
      onImported();
    },
    onError: (err) => {
      toast({
        title: "Import failed",
        description: err instanceof ApiError ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ""));
      setPreview(null);
      setCommitted(null);
    };
    reader.readAsText(file);
  };

  const busy = validateMutation.isPending || commitMutation.isPending;
  const results = (committed ?? preview)?.results ?? [];
  const summary = (committed ?? preview)?.summary;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy && !o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-import">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription className="text-slate-500">
            Step 1: choose the file. Step 2: review the per-row validation. Step 3: import.
            Nothing is saved until you press Import. Use the CSV template for the exact columns.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-slate-900">
          {!committed && (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
                data-testid="input-import-file"
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                <FileUp className="w-4 h-4 mr-1.5" /> Choose CSV file
              </Button>
              {fileName && <span className="text-sm text-slate-600">{fileName}</span>}
              <Button
                onClick={() => validateMutation.mutate(csvText)}
                disabled={!csvText || busy}
                data-testid="button-validate-import"
              >
                {validateMutation.isPending ? "Checking…" : "Validate"}
              </Button>
            </div>
          )}

          {summary && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm space-y-1" data-testid="import-summary">
              {committed ? (
                <div className="font-semibold text-slate-900">
                  Imported {committed.inserted} contact{committed.inserted === 1 ? "" : "s"}.
                </div>
              ) : (
                <div className="font-semibold text-slate-900">
                  {summary.accepted} of {summary.total} rows will be imported.
                </div>
              )}
              <div className="text-slate-600">
                Eligible: {summary.acceptedEligible} · Saved but blocked: {summary.acceptedBlocked} · Invalid: {summary.invalid} · Duplicates: {summary.duplicates} · On suppression list: {summary.suppressed}
              </div>
              {summary.acceptedBlocked > 0 && (
                <p className="text-xs text-slate-500">
                  Blocked rows are stored for the audit trail but can never receive email
                  unless their evidence is edited to meet a lawful route.
                </p>
              )}
            </div>
          )}

          {results.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-600 uppercase sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Row</th>
                    <th className="text-left px-3 py-2 font-medium">Email</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-900">
                  {results.map((row) => (
                    <tr key={row.rowNumber} data-testid={`import-row-${row.rowNumber}`}>
                      <td className="px-3 py-2 tabular-nums">{row.rowNumber}</td>
                      <td className="px-3 py-2 break-all">{row.email || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {IMPORT_STATUS_LABELS[row.status] ?? row.status}
                        {row.status === "accepted" && row.eligibility && (
                          <span className={row.eligibility.status === "eligible" ? " text-emerald-700" : " text-red-700"}>
                            {" "}({row.eligibility.status})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          {committed ? (
            <Button onClick={() => { reset(); onClose(); }} data-testid="button-import-done">Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => commitMutation.mutate(csvText)}
                disabled={!preview || preview.summary.accepted === 0 || busy}
                data-testid="button-commit-import"
              >
                {commitMutation.isPending
                  ? "Importing…"
                  : `Import ${preview?.summary.accepted ?? 0} contacts`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Contact detail dialog (view / edit / suppress / delete).
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="text-slate-500">{label}</div>
      <div className="col-span-2 text-slate-900 break-words">{value || "—"}</div>
    </div>
  );
}

function ContactDetailDialog({
  contactId,
  onClose,
  onChanged,
}: {
  contactId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [suppressReason, setSuppressReason] = useState("objection");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "outreach-contacts", "detail", contactId],
    queryFn: () =>
      api<{ contact: OutreachContact; events: OutreachEvent[] }>(
        `/api/admin/outreach-contacts/${contactId}`,
      ),
  });

  const patchMutation = useMutation({
    mutationFn: (body: FormState) => {
      const { email: _email, ...rest } = body;
      return api<{ contact: OutreachContact }>(`/api/admin/outreach-contacts/${contactId}`, {
        method: "PATCH",
        body: rest,
      });
    },
    onSuccess: (res) => {
      setEditing(false);
      setForm(null);
      refetch();
      onChanged();
      toast({
        title:
          res.contact.eligibilityStatus === "eligible"
            ? "Saved — eligible"
            : "Saved — BLOCKED",
        description: res.contact.eligibilityReason,
      });
    },
    onError: (err) => {
      toast({
        title: "Could not save",
        description: err instanceof ApiError ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const suppressMutation = useMutation({
    mutationFn: () =>
      api<{ contact: OutreachContact | null }>(
        `/api/admin/outreach-contacts/${contactId}/suppress`,
        { method: "POST", body: { reason: suppressReason } },
      ),
    onSuccess: () => {
      setSuppressOpen(false);
      refetch();
      onChanged();
      toast({ title: "Contact suppressed", description: "Permanently blocked from outreach email." });
    },
    onError: (err) => {
      toast({
        title: "Could not suppress",
        description: err instanceof ApiError ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api<{ success: true }>(`/api/admin/outreach-contacts/${contactId}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteOpen(false);
      onChanged();
      onClose();
      toast({ title: "Contact deleted" });
    },
    onError: (err) => {
      toast({
        title: "Could not delete",
        description: err instanceof ApiError ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const contact = data?.contact;

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-contact-detail">
          <DialogHeader>
            <DialogTitle className="break-all">{contact?.email ?? "Contact"}</DialogTitle>
            {contact && (
              <DialogDescription className="text-slate-500">
                {contact.eligibilityReason}
              </DialogDescription>
            )}
          </DialogHeader>
          {isLoading || !contact ? (
            <Skeleton className="h-40" />
          ) : editing && form ? (
            <>
              <Alert className="border-slate-200 bg-slate-50 text-slate-700">
                <AlertDescription>
                  Email is immutable (it anchors dedupe and suppression). To change the address,
                  delete this contact and import the new one with its own evidence.
                </AlertDescription>
              </Alert>
              <ContactFormFields form={form} setForm={setForm} emailLocked />
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditing(false); setForm(null); }} disabled={patchMutation.isPending}>
                  Cancel
                </Button>
                <Button onClick={() => patchMutation.mutate(form)} disabled={patchMutation.isPending} data-testid="button-save-edit">
                  {patchMutation.isPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-4 text-slate-900">
              <div className="flex items-center gap-2 flex-wrap">
                <EligibilityBadge contact={contact} />
                <Badge variant="outline" className="bg-slate-100 text-slate-700 border-transparent">
                  {CATEGORY_LABELS[contact.eligibilityCategory] ?? contact.eligibilityCategory}
                </Badge>
              </div>
              <div className="rounded-md border border-slate-200 p-3 space-y-1.5">
                <DetailRow label="Contact" value={contact.contactName} />
                <DetailRow label="Company" value={contact.companyName} />
                <DetailRow label="Business type" value={BUSINESS_TYPE_LABELS[contact.businessType] ?? contact.businessType} />
                <DetailRow label="Company number" value={contact.companyNumber} />
                <DetailRow label="Website" value={contact.website} />
                <DetailRow label="Source" value={`${contact.sourceName} — ${contact.sourceDetail}`} />
                <DetailRow label="Obtained" value={formatDate(contact.obtainedAt)} />
                <DetailRow label="Country" value={contact.country} />
                <DetailRow label="Lawful route" value={ROUTE_LABELS[contact.lawfulRoute] ?? contact.lawfulRoute} />
                {contact.consentAt && <DetailRow label="Consent date" value={formatDate(contact.consentAt)} />}
                {contact.consentEvidence && <DetailRow label="Consent evidence" value={contact.consentEvidence} />}
                {contact.soiSaleEvidence && <DetailRow label="SOI: sale" value={contact.soiSaleEvidence} />}
                {contact.soiRelevanceEvidence && <DetailRow label="SOI: relevance" value={contact.soiRelevanceEvidence} />}
                {contact.soiOptOutEvidence && <DetailRow label="SOI: opt-out offered" value={contact.soiOptOutEvidence} />}
                {contact.b2bCompanyEvidence && <DetailRow label="B2B: corporate status" value={contact.b2bCompanyEvidence} />}
                {contact.b2bRelevanceEvidence && <DetailRow label="B2B: relevance" value={contact.b2bRelevanceEvidence} />}
                {contact.b2bLiaEvidence && <DetailRow label="B2B: LIA" value={contact.b2bLiaEvidence} />}
                <DetailRow label="Notes" value={contact.notes} />
                {contact.unsubscribedAt && (
                  <DetailRow label="Opted out" value={formatDateTime(contact.unsubscribedAt)} />
                )}
                {contact.emailSuppressedAt && (
                  <DetailRow
                    label="Suppressed"
                    value={`${formatDateTime(contact.emailSuppressedAt)} (${contact.emailSuppressionReason ?? "—"})`}
                  />
                )}
              </div>
              {data.events.length > 0 && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">History</div>
                  <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
                    {data.events.map((event) => (
                      <div key={event.id} className="px-3 py-1.5 text-xs flex items-center justify-between gap-2">
                        <span className="text-slate-900">{event.kind}</span>
                        <span className="text-slate-500 whitespace-nowrap">{formatDateTime(event.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <DialogFooter className="flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setForm(contactToForm(contact)); setEditing(true); }}
                  data-testid="button-edit-contact"
                >
                  Edit
                </Button>
                {!contact.unsubscribedAt && !contact.emailSuppressedAt && (
                  <Button variant="outline" onClick={() => setSuppressOpen(true)} data-testid="button-suppress-contact">
                    <ShieldOff className="w-4 h-4 mr-1.5" /> Suppress
                  </Button>
                )}
                <Button variant="destructive" onClick={() => setDeleteOpen(true)} data-testid="button-delete-contact">
                  <Trash2 className="w-4 h-4 mr-1.5" /> Delete
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Suppress confirmation */}
      <AlertDialog open={suppressOpen} onOpenChange={(o) => { if (!suppressMutation.isPending) setSuppressOpen(o); }}>
        <AlertDialogContent data-testid="dialog-suppress">
          <AlertDialogHeader>
            <AlertDialogTitle>Suppress this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              Records an objection/complaint and adds the address to the permanent suppression
              list. It can never be re-imported or emailed again. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-slate-900 text-xs">Reason</Label>
            <Select value={suppressReason} onValueChange={setSuppressReason}>
              <SelectTrigger className="text-slate-900" data-testid="select-suppress-reason"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="objection">Objection received</SelectItem>
                <SelectItem value="complaint">Complaint</SelectItem>
                <SelectItem value="admin">Admin decision</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={suppressMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); suppressMutation.mutate(); }}
              disabled={suppressMutation.isPending}
              data-testid="button-confirm-suppress"
            >
              {suppressMutation.isPending ? "Suppressing…" : "Suppress permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!deleteMutation.isPending) setDeleteOpen(o); }}>
        <AlertDialogContent data-testid="dialog-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the contact's personal data. If they opted out or were suppressed, a
              minimal suppression record (email + reason only) is retained so they can never be
              re-imported. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete contact"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
