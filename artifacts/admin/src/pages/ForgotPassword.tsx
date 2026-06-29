import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, ArrowLeft } from "lucide-react";

type Step = "request" | "reset";

const MIN_PASSWORD = 8;

export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim() },
      });
      // The server always responds generically, so move forward regardless.
      setInfo("If an account exists for that email, a 6-digit code has been sent.");
      setStep("reset");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (code.trim().length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Your new password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { email: email.trim(), code: code.trim(), newPassword: password },
      });
      // Force a fresh sign-in with the new password.
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto bg-primary text-primary-foreground rounded-md w-10 h-10 flex items-center justify-center mb-2">
            <KeyRound className="w-5 h-5" />
          </div>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>
            {step === "request"
              ? "Enter your administrator email to receive a reset code."
              : "Enter the code we emailed you and choose a new password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "request" ? (
            <form onSubmit={handleRequest} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-email"
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
                data-testid="button-send-code"
              >
                {submitting ? "Sending…" : "Send Reset Code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              {info && (
                <Alert>
                  <AlertDescription>{info}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  data-testid="input-code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  data-testid="input-confirm-password"
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
                data-testid="button-reset"
              >
                {submitting ? "Resetting…" : "Reset Password"}
              </Button>
            </form>
          )}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-to-login"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
