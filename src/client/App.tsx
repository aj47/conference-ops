import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import type { Role } from "../shared/domain";
import { ProductShell } from "./Shell";
import {
  DEFAULT_PUBLIC_EVENT_SLUG,
  publicAgendaEmbedPath,
  publicAgendaPath,
  publicSpeakersPath,
} from "./public-routes";
import { eventRoleLandingPath, privateEventPath } from "./private-routes";
import { useWorkspace } from "./workspace";

const ControlRoom = lazy(() => import("./pages/ControlRoom").then((module) => ({ default: module.ControlRoom })));
const FormBuilder = lazy(() => import("./pages/FormBuilder").then((module) => ({ default: module.FormBuilder })));
const ProposalBoard = lazy(() => import("./pages/Proposals").then((module) => ({ default: module.ProposalBoard })));
const ReviewDesk = lazy(() => import("./pages/Proposals").then((module) => ({ default: module.ReviewDesk })));
const ScheduleBoard = lazy(() => import("./pages/Schedule").then((module) => ({ default: module.ScheduleBoard })));
const SpeakerOperations = lazy(() => import("./pages/SpeakerOps").then((module) => ({ default: module.SpeakerOperations })));
const PublishCenter = lazy(() => import("./pages/Publish").then((module) => ({ default: module.PublishCenter })));
const PublicSubmissionWizard = lazy(() => import("./pages/PublicSubmission").then((module) => ({ default: module.PublicSubmissionWizard })));
const SpeakerPortal = lazy(() => import("./pages/Portal").then((module) => ({ default: module.SpeakerPortal })));
const AgendaEmbed = lazy(() => import("./pages/PublicProgram").then((module) => ({ default: module.AgendaEmbed })));
const PublicAgenda = lazy(() => import("./pages/PublicProgram").then((module) => ({ default: module.PublicAgenda })));
const SpeakerGallery = lazy(() => import("./pages/PublicProgram").then((module) => ({ default: module.SpeakerGallery })));
const PublicResources = lazy(() => import("./pages/PublicProgram").then((module) => ({ default: module.PublicResources })));
const AuthPage = lazy(() => import("./pages/Auth").then((module) => ({ default: module.AuthPage })));
const InvitationPage = lazy(() => import("./pages/Invitation").then((module) => ({ default: module.InvitationPage })));
const SpeakerClaimPage = lazy(() => import("./pages/SpeakerClaim").then((module) => ({ default: module.SpeakerClaimPage })));
const EventSetupPage = lazy(() => import("./pages/EventSetup").then((module) => ({ default: module.EventSetupPage })));
const ProgramSettings = lazy(() => import("./pages/ProgramSettings").then((module) => ({ default: module.ProgramSettings })));

function WorkspaceLayout() {
  const { authRequired, loading, noEvent } = useWorkspace();
  const location = useLocation();
  if (loading) return <div className="route-loader">Opening the control room…</div>;
  if (authRequired) return <Navigate to={`/auth?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`} replace />;
  if (noEvent) return <Navigate to="/events/new" replace />;
  return <ProductShell><Outlet /></ProductShell>;
}

function RoleHome() {
  const { workspace, authRequired, loading, noEvent, privateWorkspaceEventId } = useWorkspace();
  const location = useLocation();
  if (loading) return <div className="route-loader">Opening the workspace…</div>;
  if (authRequired) return <Navigate to={`/auth?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`} replace />;
  if (noEvent) return <Navigate to="/events/new" replace />;
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  return <Navigate to={eventRoleLandingPath(workspace.actor.role, eventId, workspace.event.slug)} replace />;
}

function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { workspace, authRequired, loading, noEvent, privateWorkspaceEventId } = useWorkspace();
  const location = useLocation();
  if (loading) return <div className="route-loader">Checking event access…</div>;
  if (authRequired) return <Navigate to={`/auth?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`} replace />;
  if (noEvent) return <Navigate to="/events/new" replace />;
  if (!roles.includes(workspace.actor.role)) {
    const eventId = privateWorkspaceEventId ?? workspace.event.id;
    return <Navigate to={eventRoleLandingPath(workspace.actor.role, eventId, workspace.event.slug)} replace />;
  }
  return children;
}

