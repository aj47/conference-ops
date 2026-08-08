import { ArrowRight, KeyRound, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "../auth-client";
import { Field, InlineAlert, LogoMark } from "../components";
import { safeReturnTo } from "../return-to";

type AuthMode = "sign_in" | "sign_up" | "reset";

export function AuthPage() {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "reset") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/auth?returnTo=${encodeURIComponent(returnTo)}`,
        });
        if (result.error) throw new Error(result.error.message ?? "Reset instructions could not be sent.");
        setMessage("Password reset instructions are on their way. Check the verified inbox for this account.");
        return;
      }
      if (mode === "sign_up") {
        const result = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: returnTo,
        });
        if (result.error) throw new Error(result.error.message ?? "The account could not be created.");
        setMessage("Account created. Open the verification email before returning to your proposal.");
        return;
      }
      const result = await authClient.signIn.email({ email, password, callbackURL: returnTo });
      if (result.error) throw new Error(result.error.message ?? "Sign-in failed.");
      window.location.assign(returnTo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link to="/agenda" aria-label="Conference Ops agenda"><LogoMark /></Link>
        <div><p className="eyebrow">One verified conference identity</p><h1>Your proposal and production work stay connected.</h1><p>Sign in once to save CFP drafts, receive decisions, and complete speaker tasks without creating duplicate profiles.</p></div>
        <ol><li><ShieldCheck size={17} /><span><strong>Verified ownership</strong><small>Drafts and submissions stay attached to one account.</small></span></li><li><Mail size={17} /><span><strong>Reliable handoffs</strong><small>Decisions and task reminders reach the same inbox.</small></span></li><li><KeyRound size={17} /><span><strong>Recoverable access</strong><small>Reset links revoke older sessions when needed.</small></span></li></ol>
      </section>
      <section className="auth-card">
        <div className="auth-card__mark"><LockKeyhole size={20} /></div>
        <p className="eyebrow">Conference account</p>
        <h2>{mode === "sign_in" ? "Welcome back." : mode === "sign_up" ? "Create your account." : "Reset your password."}</h2>
        <p>{mode === "reset" ? "We’ll send a secure recovery link to your verified address." : "Use the address that should own your proposals and speaker profile."}</p>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="form-stack">
          {mode === "sign_up" && <Field label="Full name"><input required minLength={2} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></Field>}
          <Field label="Email"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          {mode !== "reset" && <Field label="Password" hint={mode === "sign_up" ? "12 characters minimum" : undefined}><input required minLength={12} type="password" autoComplete={mode === "sign_up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>}
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          {message && <InlineAlert tone="info">{message}</InlineAlert>}
          <button type="submit" className="button button--primary button--large button--full" disabled={busy}>{busy ? "Working…" : mode === "sign_in" ? "Sign in" : mode === "sign_up" ? "Create & verify account" : "Send reset link"} <ArrowRight size={16} /></button>
        </form>
        <div className="auth-card__switch">
          {mode === "sign_in" ? <><button type="button" onClick={() => setMode("sign_up")}>Create an account</button><button type="button" onClick={() => setMode("reset")}>Forgot password?</button></> : <button type="button" onClick={() => setMode("sign_in")}>Return to sign in</button>}
        </div>
        <Link to={returnTo} className="text-link">Return without signing in</Link>
      </section>
    </main>
  );
}
