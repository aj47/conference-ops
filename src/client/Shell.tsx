import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FileStack,
  Globe2,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  Search,
  Send,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PropsWithChildren, type RefObject } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LogoMark, NoticeRegion, PersonaSwitcher, StatusPill } from "./components";
import { useDialogA11y } from "./dialog-a11y";
import { formatEventTicket } from "./event-time";
import { privateEventPath } from "./private-routes";
import { publicAgendaPath, publicSpeakersPath, publicSubmissionPath } from "./public-routes";
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
      { to: "/program-settings", label: "Program setup", icon: Settings2, roles: ["organizer"] },
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

function CommandPalette({ onClose, returnFocusRef }: { onClose: () => void; returnFocusRef: RefObject<HTMLElement | null> }) {
  const [query, setQuery] = useState("");
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose, true, returnFocusRef);
  const navigate = useNavigate();
  const { workspace, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const commands = useMemo(
    () => [
      { label: "Open proposal queue", detail: `${workspace.proposals.length} proposals`, path: privateEventPath("/proposals", eventId) },
      { label: "Edit public CFP", detail: `${workspace.forms[0]?.submissions ?? 0} submissions`, path: privateEventPath("/forms", eventId) },
      { label: "Resolve schedule conflicts", detail: "Room, track, and speaker checks", path: privateEventPath("/schedule", eventId) },
      { label: "Open speaker portal", detail: "Preview the speaker experience", path: privateEventPath("/portal/home", eventId) },
      { label: "View public agenda", detail: "Published event program", path: publicAgendaPath(workspace.event.slug) },
    ],
    [eventId, workspace.event.slug, workspace.forms, workspace.proposals.length],
  );
  const matches = commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Quick navigation" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette__search">
          <Search size={18} />
          <input data-dialog-initial-focus aria-label="Search commands" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jump to a workflow…" />
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
  const { workspace, source, loading, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);
  const mobileReturnFocusRef = useRef<HTMLElement | null>(null);
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const mobileNavActive = mobileViewport && mobileOpen;
  const closePalette = () => {
    const returnTarget = paletteReturnFocusRef.current;
    setPaletteOpen(false);
    window.setTimeout(() => {
      if (returnTarget?.isConnected) returnTarget.focus();
    }, 0);
  };
  const sidebarRef = useDialogA11y<HTMLElement>(() => setMobileOpen(false), mobileNavActive, mobileReturnFocusRef);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const syncViewport = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        paletteReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setMobileOpen(false);
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
      <a className="skip-link" href="#main-content" tabIndex={mobileNavActive || paletteOpen ? -1 : undefined}>Skip to main content</a>
      {mobileNavActive && <button type="button" tabIndex={-1} aria-hidden="true" className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside
        ref={sidebarRef}
        className={`sidebar${mobileOpen ? " sidebar--open" : ""}`}
        role={mobileNavActive ? "dialog" : undefined}
        aria-modal={mobileNavActive ? "true" : undefined}
        aria-label={mobileNavActive ? "Primary navigation" : undefined}
        aria-hidden={paletteOpen || (mobileViewport && !mobileOpen) ? "true" : undefined}
        inert={paletteOpen || (mobileViewport && !mobileOpen) ? true : undefined}
        tabIndex={mobileNavActive ? -1 : undefined}
      >
        <div className="sidebar__brand">
          <LogoMark />
          <button type="button" className="icon-button sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <PanelLeftClose size={18} />
          </button>
        </div>
        <div className="event-ticket">
          <span className="event-ticket__date">{formatEventTicket(workspace.event)}</span>
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
                  const destination = item.to === "/agenda"
                    ? publicAgendaPath(workspace.event.slug)
                    : item.to === "/speakers"
                      ? publicSpeakersPath(workspace.event.slug)
                      : privateEventPath(item.to, eventId);
                  return (
                    <NavLink key={item.to} to={destination} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}>
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

      <div className="shell-main" inert={mobileNavActive || paletteOpen ? true : undefined}>
        <header className="topbar">
          <button type="button" className="icon-button mobile-menu" onClick={(event) => { mobileReturnFocusRef.current = event.currentTarget; setPaletteOpen(false); setMobileOpen(true); }} aria-label="Open navigation" aria-expanded={mobileNavActive}>
            <Menu size={20} />
          </button>
          <button type="button" className="command-trigger" onClick={(event) => { paletteReturnFocusRef.current = event.currentTarget; setMobileOpen(false); setPaletteOpen(true); }}>
            <Search size={16} />
            <span>Jump to a workflow</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="topbar__meta">
            <span className={`source-indicator${source === "api" ? " source-indicator--live" : ""}`}>
              {loading ? "Connecting" : source === "api" ? "Live workspace" : "Demo fallback"}
            </span>
            <StatusPill status={workspace.event.status} />
          </div>
        </header>
        <main id="main-content" className="page-canvas" tabIndex={-1}>{children}</main>
      </div>
      <NoticeRegion />
      {paletteOpen && <CommandPalette onClose={closePalette} returnFocusRef={paletteReturnFocusRef} />}
    </div>
  );
}

export function PublicHeader({ active }: { active?: "agenda" | "speakers" | "cfp" | "portal" }) {
  const { workspace, source, privateWorkspaceEventId } = useWorkspace();
  const submissionPath = publicSubmissionPath(workspace.event.slug);
  const agendaPath = publicAgendaPath(workspace.event.slug);
  const speakersPath = publicSpeakersPath(workspace.event.slug);
  const portalPath = privateEventPath("/portal/home", privateWorkspaceEventId ?? workspace.event.id);
  return (
    <header className="public-header">
      <NavLink to={agendaPath}><LogoMark /></NavLink>
      <nav aria-label="Public event navigation">
        <NavLink className={active === "agenda" ? "active" : ""} to={agendaPath}>Agenda</NavLink>
        <NavLink className={active === "speakers" ? "active" : ""} to={speakersPath}>Speakers</NavLink>
        <NavLink className={active === "cfp" ? "active" : ""} to={submissionPath}>Submit a talk</NavLink>
        <a className={active === "portal" ? "active" : ""} href={portalPath}>Portal</a>
      </nav>
      {source === "demo" && <PersonaSwitcher compact />}
    </header>
  );
}
