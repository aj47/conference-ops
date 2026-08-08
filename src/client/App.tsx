import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ProductShell } from "./Shell";
import { useWorkspace } from "./workspace";
import { ControlRoom } from "./pages/ControlRoom";
import { FormBuilder } from "./pages/FormBuilder";
import { ProposalBoard, ReviewDesk } from "./pages/Proposals";
import { ScheduleBoard } from "./pages/Schedule";
import { SpeakerOperations } from "./pages/SpeakerOps";
import { PublishCenter } from "./pages/Publish";
import { PublicSubmissionWizard } from "./pages/PublicSubmission";
import { SpeakerPortal } from "./pages/Portal";
import { AgendaEmbed, PublicAgenda, SpeakerGallery } from "./pages/PublicProgram";
import { AuthPage } from "./pages/Auth";

function WorkspaceLayout() {
  const { authRequired, loading } = useWorkspace();
  const location = useLocation();
  if (loading) return <div className="route-loader">Opening the control room…</div>;
  if (authRequired) return <Navigate to={`/auth?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  return <ProductShell><Outlet /></ProductShell>;
}

function RoleHome() {
  const { workspace, authRequired, loading } = useWorkspace();
  if (loading) return <div className="route-loader">Opening the workspace…</div>;
  if (authRequired) return <Navigate to="/auth" replace />;
  if (workspace.actor.role === "organizer") return <Navigate to="/workspace" replace />;
  if (workspace.actor.role === "reviewer") return <Navigate to="/reviews" replace />;
  if (workspace.actor.role === "speaker") return <Navigate to="/portal/home" replace />;
  return <Navigate to="/submit/ai-engineer-summit-2026" replace />;
}

function ProtectedPortal() {
  const { authRequired, loading } = useWorkspace();
  const location = useLocation();
  if (loading) return <div className="route-loader">Opening the speaker portal…</div>;
  if (authRequired) return <Navigate to={`/auth?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  return <SpeakerPortal />;
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
    <Routes>
      <Route path="/" element={<RoleHome />} />
      <Route element={<WorkspaceLayout />}>
        <Route path="/workspace" element={<ControlRoom />} />
        <Route path="/forms" element={<FormBuilder />} />
        <Route path="/proposals" element={<ProposalBoard />} />
        <Route path="/reviews" element={<ReviewDesk />} />
        <Route path="/schedule" element={<ScheduleBoard />} />
        <Route path="/speaker-ops" element={<SpeakerOperations />} />
        <Route path="/publish" element={<PublishCenter />} />
      </Route>
      <Route path="/submit/:slug" element={<PublicSubmissionWizard />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/portal" element={<Navigate to="/portal/home" replace />} />
      <Route path="/portal/:section" element={<ProtectedPortal />} />
      <Route path="/agenda" element={<PublicAgenda />} />
      <Route path="/speakers" element={<SpeakerGallery />} />
      <Route path="/embed/agenda" element={<AgendaEmbed />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
