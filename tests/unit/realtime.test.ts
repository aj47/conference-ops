import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

import { EventRealtime } from "../../src/realtime";

describe("EventRealtime WebSocket lifecycle", () => {
  it("acknowledges a client close with the same code and reason", () => {
    const close = vi.fn();
    const socket = { close } as unknown as WebSocket;

    EventRealtime.prototype.webSocketClose(socket, 1000, "Done");

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(1000, "Done");
  });

  it("closes an errored socket with an internal-error status", () => {
    const close = vi.fn();
    const socket = { close } as unknown as WebSocket;

    EventRealtime.prototype.webSocketError(socket);

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(1011, "WebSocket error");
  });

  it("does not rethrow when an errored socket is already closed", () => {
    const socket = {
      close: vi.fn(() => {
        throw new Error("Already closed");
      }),
    } as unknown as WebSocket;

    expect(() => EventRealtime.prototype.webSocketError(socket)).not.toThrow();
  });
});