function ProtectedPortal() {
  const { authRequired, loading } = useWorkspace();
  const location = useLocation();
  if (loading) return <div className="route-loader">Opening the speaker portal…</div>;
  if (authRequired) return <Navigate to={`/auth?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`} replace />;
  return <SpeakerPortal />;
}

function PortalRedirect() {
  const { workspace, privateWorkspaceEventId } = useWorkspace();
  return <Navigate to={privateEventPath("/portal/home", privateWorkspaceEventId ?? workspace.event.id)} replace />;
}

function PublicProgramRoute({ children }: { children: ReactNode }) {
  const { publicEventState } = useWorkspace();
  const { slug = "" } = useParams<{ slug: string }>();
  if (publicEventState.status === "loading" || publicEventState.status === "idle" || publicEventState.slug !== slug) {
    return <div className="route-loader" role="status">Opening the published program…</div>;
  }
  if (publicEventState.status === "error") {
    return (
      <div className="public-page">
        <main className="public-unavailable" role="alert">
          <p className="eyebrow">Public program unavailable</p>
          <h1>We couldn’t open this event.</h1>
          <p>{publicEventState.message}</p>
          <button type="button" className="button button--primary" onClick={() => window.location.reload()}>Try again</button>
        </main>
      </div>
    );
  }
  return children;
}

function LegacyPublicRedirect({ section }: { section: "agenda" | "speakers" | "embed" }) {
  const to = section === "agenda"
    ? publicAgendaPath(DEFAULT_PUBLIC_EVENT_SLUG)
    : section === "speakers"
      ? publicSpeakersPath(DEFAULT_PUBLIC_EVENT_SLUG)
      : publicAgendaEmbedPath(DEFAULT_PUBLIC_EVENT_SLUG);
  return <Navigate to={to} replace />;
}

function NotFound() {
  return (
    <div className="not-found">
      <p className="eyebrow">404 / Off the run of show</p>
      <h1>This room isn’t on the schedule.</h1>
      <a className="button button--primary" href="/">Return to the control room</a>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<div className="route-loader">Opening the next workspace…</div>}>
      <Routes>
        <Route path="/" element={<RoleHome />} />
        <Route element={<WorkspaceLayout />}>
          <Route path="/workspace" element={<RoleRoute roles={["organizer"]}><ControlRoom /></RoleRoute>} />
          <Route path="/forms" element={<RoleRoute roles={["organizer"]}><FormBuilder /></RoleRoute>} />
          <Route path="/program-settings" element={<RoleRoute roles={["organizer"]}><ProgramSettings /></RoleRoute>} />
          <Route path="/proposals" element={<RoleRoute roles={["organizer", "reviewer"]}><ProposalBoard /></RoleRoute>} />
          <Route path="/reviews" element={<RoleRoute roles={["organizer", "reviewer"]}><ReviewDesk /></RoleRoute>} />
          <Route path="/schedule" element={<RoleRoute roles={["organizer"]}><ScheduleBoard /></RoleRoute>} />
          <Route path="/speaker-ops" element={<RoleRoute roles={["organizer"]}><SpeakerOperations /></RoleRoute>} />
          <Route path="/publish" element={<RoleRoute roles={["organizer"]}><PublishCenter /></RoleRoute>} />
        </Route>
        <Route path="/submit/:slug" element={<PublicSubmissionWizard />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/events/new" element={<EventSetupPage />} />
        <Route path="/invite/:token" element={<InvitationPage />} />
        <Route path="/speaker/claim/:eventId" element={<SpeakerClaimPage />} />
        <Route path="/portal" element={<PortalRedirect />} />
        <Route path="/portal/:section" element={<ProtectedPortal />} />
        <Route path="/events/:slug/agenda" element={<PublicProgramRoute><PublicAgenda /></PublicProgramRoute>} />
        <Route path="/events/:slug/speakers" element={<PublicProgramRoute><SpeakerGallery /></PublicProgramRoute>} />
        <Route path="/events/:slug/resources" element={<PublicProgramRoute><PublicResources /></PublicProgramRoute>} />
        <Route path="/events/:slug/embed/agenda" element={<PublicProgramRoute><AgendaEmbed /></PublicProgramRoute>} />
        <Route path="/agenda" element={<LegacyPublicRedirect section="agenda" />} />
        <Route path="/speakers" element={<LegacyPublicRedirect section="speakers" />} />
        <Route path="/embed/agenda" element={<LegacyPublicRedirect section="embed" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
