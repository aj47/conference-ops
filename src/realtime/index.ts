import { DurableObject } from "cloudflare:workers";
import type { RealtimeEvent } from "../shared/domain";

interface RealtimeBindings {
  EVENT_REALTIME: DurableObjectNamespace<EventRealtime>;
  REALTIME_TOKEN: string;
}

export class EventRealtime extends DurableObject {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return Response.json({ status: "ok", service: "conference-ops-realtime", durableObject: true });
    }
    if (request.method === "POST") {
      const event = (await request.json()) as RealtimeEvent;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          socket.close(1011, "Broadcast failed");
        }
      }
      return Response.json({ delivered: this.ctx.getWebSockets().length });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now(), eventId: url.pathname.split("/").filter(Boolean).at(-1) });
    server.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    if (message === "ping") socket.send("pong");
  }
}

export default {
  async fetch(request: Request, env: RealtimeBindings) {
    const url = new URL(request.url);
    const readiness = url.pathname === "/health";
    const eventId = readiness ? "__readiness__" : url.pathname.split("/").filter(Boolean).at(-1);
    if (!eventId) return new Response("Missing event id", { status: 400 });
    if (request.headers.get("authorization") !== `Bearer ${env.REALTIME_TOKEN}`) return new Response("Unauthorized", { status: 401 });
    const id = env.EVENT_REALTIME.idFromName(eventId);
    return env.EVENT_REALTIME.get(id).fetch(request);
  },
};
