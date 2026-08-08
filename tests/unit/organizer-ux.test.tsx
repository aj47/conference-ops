// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspaceState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("../../src/client/workspace", () => ({
  useWorkspace: () => workspaceState.current,
}));

import { ProductShell } from "../../src/client/Shell";
import { VenueSettingsDrawer } from "../../src/client/VenueSettingsDrawer";
import { cfpDeadlineValidation } from "../../src/client/event-setup-validation";
import { EventSetupPage } from "../../src/client/pages/EventSetup";

let container: HTMLDivElement;
let root: Root;

const organizer = { id: "user-organizer", name: "Organizer", email: "organizer@example.com", role: "organizer" as const };
const event = {
  id: "event-a",
  organizationId: "org-a",
  name: "Practical AI Summit",
  shortName: "PAI 2027",
  slug: "practical-ai-summit",
  description: "A practical conference.",
  timezone: "America/Los_Angeles",
  startsAt: "2027-08-28T16:00:00.000Z",
  endsAt: "2027-08-29T01:00:00.000Z",
  cfpClosesAt: "2027-07-31T23:00:00.000Z",
  venue: "Fort Mason",
  websiteUrl: "",
  status: "draft" as const,
  accent: "#e05b3f",
};

function baseWorkspace() {
  return {
    workspace: {
      event,
      actor: organizer,
      actors: [organizer],
      forms: [],
      proposals: [],
      rooms: [{ id: "room-a", name: "Main theater", capacity: 300 }],
      tracks: [{ id: "track-a", name: "Build", color: "#e05b3f" }],
      sessions: [],
    },
    source: "api",
    loading: false,
    authRequired: false,
    privateWorkspaceEventId: event.id,
    notice: null,
    setNotice: vi.fn(),
    switchActor: vi.fn(),
    createEvent: vi.fn(),
    createRoom: vi.fn(),
    updateRoom: vi.fn(),
    deleteRoom: vi.fn(),
    createTrack: vi.fn(),
    updateTrack: vi.fn(),
    deleteTrack: vi.fn(),
  };
}

function buttonNamed(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim().includes(name) || button.getAttribute("aria-label") === name);
}

function inputLabeled(label: string) {
  const field = [...container.querySelectorAll<HTMLLabelElement>("label")]
    .find((candidate) => candidate.querySelector(":scope > .field__label")?.textContent === label);
  return field?.querySelector<HTMLInputElement>("input") ?? null;
}

async function setInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  workspaceState.current = baseWorkspace();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("organizer interaction regressions", () => {
  it("blocks event creation and explains a CFP deadline at or after the event start", async () => {
    expect(cfpDeadlineValidation("2027-08-28T09:00", "2027-08-28T09:00", event.timezone))
      .toBe("CFP close must be before the event starts.");

    await act(async () => root.render(<MemoryRouter><EventSetupPage /></MemoryRouter>));
    await setInput(inputLabeled("Organization")!, "Program Guild");
    await setInput(inputLabeled("Event name")!, "Practical AI Summit 2027");
    await setInput(inputLabeled("Short name")!, "PAI 2027");
    await setInput(inputLabeled("Event starts")!, "2027-08-28T09:00");
    await setInput(inputLabeled("CFP closes")!, "2027-08-28T09:00");

    const closeInput = inputLabeled("CFP closes")!;
    expect(closeInput.getAttribute("aria-invalid")).toBe("true");
    expect(closeInput.closest("label")?.textContent).toContain("CFP close must be before the event starts.");
    expect(buttonNamed("Create event workspace")?.disabled).toBe(true);

    await setInput(closeInput, "2027-08-27T09:00");
    expect(closeInput.getAttribute("aria-invalid")).toBe("false");
    expect(buttonNamed("Create event workspace")?.disabled).toBe(false);
  });

  it("exposes and updates the accent swatch pressed state", async () => {
    await act(async () => root.render(<MemoryRouter><EventSetupPage /></MemoryRouter>));
    const initial = container.querySelector<HTMLButtonElement>('button[aria-label="Use #e05b3f as event accent"]')!;
    const alternate = container.querySelector<HTMLButtonElement>('button[aria-label="Use #2d6a6c as event accent"]')!;
    expect(initial.getAttribute("aria-pressed")).toBe("true");
    expect(alternate.getAttribute("aria-pressed")).toBe("false");

    await act(async () => alternate.click());
    expect(initial.getAttribute("aria-pressed")).toBe("false");
    expect(alternate.getAttribute("aria-pressed")).toBe("true");
  });

  it("returns focus to the command trigger after Escape closes the palette", async () => {
    await act(async () => root.render(<MemoryRouter><ProductShell><p>Workspace</p></ProductShell></MemoryRouter>));
    const trigger = container.querySelector<HTMLButtonElement>(".command-trigger")!;
    trigger.focus();
    await act(async () => trigger.click());
    expect(container.querySelector('[role="dialog"][aria-label="Quick navigation"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="dialog"][aria-label="Quick navigation"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("uses the first Escape to dismiss a delete alert without closing Rooms & tracks", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<VenueSettingsDrawer open onClose={onClose} />));
    await act(async () => buttonNamed("Delete Main theater")?.click());
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes Rooms & tracks on the first Done click", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<VenueSettingsDrawer open onClose={onClose} />));
    await act(async () => buttonNamed("Done")?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
