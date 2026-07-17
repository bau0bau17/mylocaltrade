import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, UserPlus } from "lucide-react";

interface TeamAdmin {
  id: number;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

export default function TeamPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [promoteEmail, setPromoteEmail] = useState("");

  const isSuperAdmin = !!user?.isSuperAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "team"],
    queryFn: () => api<{ admins: TeamAdmin[] }>("/api/admin/team"),
    enabled: isSuperAdmin,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "team"] });

  const promote = useMutation({
    mutationFn: (email: string) =>
      api<{ ok: boolean }>("/api/admin/team/promote", { method: "POST", body: { email } }),
    onSuccess: () => {
      toast({ title: "Admin added", description: "They now have standard admin access and must sign in again." });
      setPromoteEmail("");
      refresh();
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not add admin",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      }),
  });

  const demote = useMutation({
    mutationFn: (userId: number) =>
      api<{ ok: boolean }>(`/api/admin/team/${userId}/demote`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Admin access removed" });
      refresh();
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not remove admin access",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      }),
  });

  const setActive = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      api<{ ok: boolean }>(`/api/admin/team/${userId}/active`, {
        method: "POST",
        body: { isActive },
      }),
    onSuccess: (_d, vars) => {
      toast({ title: vars.isActive ? "Admin reactivated" : "Admin suspended" });
      refresh();
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not update account",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      }),
  });

  const admins = data?.admins ?? [];

  if (!isSuperAdmin) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Team management is only available to super admin accounts.
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Admin team</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Standard admins can verify traders, moderate reports and handle day-to-day work, but
          cannot see audit logs or manage the team. Only super admins have full access.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <Label className="text-xs uppercase tracking-wide flex items-center gap-2">
          <UserPlus className="w-3.5 h-3.5" /> Add a standard admin
        </Label>
        <p className="text-xs text-muted-foreground">
          The person must already have a registered, email-verified customer account.
        </p>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="colleague@example.com"
            value={promoteEmail}
            onChange={(e) => setPromoteEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && promoteEmail.trim()) promote.mutate(promoteEmail.trim());
            }}
            data-testid="input-promote-email"
          />
          <Button
            onClick={() => promote.mutate(promoteEmail.trim())}
            disabled={!promoteEmail.trim() || promote.isPending}
            data-testid="button-promote-admin"
          >
            {promote.isPending ? "Adding…" : "Add admin"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card divide-y">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : admins.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No admin accounts found.</div>
        ) : (
          admins.map((a) => (
            <div key={a.id} className="p-4 flex flex-wrap items-center gap-3" data-testid={`row-admin-${a.id}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm flex items-center gap-2">
                  {a.fullName}
                  {a.isSuperAdmin && (
                    <Badge className="gap-1" data-testid={`badge-super-${a.id}`}>
                      <ShieldCheck className="w-3 h-3" /> Super admin
                    </Badge>
                  )}
                  {!a.isSuperAdmin && <Badge variant="secondary">Standard admin</Badge>}
                  {!a.isActive && <Badge variant="destructive">Suspended</Badge>}
                  {a.id === user?.id && <Badge variant="outline">You</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.email} · added {formatDateTime(a.createdAt)}
                </div>
              </div>
              {!a.isSuperAdmin && a.id !== user?.id && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActive.mutate({ userId: a.id, isActive: !a.isActive })}
                    disabled={setActive.isPending}
                    data-testid={`button-toggle-active-${a.id}`}
                  >
                    {a.isActive ? "Suspend" : "Reactivate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm(`Remove admin access for ${a.fullName}? Their account goes back to a normal customer account.`)) {
                        demote.mutate(a.id);
                      }
                    }}
                    disabled={demote.isPending}
                    data-testid={`button-demote-${a.id}`}
                  >
                    Remove access
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
