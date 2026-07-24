import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BellOff, Bell, Smartphone, Search, Timer, User } from "lucide-react";
import { formatDateTime } from "@/lib/format";

interface MuteState {
  active: boolean;
  kind: "TIMED" | "INDEFINITE" | null;
  mutedAt: string | null;
  mutedUntil: string | null;
}

interface ParticipantHealth {
  userId: number;
  name: string;
  email: string;
  businessName?: string;
  pushEnabled: boolean;
  deviceCount: number;
  lastPushDeliveredAt: string | null;
  mute: MuteState;
}

interface MutedConversation {
  conversationId: number;
  serviceRequired: string | null;
  status: string;
  lastMessageAt: string;
  customer: ParticipantHealth;
  trader: ParticipantHealth;
}

interface NotificationHealthResponse {
  total: number;
  limit: number;
  offset: number;
  conversations: MutedConversation[];
}

interface UserHealth {
  userId: number;
  name: string;
  email: string;
  role: string;
  pushEnabled: boolean;
  deviceCount: number;
  lastPushDeliveredAt: string | null;
  mutedConversationCount: number;
  suspendedAt: string | null;
}

function formatCountdown(until: string): string {
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return "expiring";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m left`;
  return `${Math.round(hours / 24)}d left`;
}

function MuteBadge({ mute }: { mute: MuteState }) {
  if (!mute.active) return null;
  return mute.kind === "TIMED" ? (
    <Badge
      variant="outline"
      className="bg-amber-500/10 text-amber-700 border-amber-500/30 flex items-center gap-1"
      title={`Muted until ${formatDateTime(mute.mutedUntil!)}`}
    >
      <Timer className="w-3 h-3" />
      Muted · {formatCountdown(mute.mutedUntil!)}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="bg-red-500/10 text-red-600 border-red-500/30 flex items-center gap-1"
      title={mute.mutedAt ? `Muted since ${formatDateTime(mute.mutedAt)}` : undefined}
    >
      <BellOff className="w-3 h-3" />
      Muted indefinitely
    </Badge>
  );
}

function PushStatus({ p }: { p: ParticipantHealth | UserHealth }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
      {p.pushEnabled ? (
        <span className="flex items-center gap-1 text-emerald-600">
          <Bell className="w-3 h-3" /> Push on
        </span>
      ) : (
        <span className="flex items-center gap-1 text-red-600 font-semibold">
          <BellOff className="w-3 h-3" /> Push OFF globally
        </span>
      )}
      <span className="flex items-center gap-1">
        <Smartphone className="w-3 h-3" />
        {p.deviceCount} device{p.deviceCount === 1 ? "" : "s"}
      </span>
      <span>
        Last delivery:{" "}
        {p.lastPushDeliveredAt ? formatDateTime(p.lastPushDeliveredAt) : "never recorded"}
      </span>
    </div>
  );
}

function ParticipantPanel({
  role,
  p,
}: {
  role: "Customer" | "Trader";
  p: ParticipantHealth;
}) {
  return (
    <div className="border rounded-md p-3 space-y-1.5 flex-1 min-w-[260px]" data-testid={`nh-${role.toLowerCase()}-${p.userId}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm">
          <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">{role}</span>
          <span className="font-semibold">{p.businessName ?? p.name}</span>
          {p.businessName ? (
            <span className="text-xs text-muted-foreground ml-1">({p.name})</span>
          ) : null}
        </div>
        <MuteBadge mute={p.mute} />
      </div>
      <p className="text-xs text-muted-foreground">{p.email}</p>
      <PushStatus p={p} />
    </div>
  );
}

