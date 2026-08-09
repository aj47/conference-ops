// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "../../src/shared/demo-data";
import { workspaceProposalForRole } from "../../src/server/workspace";

const workspaceState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../src/client/workspace", () => ({
  useWorkspace: () => workspaceState.current,
}));

import { AbstractReviewControl } from "../../src/client/AbstractReviewControl";
import { FormResponseList } from "../../src/client/FormResponseList";

let container: HTMLDivElement;
let root: Root;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  const workspace = createDemoWorkspace("user-organizer");
  workspaceState.current = { workspace, setNotice: vi.fn() };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("abstract review command center", () => {
  it("renders proposal evidence without participant answers in a blind-review projection", async () => {
    const base = createDemoWorkspace("user-reviewer").proposals[0];
    const projected = workspaceProposalForRole({
      ...base,
      responses: { "audience-outcome": "A concrete operating playbook.", "speaker-phone": "+1 415 555 0100" },
      customResponses: [
        { fieldId: "audience-outcome", label: "Audience outcome", type: "long_text", section: "proposal", value: "A concrete operating playbook." },
        { fieldId: "speaker-phone", label: "Mobile phone", type: "short_text", section: "participant", value: "+1 415 555 0100" },
      ],
    }, "reviewer", true);

    await act(async () => {
      root.render(<FormResponseList responses={projected.customResponses} />);
    });

    expect(container.textContent).toContain("Audience outcome");
    expect(container.textContent).toContain("A concrete operating playbook.");
    expect(container.textContent).not.toContain("Mobile phone");
    expect(container.textContent).not.toContain("+1 415 555 0100");
  });

  it("keeps a successful bounded AI evaluation visible when the demo overview is immutable", async () => {
    const workspace = createDemoWorkspace("user-organizer");
    const proposal = workspace.proposals[0];
    let overviewLoads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/review-plans")) return json({ plans: [{
        id: "round-a", eventId: workspace.event.id, name: "Initial Review", round: 1, status: "active",
        rubric: [{ id: "fit", label: "Program fit", type: "numeric", weight: 1, maxScore: 5 }],
        reviewerIds: [], submittedReviews: 0, updatedAt: "2026-08-09T00:00:00.000Z",
      }] });
      if (path.endsWith("/abstract-review") && (!init?.method || init.method === "GET")) {
        overviewLoads += 1;
        return json({ reviewers: [], assignments: [], aiEvaluations: [], results: [] });
      }
      if (path.includes(`/proposals/${proposal.id}/ai-evaluation`) && init?.method === "POST") return json({
        id: "ai-a", proposalId: proposal.id, roundId: "round-a", score: 4.2, effectiveScore: 4.2,
        rationale: `Submission evidence: ${proposal.title}.`, modelLabel: "Conference Ops bounded heuristic v1",
      }, 201);
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    }));

    await act(async () => {
      root.render(<AbstractReviewControl />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const run = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Run AI triage"));
    expect(run).toBeDefined();

    await act(async () => {
      run!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Conference Ops bounded heuristic v1");
    expect(container.textContent).toContain(`Submission evidence: ${proposal.title}.`);
    expect(container.textContent).toContain("Override AI signal");
    expect(overviewLoads).toBe(1);
  });
});
