// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../src/client/api";
import { WorkspaceProvider, useWorkspace } from "../../src/client/workspace";
import { createDemoWorkspace } from "../../src/shared/demo-data";

type WorkspaceContext = ReturnType<typeof useWorkspace>;

let context: WorkspaceContext | undefined;
let container: HTMLDivElement;
let root: Root;

function Harness({ onContext }: { onContext: (value: WorkspaceContext) => void }) {
  const value = useWorkspace();
  useEffect(() => onContext(value), [onContext, value]);
  return null;
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function currentSpeaker(id: string) {
  const speaker = context?.workspace.proposals
    .flatMap((proposal) => proposal.speakers)
    .find((candidate) => candidate.id === id);
  if (!speaker) throw new Error(`Missing test speaker ${id}`);
  return speaker;
}

async function renderProvider() {
  await act(async () => {
    root.render(
      <WorkspaceProvider>
        <Harness onContext={(value) => { context = value; }} />
      </WorkspaceProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(context?.loading).toBe(false);
  expect(context?.source).toBe("api");
}

beforeEach(() => {
  context = undefined;
  window.localStorage?.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("speaker headshot workspace flow", () => {
  it("uploads the image, preserves profile fields, and exposes a local preview", async () => {
    const workspace = { ...createDemoWorkspace("user-speaker"), demoMode: false };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/bootstrap") return response({ data: workspace });
      if (path.includes("/uploads?purpose=headshot")) {
        return response({ data: { id: "upload-leah", fileName: "leah.webp", status: "stored" } }, 201);
      }
      if (path.endsWith("/speakers/speaker-leah/profile")) {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(payload).toMatchObject({
          name: "Leah Okafor",
          title: "Founder",
          company: "Tracewell",
          bio: "Works on observability for long-running AI workflows.",
          city: "London, UK",
          headshotUploadId: "upload-leah",
          publish: true,
        });
        return response({ data: { id: "speaker-leah", profileComplete: true } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:leah-headshot");
    await renderProvider();

    const file = new File(["image bytes"], "leah.webp", { type: "image/webp" });
    await act(async () => {
      await context!.uploadHeadshot("speaker-leah", file);
    });

    expect(currentSpeaker("speaker-leah")).toMatchObject({
      name: "Leah Okafor",
      title: "Founder",
      company: "Tracewell",
      bio: "Works on observability for long-running AI workflows.",
      city: "London, UK",
      headshotUrl: "blob:leah-headshot",
      profileComplete: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not update the preview or completion when the production profile save fails", async () => {
    const workspace = { ...createDemoWorkspace("user-speaker"), demoMode: false };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/v1/bootstrap") return response({ data: workspace });
      if (path.includes("/uploads?purpose=headshot")) {
        return response({ data: { id: "upload-orphan", fileName: "leah.png", status: "stored" } }, 201);
      }
      if (path.endsWith("/speakers/speaker-leah/profile")) {
        return response({ error: { code: "HEADSHOT_NOT_FOUND", message: "The upload is not available." } }, 422);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:must-not-appear");
    await renderProvider();

    const before = { ...currentSpeaker("speaker-leah") };
    let failure: unknown;
    await act(async () => {
      try {
        await context!.uploadHeadshot(
          "speaker-leah",
          new File(["image bytes"], "leah.png", { type: "image/png" }),
        );
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeInstanceOf(ApiClientError);
    expect(currentSpeaker("speaker-leah")).toEqual(before);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(context?.notice).toBe("The upload is not available.");
  });
});
