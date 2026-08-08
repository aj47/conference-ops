import {
  Bell,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FileStack,
  Globe2,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  Search,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LogoMark, NoticeRegion, PersonaSwitcher, StatusPill } from "./components";
import { useWorkspace } from "./workspace";

const navSections = [
  {
    label: "Operate",
    items: [
      { to: "/workspace", label: "Control room", icon: LayoutDashboard, roles: ["organizer"] },
      { to: "/proposals", label: "Proposals", icon: FileStack, roles: ["organizer", "reviewer"] },
      { to: "/reviews", label: "Review desk", icon: ClipboardCheck, roles: ["organizer", "reviewer"] },
    ],
  },
  {
    label: "Build",
    items: [
      { to: "/forms", label: "CFP builder", icon: BookOpen, roles: ["organizer"] },
      { to: "/schedule", label: "Schedule board", icon: CalendarDays, roles: ["organizer"] },
    ],
  },
  {
    label: "Deliver",
    items: [
      { to: "/speaker-ops", label: "Speaker ops", icon: Users, roles: ["organizer"] },
      { to: "/publish", label: "Publish & send", icon: Send, roles: ["organizer"] },
    ],
  },
  {
    label: "Public",
    items: [
      { to: "/agenda", label: "Agenda", icon: Globe2, roles: ["organizer", "reviewer"] },
      { to: "/speakers", label: "Speaker gallery", icon: Sparkles, roles: ["organizer", "reviewer"] },
    ],
  },
] as const;

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const commands = useMemo(
    () => [
      { label: "Open proposal queue", detail: `${workspace.proposals.length} proposals`, path: "/proposals" },
      { label: "Edit public CFP", detail: `${workspace.forms[0]?.submissions ?? 0} submissions`, path: "/forms" },
      { label: "Resolve schedule conflicts", detail: "Room, track, and speaker checks", path: "/schedule" },
      { label: "Open speaker portal", detail: "Preview the speaker experience", path: "/portal/home" },
      { label: "View public agenda", detail: "Published event program", path: "/agenda" },
    ],
    [workspace.forms, workspace.proposals.length],
  );
  const matches = commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Quick navigation" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette__search">
          <Search size={18} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jump to a workflow…" />
          <button type="button" className="keycap" onClick={onClose}>esc</button>
        </div>
        <div className="command-palette__results">
          {matches.map((command) => (
            <button
              type="button"
              key={command.path}
              onClick={() => {
                navigate(command.path);
                onClose();
              }}
            >
              <span><strong>{command.label}</strong><small>{command.detail}</small></span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProductShell({ children }: PropsWithChildren) {
  const { workspace, source, loading } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const cfpClose = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: workspace.event.timezone,
    timeZoneName: "short",
  }).format(new Date(workspace.event.cfpClosesAt));

  return (
    <div className="product-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {mobileOpen && <button type="button" aria-label="Close navigation" className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar${mobileOpen ? " sidebar--open" : ""}`}>
        <div className="sidebar__brand">
          <LogoMark />
          <button type="button" className="icon-button sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <PanelLeftClose size={18} />
          </button>
        </div>
        <div className="event-ticket">
          <span className="event-ticket__date">28—29 AUG / SF</span>
          <strong>{workspace.event.shortName}</strong>
          <span>{workspace.event.venue}</span>
        </div>
        <nav className="sidebar__nav" aria-label="Primary navigation">
          {navSections.map((section) => {
            const items = section.items.filter((item) => (item.roles as readonly string[]).includes(workspace.actor.role));
            if (!items.length) return null;
            return (
              <div className="nav-section" key={section.label}>
                <p>{section.label}</p>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}>
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar__foot">
          <div className="deadline-stamp">
            <span>CFP closes</span>
            <strong>{cfpClose}</strong>
          </div>
          <PersonaSwitcher />
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button type="button" className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <button type="button" className="command-trigger" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Find a proposal, speaker, or room</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="topbar__meta">
            <span className={`source-indicator${source === "api" ? " source-indicator--live" : ""}`}>
              {loading ? "Connecting" : source === "api" ? "Live workspace" : "Demo fallback"}
            </span>
            <StatusPill status={workspace.event.status} />
            <button type="button" className="icon-button" aria-label="Notifications"><Bell size={18} /></button>
            <button type="button" className="icon-button" aria-label="Help and feedback"><MessageSquareText size={18} /></button>
          </div>
        </header>
        <main id="main-content" className="page-canvas" tabIndex={-1}>{children}</main>
      </div>
      <NoticeRegion />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

export function PublicHeader({ active }: { active?: "agenda" | "speakers" | "cfp" | "portal" }) {
  return (
    <header className="public-header">
      <NavLink to="/agenda"><LogoMark /></NavLink>
      <nav aria-label="Public event navigation">
        <NavLink className={active === "agenda" ? "active" : ""} to="/agenda">Agenda</NavLink>
        <NavLink className={active === "speakers" ? "active" : ""} to="/speakers">Speakers</NavLink>
        <NavLink className={active === "cfp" ? "active" : ""} to="/submit/ai-engineer-summit-2026">Submit a talk</NavLink>
        <a className={active === "portal" ? "active" : ""} href="/portal/home">Portal</a>
      </nav>
      <PersonaSwitcher compact />
    </header>
  );
}
