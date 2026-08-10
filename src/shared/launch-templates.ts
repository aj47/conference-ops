export type LaunchTemplateId = "conference" | "workshop" | "internal_summit" | "technical_multitrack";

export interface LaunchTrackInput {
  name: string;
  color: string;
}

export interface LaunchRoomInput {
  name: string;
  capacity: number;
}

export interface LaunchConfiguration {
  templateId: LaunchTemplateId;
  source: "template" | "csv" | "airtable";
  tracks: LaunchTrackInput[];
  rooms: LaunchRoomInput[];
}

export interface LaunchTemplate {
  id: LaunchTemplateId;
  name: string;
  eyebrow: string;
  description: string;
  bestFor: string;
  tracks: LaunchTrackInput[];
  rooms: LaunchRoomInput[];
  included: string[];
}

export const launchTemplates: LaunchTemplate[] = [
  {
    id: "conference",
    name: "Conference CFP",
    eyebrow: "The dependable default",
    description: "A complete call for speakers, weighted review, onboarding, schedule, and public program.",
    bestFor: "A curated one- or two-day conference",
    tracks: [{ name: "General", color: "#e05b3f" }],
    rooms: [{ name: "Main room", capacity: 150 }],
    included: ["CFP + confirmation", "Weighted review", "Travel, profile, slides + calendar tasks"],
  },
  {
    id: "workshop",
    name: "Workshop program",
    eyebrow: "Hands-on and capacity-aware",
    description: "A focused program with practical scoring, a lab room, and deliverable collection.",
    bestFor: "Training days, labs, and hands-on programs",
    tracks: [{ name: "Workshops", color: "#2d6a6c" }],
    rooms: [{ name: "Workshop lab", capacity: 60 }],
    included: ["Workshop-first formats", "Evidence-based review", "Materials and capacity workflow"],
  },
  {
    id: "internal_summit",
    name: "Internal summit",
    eyebrow: "Fast, private, practical",
    description: "A lightweight company program for team proposals, peer review, and a shareable run of show.",
    bestFor: "Company offsites and internal knowledge exchanges",
    tracks: [
      { name: "Build", color: "#7564a8" },
      { name: "Operate", color: "#2d6a6c" },
    ],
    rooms: [{ name: "Summit room", capacity: 120 }],
    included: ["Two program lanes", "Peer review", "Speaker-ready action plan"],
  },
  {
    id: "technical_multitrack",
    name: "Multi-track technical",
    eyebrow: "Routing built in",
    description: "A three-lane technical conference with track-specific committees, rooms, and scheduling.",
    bestFor: "Programs with specialist reviewers and parallel rooms",
    tracks: [
      { name: "Build", color: "#e05b3f" },
      { name: "Evaluate", color: "#7564a8" },
      { name: "Operate", color: "#2d6a6c" },
    ],
    rooms: [
      { name: "Main stage", capacity: 300 },
      { name: "Studio A", capacity: 120 },
      { name: "Studio B", capacity: 90 },
    ],
    included: ["Multi-select track intake", "Track-specific reviewer groups", "Parallel-room schedule"],
  },
];

export function launchTemplate(id: LaunchTemplateId | undefined) {
  return launchTemplates.find((template) => template.id === id) ?? launchTemplates[0];
}

export function launchConfigurationForTemplate(
  id: LaunchTemplateId,
  source: LaunchConfiguration["source"] = "template",
): LaunchConfiguration {
  const template = launchTemplate(id);
  return {
    templateId: template.id,
    source,
    tracks: template.tracks.map((track) => ({ ...track })),
    rooms: template.rooms.map((room) => ({ ...room })),
  };
}
