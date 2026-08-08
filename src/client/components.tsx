import {
  AlertTriangle,
  Check,
  Circle,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { useEffect, useId } from "react";
import { useNavigate } from "react-router-dom";
import type { Actor, ProposalStatus, TaskStatus } from "../shared/domain";
import { useWorkspace } from "./workspace";

export function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo-mark${compact ? " logo-mark--compact" : ""}`} aria-label="Conference Ops">
      <span className="logo-mark__monogram" aria-hidden="true">CO</span>
      {!compact && (
        <span className="logo-mark__wordmark">
          Conference <em>Ops</em>
        </span>
      )}
    </div>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}

const roleLanding: Record<Actor["role"], string> = {
  organizer: "/workspace",
  reviewer: "/reviews",
  applicant: "/submit/ai-engineer-summit-2026",
  speaker: "/portal/home",
};

export function PersonaSwitcher({ compact = false }: { compact?: boolean }) {
  const { workspace, switchActor } = useWorkspace();
  const navigate = useNavigate();
  const labelId = useId();

  return (
    <label className={`persona-switcher${compact ? " persona-switcher--compact" : ""}`}>
      {!compact && <span id={labelId}>Viewing as</span>}
      <Avatar name={workspace.actor.name} size="sm" />
      <select
        aria-labelledby={compact ? undefined : labelId}
        aria-label={compact ? "Switch demo persona" : undefined}
        value={workspace.actor.id}
        onChange={(event) => {
          const actor = workspace.actors.find((candidate) => candidate.id === event.target.value);
          if (!actor) return;
          switchActor(actor.id);
          navigate(roleLanding[actor.role]);
        }}
      >
        {workspace.actors.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name} · {actor.role}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatusPill({ status }: { status: ProposalStatus | TaskStatus | string }) {
  const normalized = status.toLowerCase().replaceAll(" ", "_");
  const positive = ["accepted", "complete", "published", "open", "cfp_open", "scheduled", "session"].includes(normalized);
  const warning = ["waitlisted", "pending", "in_progress", "under_review", "overdue", "review"].includes(normalized);
  const negative = ["rejected", "closed", "blocked"].includes(normalized);
  return (
    <span className={`status-pill status-pill--${positive ? "positive" : negative ? "negative" : warning ? "warning" : "neutral"}`}>
      {positive ? <Check size={12} /> : negative ? <X size={12} /> : warning ? <Circle size={10} /> : null}
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true">∅</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={18} />
      <span>{label}</span>
    </div>
  );
}

export function NoticeRegion() {
  const { notice, setNotice } = useWorkspace();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div className="notice-toast" role="status">
      <Check size={16} />
      <span>{notice}</span>
      <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss notification">
        <X size={15} />
      </button>
    </div>
  );
}

export function InlineAlert({ children, tone = "warning" }: { children: React.ReactNode; tone?: "warning" | "danger" | "info" }) {
  return (
    <div className={`inline-alert inline-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {tone === "info" ? <Search size={17} /> : <AlertTriangle size={17} />}
      <div>{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`field${error ? " field--error" : ""}`}>
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function ProgressBar({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="progress" aria-label={label}>
      <div className="progress__meta"><span>{label}</span><strong>{Math.round(percentage)}%</strong></div>
      <div className="progress__track"><span style={{ width: `${percentage}%` }} /></div>
    </div>
  );
}
