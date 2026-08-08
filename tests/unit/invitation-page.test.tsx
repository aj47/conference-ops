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
import { InvitationPage } from "../../src/client/pages/Invitation";

let container: HTMLDivElement;
let root: Root;

function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
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

describe("InvitationPage", () => {
  it("sends an anonymous visitor to auth with the invite as a safe return target", async () => {
    const token = "a".repeat(48);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/invite/${token}?source=email`]}>
          <Routes>
            <Route path="/invite/:token" element={<InvitationPage />} />
            <Route path="/auth" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toBe(`/auth?returnTo=${encodeURIComponent(`/invite/${token}?source=email`)}`);
  });

  it("explains a malformed invitation without calling the API", async () => {
    authState.current = {
      ...authState.current,
      data: { user: { email: "reviewer@example.com", emailVerified: true } },
    };
    const accept = vi.spyOn(conferenceApi, "acceptInvitation");

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/invite/short"]}>
          <Routes><Route path="/invite/:token" element={<InvitationPage />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toMatch(/link is incomplete/i);
    expect(container.textContent).toMatch(/token is missing or malformed/i);
    expect(accept).not.toHaveBeenCalled();
  });

  it("shows an actionable server error to the verified invitee", async () => {
    authState.current = {
      ...authState.current,
      data: { user: { email: "reviewer@example.com", emailVerified: true } },
    };
    vi.spyOn(conferenceApi, "acceptInvitation").mockRejectedValue(new Error("This invitation has expired."));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/invite/${"b".repeat(48)}`]}>
          <Routes><Route path="/invite/:token" element={<InvitationPage />} /></Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toMatch(/invitation not accepted/i);
    expect(container.textContent).toContain("This invitation has expired.");
    expect(container.querySelector("button")?.textContent).toMatch(/try again/i);
  });
});
