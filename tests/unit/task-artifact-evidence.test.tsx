// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskArtifactEvidence } from "../../src/client/TaskArtifactEvidence";
import type { OnboardingTask } from "../../src/shared/domain";

const task: OnboardingTask = {
  id: "task-deck",
  eventId: "event-a",
  speakerId: "speaker-a",
  title: "Final slides",
  description: "Upload the final deck.",
  dueAt: "2026-08-24T23:59:00.000Z",
  status: "complete",
  type: "upload",
  completionMode: "file_request",
  artifactUploadId: "upload-deck",
  artifactFileName: "Final deck.pdf",
  artifactContentType: "application/pdf",
  artifactVersions: [
    { uploadId: "upload-deck", fileName: "Final deck.pdf", contentType: "application/pdf", uploadedAt: "2026-08-10T10:00:00.000Z" },
    { uploadId: "upload-draft", fileName: "Draft deck.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", uploadedAt: "2026-08-09T10:00:00.000Z" },
  ],
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

describe("task artifact evidence", () => {
  it("offers download and replacement for a completed private artifact", async () => {
    const onDownload = vi.fn();
    const onReplace = vi.fn();
    await act(async () => root.render(
      <TaskArtifactEvidence task={task} onDownload={onDownload} onReplace={onReplace} />,
    ));

    expect(container.textContent).toContain("Final deck.pdf");
    expect(container.textContent).toContain("PDF · current private file");
    expect(container.textContent).toContain("1 earlier version");
    expect(container.textContent).toContain("Draft deck.pptx");
    const download = container.querySelector<HTMLButtonElement>('button[aria-label="Download Final deck.pdf"]');
    expect(download).not.toBeNull();
    download?.click();
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenLastCalledWith("upload-deck");
    container.querySelector<HTMLButtonElement>('button[aria-label="Download earlier version Draft deck.pptx"]')?.click();
    expect(onDownload).toHaveBeenLastCalledWith("upload-draft");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Replace Final deck.pdf"]')).not.toBeNull();
  });

  it("keeps a waived task terminal without artifact controls", async () => {
    await act(async () => root.render(
      <TaskArtifactEvidence task={{ ...task, status: "waived" }} onDownload={vi.fn()} onReplace={vi.fn()} />,
    ));

    expect(container.textContent).toBe("");
    expect(container.querySelector("button, input")).toBeNull();
  });
});
