import {
  ArrowRight,
  BadgeCheck,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { ApiClientError, conferenceApi } from "../api";
import { authClient } from "../auth-client";
import { InlineAlert, LogoMark } from "../components";
import { authPathFor, safeReturnTo } from "../return-to";
import {
  isSpeakerClaimEventId,
  openSpeakerPortal,
  speakerPortalDestination,
} from "../speaker-claim-model";

type SpeakerClaimState =
  | { kind: "idle" }
  | { kind: "claimed"; eventId: string }
  | { kind: "auth_required" }
  | { kind: "error"; message: string };

interface SpeakerClaimPageProps {
  onClaimed?: (eventId: string) => void;
}

export function SpeakerClaimPage({ onClaimed = openSpeakerPortal }: SpeakerClaimPageProps) {
  const { eventId = "" } = useParams();
  const location = useLocation();
  const session = authClient.useSession();
  const [state, setState] = useState<SpeakerClaimState>({ kind: "idle" });
  const [retryCount, setRetryCount] = useState(0);
  const attemptedEventId = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnTo = safeReturnTo(`${location.pathname}${location.search}${location.hash}`);
  const authPath = authPathFor(returnTo);
  const user = session.data?.user;
  const hasVerifiedIdentity = Boolean(user?.email && user.emailVerified === true);
  const eventIdIsValid = isSpeakerClaimEventId(eventId);

  useEffect(() => {
    if (session.isPending || !hasVerifiedIdentity || !eventIdIsValid) return;
    if (attemptedEventId.current === eventId) return;
    attemptedEventId.current = eventId;
    conferenceApi.claimSpeaker(eventId)
      .then((result) => setState({ kind: "claimed", eventId: result.eventId }))
      .catch((error: unknown) => {
        if (error instanceof ApiClientError && error.status === 401) {
          setState({ kind: "auth_required" });
          return;
        }
        setState({
          kind: "error",
          message: error instanceof Error
            ? error.message
            : "This speaker invitation could not be connected.",
        });
      });
  }, [eventId, eventIdIsValid, hasVerifiedIdentity, retryCount, session.isPending]);

  useEffect(() => {
    if (state.kind !== "claimed") return;
    onClaimed(state.eventId);
  }, [onClaimed, state]);

  useEffect(() => {
    if (state.kind === "error") headingRef.current?.focus();
  }, [state.kind]);

  if (!session.isPending && (!hasVerifiedIdentity || state.kind === "auth_required")) {
    return <Navigate to={authPath} replace />;
  }

  const claiming = session.isPending || state.kind === "idle";

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link to="/agenda" aria-label="Conference Ops agenda"><LogoMark /></Link>
        <div>
          <p className="eyebrow">Speaker handoff</p>
          <h1>Connect the invitation to your conference account.</h1>
          <p>Conference Ops matches the verified email on your account to the speaker record created by the program team.</p>
        </div>
        <ol>
          <li><ShieldCheck size={17} /><span><strong>Verified identity</strong><small>The account email must already be verified.</small></span></li>
          <li><UserRoundCheck size={17} /><span><strong>Exact invitation match</strong><small>Only the invited speaker can claim this profile.</small></span></li>
          <li><KeyRound size={17} /><span><strong>One connected portal</strong><small>Profile details, tasks, and session updates stay together.</small></span></li>
        </ol>
      </section>

      <section className="auth-card" aria-live="polite" aria-busy={claiming}>
        <div className="auth-card__mark">
          {claiming ? <LoaderCircle className="spin" size={20} /> : <BadgeCheck size={20} />}
        </div>
        <p className="eyebrow">Speaker invitation</p>
        {session.isPending ? (
          <><h2>Checking your identity.</h2><p>Confirming the signed-in conference account before connecting the speaker record.</p></>
        ) : !eventIdIsValid ? (
          <><h2 ref={headingRef} tabIndex={-1}>This claim link is incomplete.</h2><p>Open the full link from the speaker invitation, or ask the organizer to send it again.</p><InlineAlert tone="danger">The event identifier is missing or malformed.</InlineAlert></>
        ) : state.kind === "error" ? (
          <>
            <h2 ref={headingRef} tabIndex={-1}>Speaker invitation not connected.</h2>
            <p>Signed in as <strong>{user?.email}</strong>.</p>
            <InlineAlert tone="danger">{state.message}</InlineAlert>
            <div className="auth-card__switch">
              <button type="button" onClick={() => {
                attemptedEventId.current = null;
                setState({ kind: "idle" });
                setRetryCount((value) => value + 1);
              }}>Try again</button>
              <Link className="text-link" to={authPath}>Use another account</Link>
            </div>
          </>
        ) : state.kind === "claimed" ? (
          <>
            <h2>Speaker access connected.</h2>
            <p>Your verified account now owns this speaker profile. Opening the portal now.</p>
            <a className="button button--primary button--large button--full" href={speakerPortalDestination(state.eventId)}>Continue to portal <ArrowRight size={16} /></a>
          </>
        ) : (
          <>
            <h2>Connecting your speaker invitation.</h2>
            <p>Verified as <strong>{user?.email}</strong>. This usually takes only a moment.</p>
          </>
        )}
      </section>
    </main>
  );
}
