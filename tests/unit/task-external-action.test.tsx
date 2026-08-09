// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskExternalAction } from "../../src/client/TaskExternalAction";
import type { OnboardingTask } from "../../src/shared/domain";

const task: OnboardingTask = {
  id: "task-calendar",
  eventId: "event-a",
  speakerId: "speaker-a",
  title: "Confirm attendance",
  description: "Open the scheduling page, then separately mark complete.",
  dueAt: "2026-08-24T23:59:00.000Z",
  status: "not_started",
  type: "calendar",
  completionMode: "manual",
  externalUrl: "https://schedule.example.test/speaker/confirm",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("external task action", () => {
  it("renders an HTTPS Open link without acting as a completion control", async () => {
    await act(async () => root.render(<TaskExternalAction task={task} />));
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.textContent).toContain("Open link");
    expect(link?.href).toBe("https://schedule.example.test/speaker/confirm");
    expect(link?.target).toBe("_blank");
    expect(container.querySelector("button, input")).toBeNull();
  });

  it("does not render unsafe or non-manual links", async () => {
    await act(async () => root.render(<TaskExternalAction task={{ ...task, externalUrl: "javascript:alert(1)" }} />));
    expect(container.querySelector("a")).toBeNull();
    await act(async () => root.render(<TaskExternalAction task={{ ...task, completionMode: "form" }} />));
    expect(container.querySelector("a")).toBeNull();
  });
});