export default function NotificationHealthPage() {
  const [side, setSide] = useState<"all" | "customer" | "trader">("all");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [submittedUserSearch, setSubmittedUserSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "notification-health", side, submittedSearch],
    queryFn: () =>
      api<NotificationHealthResponse>("/api/admin/notification-health", {
        query: {
          ...(side !== "all" ? { side } : {}),
          ...(submittedSearch ? { search: submittedSearch } : {}),
        },
      }),
  });

  const userLookup = useQuery({
    queryKey: ["admin", "notification-health-users", submittedUserSearch],
    queryFn: () =>
      api<{ users: UserHealth[] }>("/api/admin/notification-health/users", {
        query: { search: submittedUserSearch },
      }),
    enabled: submittedUserSearch.length >= 2,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BellOff className="w-6 h-6 text-amber-600" />
          Notification health
        </h1>
        <p className="text-sm text-muted-foreground">
          Active conversation mutes, global push toggles, and last successful push delivery —
          for answering "why didn't this user get notified?".
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Look up a user
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmittedUserSearch(userSearch.trim());
            }}
          >
            <Input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Name or email…"
              className="max-w-sm"
              data-testid="nh-user-search"
            />
            <Button type="submit" size="sm" variant="outline" disabled={userSearch.trim().length < 2}>
              <Search className="w-4 h-4 mr-1" /> Search
            </Button>
          </form>
          {userLookup.isLoading ? <Skeleton className="h-16 w-full" /> : null}
          {userLookup.error ? (
            <Alert variant="destructive">
              <AlertDescription>Could not look up users.</AlertDescription>
            </Alert>
          ) : null}
          {userLookup.data ? (
            userLookup.data.users.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No matching users.</p>
            ) : (
              <div className="space-y-2">
                {userLookup.data.users.map((u) => (
                  <div
                    key={u.userId}
                    className="border rounded-md p-3 space-y-1.5"
                    data-testid={`nh-user-${u.userId}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{u.name}</span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {u.role}
                      </span>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                      {u.suspendedAt ? (
                        <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
                          Suspended
                        </Badge>
                      ) : null}
                      {u.mutedConversationCount > 0 ? (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
                          {u.mutedConversationCount} muted conversation
                          {u.mutedConversationCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    <PushStatus p={u} />
                  </div>
                ))}
              </div>
            )
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">
            Currently muted conversations
            {typeof data?.total === "number" ? (
              <span className="text-sm font-normal text-muted-foreground ml-2">({data.total})</span>
            ) : null}
          </h2>
          <div className="flex gap-2 items-center flex-wrap">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSubmittedSearch(search.trim());
              }}
            >
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by name, email, business…"
                className="w-64"
                data-testid="nh-conv-search"
              />
              <Button type="submit" size="sm" variant="outline">
                <Search className="w-4 h-4" />
              </Button>
            </form>
            {(["all", "customer", "trader"] as const).map((s) => (
              <Button
                key={s}
                variant={side === s ? "default" : "outline"}
                size="sm"
                onClick={() => setSide(s)}
                data-testid={`nh-filter-${s}`}
              >
                {s === "all" ? "All" : s === "customer" ? "Customer muted" : "Trader muted"}
              </Button>
            ))}
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Could not load notification health."}
            </AlertDescription>
          </Alert>
        ) : null}

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : (data?.conversations?.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No conversations are currently muted
              {side !== "all" ? ` on the ${side} side` : ""}
              {submittedSearch ? ` matching "${submittedSearch}"` : ""}.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {data!.conversations.map((c) => (
              <Card key={c.conversationId} data-testid={`nh-conv-${c.conversationId}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-sm font-semibold">
                      Conversation #{c.conversationId}
                      {c.serviceRequired ? (
                        <span className="font-normal text-muted-foreground"> · {c.serviceRequired}</span>
                      ) : null}
                    </CardTitle>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{c.status.replace(/_/g, " ")}</Badge>
                      <span>Last message {formatDateTime(c.lastMessageAt)}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex gap-3 flex-wrap">
                  <ParticipantPanel role="Customer" p={c.customer} />
                  <ParticipantPanel role="Trader" p={c.trader} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
