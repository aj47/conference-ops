import { describe, expect, it } from "vitest";
import type { EventRecord, ProgramSession, SpeakerProfile } from "../../src/shared/domain";
import {
  filterPublicSessions,
  personalScheduleIcs,
  publicSessionViews,
  publicWidgetConfigFromSearch,
  publicWidgetEmbedPath,
  publicWidgetOutput,
  sortPublicSpeakers,
} from "../../src/client/public-widget-model";
import { filterPublicWidgetExport, publicWidgetIcal, publicWidgetXml } from "../../src/server/public-widget-export";

const speakers: Array<Omit<SpeakerProfile, "email">> = [
  { id: "speaker-z", name: "Zoe Adams", title: "CTO", company: "Aperture", bio: "Builds systems.", profileComplete: true },
  { id: "speaker-a", name: "Ada Rivera", title: "Staff Engineer", company: "Northstar", bio: "Operates systems.", profileComplete: true },
];

const sessions: ProgramSession[] = [
  { id: "session-a", eventId: "event-a", title: "Operational evals", description: "A field report.", format: "talk", speakerIds: ["speaker-a"], speakerNames: ["Ada Rivera"], trackId: "track-a", roomId: "room-a", startsAt: "2027-05-12T16:00:00.000Z", endsAt: "2027-05-12T16:30:00.000Z", status: "published" },
  { id: "session-b", eventId: "event-a", title: "Designing compilers", description: "A workshop.", format: "workshop", speakerIds: ["speaker-z"], speakerNames: ["Zoe Adams"], trackId: "track-b", roomId: "room-b", startsAt: "2027-05-12T17:00:00.000Z", endsAt: "2027-05-12T18:00:00.000Z", status: "published" },
];

const event: EventRecord = {
  id: "event-a", slug: "devflow-2027", name: "DevFlow Conf 2027", shortName: "DEVFLOW", description: "", timezone: "America/Los_Angeles",
  startsAt: "2027-05-12T16:00:00.000Z", endsAt: "2027-05-14T23:00:00.000Z", cfpClosesAt: "2027-04-01T00:00:00.000Z", venue: "Fort Mason", websiteUrl: "", accent: "#123456", status: "agenda_published",
};

describe("public widget canonical model", () => {
  const views = publicSessionViews(
    sessions,
    [{ id: "track-a", name: "Platform", color: "#123456" }, { id: "track-b", name: "Developer tools", color: "#654321" }],
    [{ id: "room-a", name: "Hall A", capacity: 300 }, { id: "room-b", name: "Lab B", capacity: 80 }],
    speakers,
  );

  it("sorts speakers by surname and resolves complete session anatomy", () => {
    expect(sortPublicSpeakers(speakers).map((speaker) => speaker.name)).toEqual(["Zoe Adams", "Ada Rivera"]);
    expect(views[0]).toMatchObject({
      session: { title: "Operational evals" },
      track: { name: "Platform" },
      room: { name: "Hall A" },
      speakers: [{ name: "Ada Rivera", title: "Staff Engineer", company: "Northstar" }],
      formatLabel: "Talk",
    });
  });

  it("searches title and speaker identity and combines all three facets", () => {
    expect(filterPublicSessions(views, { query: "operational" }).map((view) => view.session.id)).toEqual(["session-a"]);
    expect(filterPublicSessions(views, { query: "adams" }).map((view) => view.session.id)).toEqual(["session-b"]);
    expect(filterPublicSessions(views, { trackId: "track-b", sessionFormat: "workshop", roomId: "room-b" }).map((view) => view.session.id)).toEqual(["session-b"]);
    expect(filterPublicSessions(views, { trackId: "track-b", roomId: "room-a" })).toEqual([]);
  });

  it("round-trips safe branding, filters, fields, and embed output", () => {
    const config = publicWidgetConfigFromSearch("?theme=dark&accent=%23123456&track=track-a&sessionFormat=talk&room=room-a&fields=time,room", "sessions");
    expect(config).toMatchObject({ theme: "dark", accent: "#123456", trackId: "track-a", sessionFormat: "talk", roomId: "room-a", fields: ["time", "room"] });
    expect(publicWidgetEmbedPath("field notes/2027", config)).toContain("/events/field%20notes%2F2027/embed/sessions?");
    expect(publicWidgetOutput("https://events.example.com", "devflow-2027", "DevFlow Conf", config)).toContain("<iframe");
    expect(publicWidgetOutput("https://events.example.com", "devflow-2027", "DevFlow Conf", { ...config, format: "basic_html" })).toContain("plain=1");
    expect(publicWidgetConfigFromSearch("?accent=red", "agenda").accent).toBe("#b44932");
  });

  it("exports a persistent personal schedule as valid calendar events", () => {
    const ics = personalScheduleIcs(event.name, views);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("SUMMARY:Operational evals");
    expect(ics).toContain("LOCATION:Hall A");
  });
});

describe("public widget feed formats", () => {
  const payload = {
    event,
    sessions: sessions.map((session, index) => ({ ...session, trackName: index ? "Developer tools" : "Platform", roomName: index ? "Lab B" : "Hall A" })),
    speakers,
  };

  it("filters canonical feeds and escapes XML values", () => {
    const filtered = filterPublicWidgetExport(payload, { trackId: "track-a", sessionFormat: "talk", roomId: "room-a" });
    expect(filtered.sessions.map((session) => session.id)).toEqual(["session-a"]);
    expect(filtered.speakers.map((speaker) => speaker.id)).toEqual(["speaker-a"]);
    expect(publicWidgetXml({ ...filtered, sessions: [{ ...filtered.sessions[0], title: "Evals & <agents>" }] })).toContain("Evals &amp; &lt;agents&gt;");
  });

  it("generates iCal with every selected session and location", () => {
    const ics = publicWidgetIcal(payload);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("X-WR-CALNAME:DevFlow Conf 2027");
    expect(ics).toContain("LOCATION:Lab B");
  });
});
