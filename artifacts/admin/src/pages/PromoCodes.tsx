import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/format";
import { Tag, ChevronDown, ChevronRight, Plus } from "lucide-react";

interface PromoCode {
  id: number;
  code: string;
  description: string | null;
  discountGbp: number;
  maxRedemptions: number;
  applicablePlans: string[];
  validForDays: number;
  isActive: boolean;
  redemptionsCount: number;
  slotsRemaining: number;
  createdAt: string;
  updatedAt: string;
}

interface Redemption {
  id: number;
  userId: number;
  email: string | null;
  fullName: string | null;
  businessName: string | null;
  planId: string;
  originalPriceGbp: number;
  discountGbp: number;
  discountedPriceGbp: number;
  redeemedAt: string;
  expiresAt: string;
}

function formatRemaining(expiresAt: string): { text: string; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { text: "expired", expired: true };
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return { text: `${days}d ${hours}h left`, expired: false };
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return { text: `${hours}h ${minutes}m left`, expired: false };
}

export default function PromoCodesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "promo-codes"],
    queryFn: () => api<{ promoCodes: PromoCode[] }>("/api/admin/promo-codes"),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Tag className="w-5 h-5" /> Promo codes
          </h1>
          <p className="text-sm text-muted-foreground">
            Limited-supply discount codes traders can apply at checkout. Active in demo mode only — Stripe Coupon integration is pending.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)} data-testid="button-new-promo">
          <Plus className="w-4 h-4 mr-1" /> New code
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {showCreate && <CreatePromoForm onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["admin", "promo-codes"] }); }} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{data ? `${data.promoCodes.length} codes` : "Loading…"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : data?.promoCodes.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No promo codes yet. Create one to get started.
            </div>
          ) : (
            <div className="divide-y">
              {data?.promoCodes.map((c) => (
                <PromoRow
                  key={c.id}
                  code={c}
                  expanded={expandedId === c.id}
                  onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PromoRow({ code, expanded, onToggle }: { code: PromoCode; expanded: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const toggleActive = useMutation({
    mutationFn: () =>
      api(`/api/admin/promo-codes/${code.id}`, {
        method: "PATCH",
        body: { isActive: !code.isActive },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "promo-codes"] }),
  });

  const { data: redemptionsData, isLoading: redemptionsLoading } = useQuery({
    queryKey: ["admin", "promo-codes", code.id, "redemptions"],
    queryFn: () => api<{ redemptions: Redemption[] }>(`/api/admin/promo-codes/${code.id}/redemptions`),
    enabled: expanded,
  });

  const fillPct = Math.min(100, Math.round((code.redemptionsCount / code.maxRedemptions) * 100));

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground"
          aria-label="toggle redemptions"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-sm font-semibold">{code.code}</code>
            <Badge variant="outline" className={code.isActive ? "bg-emerald-100 text-emerald-800 border-transparent" : "bg-muted text-muted-foreground border-transparent"}>
              {code.isActive ? "active" : "disabled"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              £{code.discountGbp} off · {code.applicablePlans.join(", ")} · valid {code.validForDays}d after redeem
            </span>
          </div>
          {code.description && <div className="text-xs text-muted-foreground mt-0.5">{code.description}</div>}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 bg-muted rounded-full flex-1 overflow-hidden max-w-xs">
              <div className="h-full bg-primary" style={{ width: `${fillPct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">
              {code.redemptionsCount} / {code.maxRedemptions} redeemed · {code.slotsRemaining} left
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={code.isActive}
            onCheckedChange={() => toggleActive.mutate()}
            disabled={toggleActive.isPending}
            aria-label="toggle active"
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pl-7">
          {redemptionsLoading ? (
            <div className="space-y-1">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : !redemptionsData || redemptionsData.redemptions.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No traders have redeemed this code yet.</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Trader</th>
                    <th className="text-left px-3 py-2 font-medium">Plan</th>
                    <th className="text-left px-3 py-2 font-medium">Price</th>
                    <th className="text-left px-3 py-2 font-medium">Redeemed</th>
                    <th className="text-left px-3 py-2 font-medium">Countdown</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {redemptionsData.redemptions.map((r) => {
                    const remain = formatRemaining(r.expiresAt);
                    return (
                      <tr key={r.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.businessName ?? r.fullName ?? r.email ?? `#${r.userId}`}</div>
                          <div className="text-muted-foreground">{r.email}</div>
                        </td>
                        <td className="px-3 py-2 uppercase font-mono">{r.planId}</td>
                        <td className="px-3 py-2">
                          <span className="line-through text-muted-foreground">£{r.originalPriceGbp}</span>{" "}
                          <span className="font-semibold">£{r.discountedPriceGbp}</span>
                        </td>
                        <td className="px-3 py-2">{formatDate(r.redeemedAt)}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={remain.expired ? "bg-muted text-muted-foreground border-transparent" : "bg-amber-100 text-amber-900 border-transparent"}>
                            {remain.text}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreatePromoForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountGbp, setDiscountGbp] = useState("5");
  const [maxRedemptions, setMaxRedemptions] = useState("20");
  const [validForDays, setValidForDays] = useState("30");
  const [plans, setPlans] = useState<Record<string, boolean>>({ basic: false, premium: true, elite: true });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ promoCode: PromoCode }>("/api/admin/promo-codes", {
        method: "POST",
        body: {
          code: code.trim(),
          description: description.trim() || undefined,
          discountGbp: Number(discountGbp),
          maxRedemptions: Number(maxRedemptions),
          validForDays: Number(validForDays),
          applicablePlans: Object.entries(plans).filter(([, v]) => v).map(([k]) => k),
          isActive: true,
        },
      }),
    onSuccess: () => onDone(),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Create promo code</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="LAUNCH20"
              data-testid="input-promo-code"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="discount">Discount (£)</Label>
            <Input id="discount" type="number" min="1" value={discountGbp} onChange={(e) => setDiscountGbp(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="max">Max redemptions</Label>
            <Input id="max" type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="validfor">Valid for (days)</Label>
            <Input id="validfor" type="number" min="1" value={validForDays} onChange={(e) => setValidForDays(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="desc">Description (optional)</Label>
          <Textarea id="desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Internal note shown to admins." />
        </div>
        <div className="space-y-1">
          <Label>Applicable plans</Label>
          <div className="flex gap-4 pt-1">
            {(["basic", "premium", "elite"] as const).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={plans[p]}
                  onCheckedChange={(v) => setPlans({ ...plans, [p]: !!v })}
                />
                <span className="uppercase font-mono text-xs">{p}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button
            onClick={() => { setError(null); create.mutate(); }}
            disabled={create.isPending || !code.trim() || Object.values(plans).every((v) => !v)}
            data-testid="button-create-promo"
          >
            {create.isPending ? "Creating…" : "Create code"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
