import { describe, expect, it } from "vitest";
import { launchConfigurationForTemplate, launchTemplates } from "../../src/shared/launch-templates";
import { parseLaunchCsv } from "../../src/client/launch-import";

describe("guided event launch", () => {
  it("ships four complete, isolated starter configurations", () => {
    expect(launchTemplates.map((template) => template.id)).toEqual([
      "conference",
      "workshop",
      "internal_summit",
      "technical_multitrack",
    ]);
    const first = launchConfigurationForTemplate("technical_multitrack");
    first.tracks[0].name = "Changed";
    expect(launchConfigurationForTemplate("technical_multitrack").tracks[0].name).toBe("Build");
  });

  it("parses quoted room and track rows into bounded launch configuration", () => {
    const parsed = parseLaunchCsv(`type,name,capacity,color\ntrack,"AI systems",,#7564a8\nroom,"Main hall",320,`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.tracks).toEqual([{ name: "AI systems", color: "#7564a8" }]);
    expect(parsed.rooms).toEqual([{ name: "Main hall", capacity: 320 }]);
  });

  it("rejects unsafe or incomplete configuration without partially applying it", () => {
    const parsed = parseLaunchCsv("type,name,capacity,color\ntrack,Build,,red\nroom,Main,0,");
    expect(parsed.tracks).toEqual([]);
    expect(parsed.rooms).toEqual([]);
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("track color"),
      expect.stringContaining("room capacity"),
      "Add at least one track row.",
      "Add at least one room row.",
    ]));
  });
});
