export type TaskUploadPurpose = "slides" | "supporting_document";

const slideContentTypes = new Set([
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function taskUploadPurpose(file: Pick<File, "name" | "type">): TaskUploadPurpose {
  const contentType = file.type.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  return slideContentTypes.has(contentType) || extension === ".ppt" || extension === ".pptx"
    ? "slides"
    : "supporting_document";
}
