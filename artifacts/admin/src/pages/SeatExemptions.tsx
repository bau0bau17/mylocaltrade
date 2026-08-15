import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { Armchair, Plus } from "lucide-react";

interface SeatExemption {
  id: number;
  traderProfileId: number;
  businessName: string | null;
  activeEmployees: number | null;
  seatLimit: number;
  reason: string;
  expiresAt: string | null;
  expired: boolean;
  revokedAt: string | null;
  createdAt: string;
}

export default function SeatExemptionsPage() {
  const qc = useQueryClient();
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "seat-exemptions", includeRevoked],
    queryFn: () =>
      api<{ exemptions: SeatExemption[] }>("/api/admin/seat-exemptions", {
        query: includeRevoked ? { includeRevoked: 1 } : undefined,
      }),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [seatLimit, setSeatLimit] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["admin", "seat-exemptions"] });

  const grant = useMutation({
    mutationFn: () =>
      api("/api/admin/seat-exemptions", {
        method: "POST",
        body: {
          traderProfileId: Number.parseInt(profileId, 10),
          seatLimit: Number.parseInt(seatLimit, 10),
          reason: reason.trim(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
      }),
    onSuccess: () => {
      setShowCreate(false);
      setProfileId("");
      setSeatLimit("");
      setReason("");
      setExpiresAt("");
      setFormError(null);
      invalidate();
    },
    onError: (err) =>
      setFormError(err instanceof ApiError ? err.message : "Failed to grant the exemption"),
  });

  const revoke = useMutation({
    mutationFn: (id: number) =>
      api(`/api/admin/seat-exemptions/${id}/revoke`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const canSubmit =
    Number.parseInt(profileId, 10) > 0 &&
    Number.parseInt(seatLimit, 10) >= 1 &&
    Number.parseInt(seatLimit, 10) <= 20 &&
    reason.trim().length >= 5;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Armchair className="w-5 h-5" /> Seat exemptions
          </h1>
          <p className="text-sm text-muted-foreground">
            Grandfathering for Team billing: a per-company employee seat allowance that
            applies regardless of the owner's plan (max 20). Grants and revokes are audited
            and reconcile seats immediately — revoking may suspend the newest employees.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)} data-testid="button-new-exemption">
          <Plus className="w-4 h-4 mr-1" /> New exemption
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="exemption-profile-id">Trader profile ID</Label>
                <Input
                  id="exemption-profile-id"
                  inputMode="numeric"
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  placeholder="e.g. 42"
                  data-testid="input-exemption-profile-id"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="exemption-seats">Employee seats (1–20)</Label>
                <Input
                  id="exemption-seats"
                  inputMode="numeric"
                  value={seatLimit}
                  onChange={(e) => setSeatLimit(e.target.value)}
                  placeholder="e.g. 7"
                  data-testid="input-exemption-seats"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="exemption-expires">Expires (optional)</Label>
                <Input
                  id="exemption-expires"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  data-testid="input-exemption-expires"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="exemption-reason">Reason (required, kept forever)</Label>
              <Textarea
                id="exemption-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder='e.g. "Grandfathered: 7 active employees at enforcement launch"'
                data-testid="input-exemption-reason"
              />
            </div>
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => grant.mutate()}
                disabled={!canSubmit || grant.isPending}
                data-testid="button-grant-exemption"
              >
                {grant.isPending ? "Granting…" : "Grant exemption"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant={includeRevoked ? "secondary" : "outline"}
          size="sm"
          onClick={() => setIncludeRevoked((v) => !v)}
          data-testid="button-toggle-revoked"
        >
          {includeRevoked ? "Hiding nothing" : "Show revoked"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiError ? error.message : "Failed to load seat exemptions"}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="space-y-2">
          {(data?.exemptions ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No exemptions.</p>
          )}
          {(data?.exemptions ?? []).map((ex) => {
            const live = !ex.revokedAt && !ex.expired;
            return (
              <Card key={ex.id} data-testid={`card-exemption-${ex.id}`}>
                <CardContent className="pt-4 pb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {ex.businessName ?? `Profile #${ex.traderProfileId}`}
                      </span>
                      <Badge variant="outline">profile {ex.traderProfileId}</Badge>
                      <Badge>{ex.seatLimit} seats</Badge>
                      {ex.activeEmployees != null && (
                        <Badge variant="outline">{ex.activeEmployees} seated now</Badge>
                      )}
                      {ex.revokedAt ? (
                        <Badge variant="destructive">revoked {formatDateTime(ex.revokedAt)}</Badge>
                      ) : ex.expired ? (
                        <Badge variant="destructive">expired</Badge>
                      ) : (
                        <Badge variant="secondary">live</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground break-words">{ex.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Granted {formatDateTime(ex.createdAt)}
                      {ex.expiresAt ? ` · expires ${formatDateTime(ex.expiresAt)}` : " · open-ended"}
                    </p>
                  </div>
                  {live && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => revoke.mutate(ex.id)}
                      disabled={revoke.isPending}
                      data-testid={`button-revoke-exemption-${ex.id}`}
                    >
                      Revoke
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
