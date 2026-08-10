import type { LaunchRoomInput, LaunchTrackInput } from "../shared/launch-templates";

export interface LaunchCsvResult {
  tracks: LaunchTrackInput[];
  rooms: LaunchRoomInput[];
  errors: string[];
}

const colorPattern = /^#[0-9a-f]{6}$/i;

function cells(line: string) {
  const output: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      output.push(value.trim());
      value = "";
    } else value += character;
  }
  output.push(value.trim());
  return output;
}

export function parseLaunchCsv(input: string): LaunchCsvResult {
  const result: LaunchCsvResult = { tracks: [], rooms: [], errors: [] };
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { ...result, errors: ["The CSV is empty."] };
  const header = cells(lines[0]).map((value) => value.toLowerCase());
  const typeIndex = header.indexOf("type");
  const nameIndex = header.indexOf("name");
  const capacityIndex = header.indexOf("capacity");
  const colorIndex = header.indexOf("color");
  if (typeIndex < 0 || nameIndex < 0) {
    return { ...result, errors: ["Use a header row with type,name and optional capacity,color columns."] };
  }

  for (const [offset, line] of lines.slice(1, 26).entries()) {
    const rowNumber = offset + 2;
    const row = cells(line);
    const type = row[typeIndex]?.toLowerCase();
    const name = row[nameIndex]?.trim();
    if (!name || name.length > 100) {
      result.errors.push(`Row ${rowNumber}: enter a name up to 100 characters.`);
      continue;
    }
    if (type === "track") {
      if (name.includes(",")) {
        result.errors.push(`Row ${rowNumber}: track names cannot contain commas because track routing uses comma-separated selections.`);
        continue;
      }
      const color = row[colorIndex] || "#2d6a6c";
      if (!colorPattern.test(color)) {
        result.errors.push(`Row ${rowNumber}: track color must look like #2d6a6c.`);
        continue;
      }
      result.tracks.push({ name, color: color.toLowerCase() });
    } else if (type === "room") {
      const capacity = Number(row[capacityIndex] || 100);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000) {
        result.errors.push(`Row ${rowNumber}: room capacity must be a whole number from 1 to 100000.`);
        continue;
      }
      result.rooms.push({ name, capacity });
    } else result.errors.push(`Row ${rowNumber}: type must be track or room.`);
  }

  if (!result.tracks.length) result.errors.push("Add at least one track row.");
  if (!result.rooms.length) result.errors.push("Add at least one room row.");
  if (result.tracks.length > 12) result.errors.push("Use at most 12 tracks for initial setup.");
  if (result.rooms.length > 20) result.errors.push("Use at most 20 rooms for initial setup.");
  return result;
}

export const launchCsvExample = `type,name,capacity,color
track,Build,,#e05b3f
track,Operate,,#2d6a6c
room,Main stage,300,
room,Studio A,120,`;
