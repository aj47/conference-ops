import { describe, expect, it } from "vitest";
import {
  agendaFavoritesStorageKey,
  loadAgendaFavorites,
  saveAgendaFavorites,
} from "../../src/client/agenda-favorites";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    value: (key: string) => values.get(key),
  };
}

describe("agenda favorites", () => {
  it("persists favorite IDs under an event-scoped key", () => {
    const storage = memoryStorage();
    const favorites = new Set(["session-opening", "session-closing"]);

    expect(saveAgendaFavorites("field notes/2027", favorites, storage)).toBe(true);
    expect(storage.value(agendaFavoritesStorageKey("field notes/2027"))).toBe(
      '["session-opening","session-closing"]',
    );
    expect([...loadAgendaFavorites("field notes/2027", storage)]).toEqual([...favorites]);
    expect(loadAgendaFavorites("another-event", storage).size).toBe(0);
  });

  it("falls back safely for missing, malformed, and partially invalid storage", () => {
    const key = agendaFavoritesStorageKey("field-notes");
    expect(loadAgendaFavorites("field-notes", undefined).size).toBe(0);
    expect(loadAgendaFavorites("field-notes", memoryStorage({ [key]: "not-json" })).size).toBe(0);
    expect([...loadAgendaFavorites("field-notes", memoryStorage({
      [key]: JSON.stringify(["session-a", 42, "", "x".repeat(513), "session-a"]),
    }))]).toEqual(["session-a"]);
  });

  it("keeps the in-memory interaction usable when storage throws", () => {
    const unavailable = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadAgendaFavorites("field-notes", unavailable).size).toBe(0);
    expect(saveAgendaFavorites("field-notes", new Set(["session-a"]), unavailable)).toBe(false);
  });
});
