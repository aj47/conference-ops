import {
  ArrowRight,
  BadgeCheck,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { ApiClientError, conferenceApi } from "../api";
import { authClient } from "../auth-client";
import { InlineAlert, LogoMark } from "../components";
import { invitationDestination, type InvitationRole } from "../invitation-model";
import { authPathFor, safeReturnTo } from "../return-to";

type InvitationState =
  | { kind: "idle" }
  | { kind: "accepted"; role: InvitationRole; eventId?: string }
  | { kind: "auth_required" }
  | { kind: "error"; message: string };

export function InvitationPage() {
  const { token = "" } = useParams();
  const location = useLocation();
  const session = authClient.useSession();
  const [state, setState] = useState<InvitationState>({ kind: "idle" });
  const [retryCount, setRetryCount] = useState(0);
  const attemptedToken = useRef<string | null>(null);
  const returnTo = safeReturnTo(`${location.pathname}${location.search}${location.hash}`);
  const authPath = authPathFor(returnTo);
  const user = session.data?.user;
  const hasVerifiedIdentity = Boolean(user?.email && user.emailVerified === true);
  const tokenIsValid = token.length >= 32 && token.length <= 512;

  useEffect(() => {
    if (session.isPending || !hasVerifiedIdentity || !tokenIsValid) return;
    if (attemptedToken.current === token) return;
    attemptedToken.current = token;
    conferenceApi.acceptInvitation(token)
      .then((result) => setState({ kind: "accepted", role: result.role, eventId: result.eventId }))
      .catch((error: unknown) => {
        if (error instanceof ApiClientError && error.status === 401) {
          setState({ kind: "auth_required" });
          return;
        }
        setState({
          kind: "error",
          message: error instanceof Error
            ? error.message
            : "This invitation could not be accepted.",
        });
      });
  }, [hasVerifiedIdentity, retryCount, session.isPending, token, tokenIsValid]);

  useEffect(() => {
    if (state.kind !== "accepted") return;
    window.location.replace(invitationDestination(state.role, state.eventId));
  }, [state]);

  if (!session.isPending && (!hasVerifiedIdentity || state.kind === "auth_required")) {
    return <Navigate to={authPath} replace />;
  }

  const accepting = session.isPending || state.kind === "idle";
  const destination = state.kind === "accepted" ? invitationDestination(state.role, state.eventId) : null;

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link to="/agenda" aria-label="Conference Ops agenda"><LogoMark /></Link>
        <div>
          <p className="eyebrow">Staff handoff</p>
          <h1>Join the room where decisions become a program.</h1>
          <p>Your invitation grants access to one event and one working role. Conference Ops verifies the account before adding it to the team.</p>
        </div>
        <ol>
          <li><ShieldCheck size={17} /><span><strong>Identity checked</strong><small>The invitation must match your verified account.</small></span></li>
          <li><UsersRound size={17} /><span><strong>Role scoped</strong><small>You receive only the workspace access you were offered.</small></span></li>
          <li><KeyRound size={17} /><span><strong>One-time handoff</strong><small>Accepted links cannot be reused by another account.</small></span></li>
        </ol>
      </section>

      <section className="auth-card" aria-live="polite">
        <div className="auth-card__mark">
          {accepting ? <LoaderCircle className="spin" size={20} /> : <BadgeCheck size={20} />}
        </div>
        <p className="eyebrow">Team invitation</p>
        {session.isPending ? (
          <><h2>Checking your identity.</h2><p>Confirming the signed-in conference account before opening the invitation.</p></>
        ) : !tokenIsValid ? (
          <><h2>This link is incomplete.</h2><p>Open the full invitation link from the email, or ask the organizer to send a new one.</p><InlineAlert tone="danger">The invitation token is missing or malformed.</InlineAlert></>
        ) : state.kind === "error" ? (
          <>
            <h2>Invitation not accepted.</h2>
            <p>Signed in as <strong>{user?.email}</strong>.</p>
            <InlineAlert tone="danger">{state.message}</InlineAlert>
            <div className="auth-card__switch">
              <button type="button" onClick={() => { attemptedToken.current = null; setState({ kind: "idle" }); setRetryCount((value) => value + 1); }}>Try again</button>
              <Link className="text-link" to={authPath}>Use another account</Link>
            </div>
          </>
        ) : state.kind === "accepted" ? (
          <>
            <h2>Invitation accepted.</h2>
            <p>Your {state.role} access is ready. Opening the {state.role === "reviewer" ? "review desk" : "event workspace"} now.</p>
            <a className="button button--primary button--large button--full" href={destination ?? "/"}>Continue <ArrowRight size={16} /></a>
          </>
        ) : (
          <>
            <h2>Accepting your invitation.</h2>
            <p>Verified as <strong>{user?.email}</strong>. This usually takes only a moment.</p>
          </>
        )}
      </section>
    </main>
  );
}
