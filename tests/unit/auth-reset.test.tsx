// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock("../../src/client/auth-client", () => ({
  authClient: {
    resetPassword: authMocks.resetPassword,
    requestPasswordReset: authMocks.requestPasswordReset,
    signIn: { email: authMocks.signInEmail },
    signUp: { email: authMocks.signUpEmail },
  },
}));

import { AuthPage } from "../../src/client/pages/Auth";

let container: HTMLDivElement;
let root: Root;

function LocationProbe() {
  const location = useLocation();
  return <output data-location>{`${location.pathname}${location.search}`}</output>;
}

function input(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  authMocks.resetPassword.mockReset().mockResolvedValue({ data: { status: true }, error: null });
  authMocks.requestPasswordReset.mockReset();
  authMocks.signInEmail.mockReset();
  authMocks.signUpEmail.mockReset();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("AuthPage password reset completion", () => {
  it("uses the emailed token, replaces the password, and removes the token from the address", async () => {
    const token = "reset-token-from-email";
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/auth?returnTo=%2Fprogram-settings&token=${token}`]}>
          <Routes>
            <Route path="/auth" element={<><AuthPage /><LocationProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toMatch(/choose a new password/i);
    expect(container.querySelector('input[type="email"]')).toBeNull();
    const passwords = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    expect(passwords).toHaveLength(2);

    await act(async () => {
      input(passwords[0], "A-secure-new-password-2026!");
      input(passwords[1], "A-secure-new-password-2026!");
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(authMocks.resetPassword).toHaveBeenCalledWith({
      newPassword: "A-secure-new-password-2026!",
      token,
    });
    expect(container.textContent).toMatch(/password changed/i);
    expect(container.querySelector("[data-location]")?.textContent).toBe("/auth?returnTo=%2Fprogram-settings");
  });

  it("does not send mismatched passwords", async () => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/auth?token=valid-token"]}><AuthPage /></MemoryRouter>);
    });
    const passwords = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    await act(async () => {
      input(passwords[0], "A-secure-new-password-2026!");
      input(passwords[1], "A-different-password-2026!");
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/do not match/i);
    expect(authMocks.resetPassword).not.toHaveBeenCalled();
  });
});
