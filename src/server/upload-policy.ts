export type UploadPurpose = "headshot" | "slides" | "supporting_document";

const allowedContentTypes: Record<UploadPurpose, ReadonlySet<string>> = {
  headshot: new Set(["image/jpeg", "image/png", "image/webp"]),
  slides: new Set([
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  supporting_document: new Set([
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
};

const fallbackExtensions: Record<UploadPurpose, ReadonlySet<string>> = {
  headshot: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  slides: new Set([".pdf", ".ppt", ".pptx"]),
  supporting_document: new Set([".pdf", ".txt", ".doc", ".docx"]),
};

export function uploadContentTypeAllowed(purpose: UploadPurpose, contentType: string, fileName: string) {
  const normalizedType = contentType.toLowerCase().split(";", 1)[0].trim();
  if (allowedContentTypes[purpose].has(normalizedType)) return true;
  if (normalizedType !== "application/octet-stream") return false;
  const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  return fallbackExtensions[purpose].has(extension);
}
