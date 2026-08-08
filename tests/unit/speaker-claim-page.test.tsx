// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    data: null as null | { user: { email: string; emailVerified: boolean } },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  },
}));

vi.mock("../../src/client/auth-client", () => ({
  authClient: { useSession: () => authState.current },
}));

import { conferenceApi } from "../../src/client/api";
import { SpeakerClaimPage } from "../../src/client/pages/SpeakerClaim";

let container: HTMLDivElement;
let root: Root;

function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

function verifiedSession() {
  authState.current = {
    ...authState.current,
    data: { user: { email: "speaker@example.com", emailVerified: true } },
  };
}

async function flushEffects() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  authState.current = {
    data: null,
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  };
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

describe("SpeakerClaimPage", () => {
  it("sends an anonymous visitor to auth with a safe claim return target", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/speaker/claim/event-aie-2026?source=email"]}>
          <Routes>
            <Route path="/speaker/claim/:eventId" element={<SpeakerClaimPage />} />
            <Route path="/auth" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toBe(`/auth?returnTo=${encodeURIComponent("/speaker/claim/event-aie-2026?source=email")}`);
  });

  it("requires a verified session before claiming", async () => {
    authState.current = {
      ...authState.current,
      data: { user: { email: "speaker@example.com", emailVerified: false } },
    };
    const claim = vi.spyOn(conferenceApi, "claimSpeaker");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/speaker/claim/event-aie-2026"]}>
          <Routes>
            <Route path="/speaker/claim/:eventId" element={<SpeakerClaimPage />} />
            <Route path="/auth" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("/auth?returnTo=");
    expect(claim).not.toHaveBeenCalled();
  });

  it("does not call the API for a malformed claim route", async () => {
    verifiedSession();
    const claim = vi.spyOn(conferenceApi, "claimSpeaker");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/speaker/claim/%2E%2E%2Fevent-a"]}>
          <Routes><Route path="/speaker/claim/:eventId" element={<SpeakerClaimPage />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toMatch(/claim link is incomplete/i);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/identifier is missing or malformed/i);
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims the matching speaker record and requests a full-page portal handoff", async () => {
    verifiedSession();
    vi.spyOn(conferenceApi, "claimSpeaker").mockResolvedValue({
      eventId: "event-aie-2026",
      role: "speaker",
      speakerProfileId: "speaker-a",
      claimed: true,
    });
    const onClaimed = vi.fn();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/speaker/claim/event-aie-2026"]}>
          <Routes><Route path="/speaker/claim/:eventId" element={<SpeakerClaimPage onClaimed={onClaimed} />} /></Routes>
        </MemoryRouter>,
      );
      await flushEffects();
    });

    expect(conferenceApi.claimSpeaker).toHaveBeenCalledWith("event-aie-2026");
    expect(onClaimed).toHaveBeenCalledWith("event-aie-2026");
    expect(container.textContent).toMatch(/speaker access connected/i);
    expect(container.querySelector("a.button--primary")?.getAttribute("href")).toBe("/portal/home?eventId=event-aie-2026&role=speaker");
  });

  it("announces a claim error and retries without duplicating the first attempt", async () => {
    verifiedSession();
    const claim = vi.spyOn(conferenceApi, "claimSpeaker")
      .mockRejectedValueOnce(new Error("No invitation matches this verified email."))
      .mockResolvedValueOnce({
        eventId: "event-aie-2026",
        role: "speaker",
        speakerProfileId: "speaker-a",
        claimed: true,
      });
    const onClaimed = vi.fn();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/speaker/claim/event-aie-2026"]}>
          <Routes><Route path="/speaker/claim/:eventId" element={<SpeakerClaimPage onClaimed={onClaimed} />} /></Routes>
        </MemoryRouter>,
      );
      await flushEffects();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No invitation matches this verified email.");
    expect(container.querySelector("h2")?.getAttribute("tabindex")).toBe("-1");
    const retry = Array.from(container.querySelectorAll("button")).find((button) => /try again/i.test(button.textContent ?? ""));
    expect(retry).toBeDefined();

    await act(async () => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects();
    });

    expect(claim).toHaveBeenCalledTimes(2);
    expect(onClaimed).toHaveBeenCalledWith("event-aie-2026");
  });
});
