import { describe, expect, it } from "vitest";
import { parseSpeakerCsv, renderSpeakerTemplate } from "../../src/shared/speaker-content";
import { createStoredZip } from "../../src/server/store-zip";

describe("speaker content workflow primitives", () => {
  it("imports quoted CSV data and deduplicates case-insensitive email rows", () => {
    const speakers = parseSpeakerCsv(`Name,Email,Title,Company,Bio\n"Priya Raman",PRIYA@example.com,"Staff Engineer","Latticework, Inc.","First bio"\n"Priya Raman",priya@example.com,"Principal Engineer",Latticework,"Latest bio"\n"Dana Kowalski",dana@example.com,Founder,Flowstate,"Builds release systems"`);

    expect(speakers).toEqual([
      {
        name: "Priya Raman",
        email: "priya@example.com",
        title: "Principal Engineer",
        company: "Latticework",
        bio: "Latest bio",
      },
      {
        name: "Dana Kowalski",
        email: "dana@example.com",
        title: "Founder",
        company: "Flowstate",
        bio: "Builds release systems",
      },
    ]);
  });

  it("resolves personalized speaker, session, and portal merge fields", () => {
    expect(renderSpeakerTemplate(
      "Hi {{speaker.first_name}} — review {{session.title}} at {{speaker.portal_url}}.",
      { name: "Priya Raman", sessions: [{ id: "session-a", title: "Taming 40-Minute CI" }] },
      "https://conference.example/portal",
    )).toBe("Hi Priya — review Taming 40-Minute CI at https://conference.example/portal.");
  });

  it("builds a valid stored ZIP containing only the supplied latest-version paths", () => {
    const archive = createStoredZip([
      { name: "Taming CI/Priya/slides.pdf", data: new TextEncoder().encode("latest deck") },
      { name: "Agents Q&A/Marcus/notes.txt", data: new TextEncoder().encode("notes") },
    ]);
    const text = new TextDecoder().decode(archive);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(archive.byteLength - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(archive.byteLength - 12, true)).toBe(2);
    expect(text).toContain("Taming CI/Priya/slides.pdf");
    expect(text).toContain("Agents Q&A/Marcus/notes.txt");
    expect(text).toContain("latest deck");
  });
});
