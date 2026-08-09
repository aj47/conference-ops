/** Quotes an RFC-4180 cell and prevents spreadsheet formula execution. */
export function spreadsheetSafeCsvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  let markerIndex = 0;
  while (markerIndex < text.length && text.charCodeAt(markerIndex) <= 0x20) markerIndex += 1;
  const safeText = "=+-@".includes(text[markerIndex] ?? "") ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
