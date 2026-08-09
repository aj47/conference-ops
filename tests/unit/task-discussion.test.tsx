// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDiscussion } from "../../src/client/TaskDiscussion";
import type { OnboardingTask } from "../../src/shared/domain";

const task: OnboardingTask = {
  id: "task-a",
  eventId: "event-a",
  speakerId: "speaker-a",
  title: "Final slides",
  description: "Upload the final deck.",
  dueAt: "2026-08-24T23:59:00.000Z",
  status: "complete",
  type: "upload",
  comments: [{
    id: "comment-a",
    authorId: "speaker-a",
    authorName: "Speaker <script>alert(1)</script>",
    body: "Please use <img src=x onerror=alert(1)> as literal text.",
    createdAt: "2026-08-10T10:00:00.000Z",
  }],
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

describe("task discussion", () => {
  it("renders comment copy as text and posts a trimmed reply", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<TaskDiscussion task={task} onAdd={onAdd} />));

    expect(container.textContent).toContain("Speaker <script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelector("script, img")).toBeNull();

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      valueSetter?.call(textarea, "  Looks good from my side.  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(onAdd).toHaveBeenCalledWith("Looks good from my side.");
  });
});
