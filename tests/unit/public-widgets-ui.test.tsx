// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "../../src/shared/demo-data";

const workspaceState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../../src/client/workspace", () => ({ useWorkspace: () => workspaceState.current }));

import { EmbedStudioPanel } from "../../src/client/EmbedStudioPanel";
import { PublicAgendaGrid, PublicItinerary, PublicSessionsList, PublicSpeakerGallery, PublicSpeakersList, PublicWidgetEmbed } from "../../src/client/pages/PublicWidgets";

let container: HTMLDivElement;
let root: Root;

function baseState() {
  const workspace = createDemoWorkspace("user-organizer");
  workspace.event.status = "agenda_published";
  workspace.sessions = workspace.sessions.map((session, index) => index === 2
    ? { ...session, startsAt: "2026-08-29T17:10:00.000Z", endsAt: "2026-08-29T18:10:00.000Z" }
    : session);
  const publicSpeakers = workspace.proposals.filter((proposal) => proposal.status === "accepted").flatMap((proposal) => proposal.speakers).map((speaker) => {
    const publicSpeaker: Partial<typeof speaker> = { ...speaker };
    delete publicSpeaker.email;
    return publicSpeaker as Omit<typeof speaker, "email">;
  });
  return { workspace, publicSpeakers, source: "api", privateWorkspaceEventId: workspace.event.id, setNotice: vi.fn() };
}

function button(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(name) || candidate.getAttribute("aria-label")?.includes(name));
}

async function click(target: Element | undefined | null) {
  expect(target).toBeTruthy();
  await act(async () => target!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function input(target: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderRoute(path: string, element: React.ReactNode) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>));
}

beforeEach(() => {
  workspaceState.current = baseState();
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:calendar");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("anonymous public widget surfaces", () => {
  it("renders complete session cards and searches titles and speaker names", async () => {
    await renderRoute("/events/ai-engineer-summit-2026/sessions", <PublicSessionsList />);
    expect(container.textContent).toContain("Sessions list");
    expect(container.textContent).toContain("Cowell Theater");
    expect(container.textContent).toContain("Marco Ruiz");
    expect(container.textContent).toContain("Staff AI Engineer · Northstar");
    await click(button("Show more"));
    expect(button("Show less")).toBeTruthy();

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search sessions by title or speaker"]')!;
    await input(search, "Ruiz");
    expect(container.textContent).toContain("The eval flywheel");
    expect(container.textContent).not.toContain("Red-team your tool-using model");
  });

  it("keeps speaker list and gallery distinct, surname-ordered, searchable, and drillable", async () => {
    await renderRoute("/events/ai-engineer-summit-2026/speakers", <PublicSpeakersList />);
    const rows = [...container.querySelectorAll<HTMLButtonElement>(".public-speaker-row")];
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Priya Nair"), expect.stringContaining("Marco Ruiz")]);
    await click(rows[0]);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Sessions (1)");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Gallery 308");
    await click(container.querySelector('button[aria-label="Close speaker details"]'));

    await renderRoute("/events/ai-engineer-summit-2026/gallery", <PublicSpeakerGallery />);
    expect(container.querySelectorAll(".public-gallery-card")).toHaveLength(2);
    expect(container.textContent).toContain("Photo coming soon");
    await click(container.querySelector(".public-gallery-card"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Researches evaluation methods");
  });

  it("navigates agenda days and restores the grid after a full session detail", async () => {
    await renderRoute("/events/ai-engineer-summit-2026/agenda", <PublicAgendaGrid />);
    expect(container.querySelector(".public-agenda-grid")).toBeTruthy();
    expect(container.textContent).toContain("Cowell Theater");
    await click(container.querySelector(".public-agenda-block"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Cowell Theater");
    await click(container.querySelector('button[aria-label="Close session details"]'));
    expect(container.querySelector(".public-agenda-grid")).toBeTruthy();
    await click([...container.querySelectorAll<HTMLButtonElement>(".public-day-tabs button")][1]);
    expect(container.textContent).toContain("Red-team your tool-using model");
  });

  it("persists an anonymous personal itinerary and offers iCal export", async () => {
    await renderRoute("/events/ai-engineer-summit-2026/itinerary", <PublicItinerary />);
    const favorites = [...container.querySelectorAll<HTMLButtonElement>(".favorite-button")];
    await click(favorites[0]);
    await click(favorites[1]);
    expect(window.localStorage.getItem("conference-ops:agenda-favorites:ai-engineer-summit-2026")).toContain("session-evals");
    await click(button("My schedule"));
    expect(container.querySelectorAll(".public-itinerary-card")).toHaveLength(2);
    await click(button("Export .ics"));
    expect(container.textContent).toContain("Calendar file downloaded with 2 sessions");
    await click(container.querySelector(".favorite-button"));
    expect(container.querySelectorAll(".public-itinerary-card")).toHaveLength(1);
  });

  it.each(["sessions", "speakers", "agenda", "itinerary", "gallery"])("renders the %s embed route without authentication", async (widget) => {
    await renderRoute(`/events/ai-engineer-summit-2026/embed/${widget}`, <Routes><Route path="/events/:slug/embed/:widget" element={<PublicWidgetEmbed />} /></Routes>);
    expect(container.querySelector(".public-widget-embed")).toBeTruthy();
    expect(container.textContent).toContain("AIE 2026");
  });

  it("applies configured session facets to an embedded speaker gallery", async () => {
    await renderRoute("/events/ai-engineer-summit-2026/embed/gallery?room=room-gallery", <Routes><Route path="/events/:slug/embed/:widget" element={<PublicWidgetEmbed />} /></Routes>);
    expect(container.querySelectorAll(".public-gallery-card")).toHaveLength(1);
    expect(container.textContent).toContain("Priya Nair");
    expect(container.textContent).not.toContain("Marco Ruiz");
  });
});

describe("organizer embed studio", () => {
  it("offers five widgets, five formats, config fields, an iframe snippet, and a share URL", async () => {
    await renderRoute("/program-settings", <EmbedStudioPanel />);
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(5);
    expect([...container.querySelectorAll("option")].map((option) => option.textContent)).toEqual(expect.arrayContaining([
      "Styled HTML · iframe", "Basic HTML · unbranded iframe", "JSON · live endpoint", "XML · live endpoint", "iCal · calendar feed",
    ]));
    expect(container.querySelectorAll('.embed-studio__fields input[type="checkbox"]')).toHaveLength(6);
    await click(button("Generate Styled HTML"));
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Generated embed output"]')?.value).toContain("<iframe");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Shareable widget URL"]')?.value).toContain("/embed/sessions");
  });
});
