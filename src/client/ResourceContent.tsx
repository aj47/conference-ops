import { ExternalLink } from "lucide-react";
import type { ResourcePage } from "../shared/domain";
import { safeResourceLinkUrl } from "./resource-pages";

export function ResourceContent({ resource }: { resource: ResourcePage }) {
  const paragraphs = (resource.body.trim() || resource.summary.trim())
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const linkUrl = safeResourceLinkUrl(resource.linkUrl);

  return (
    <div className="resource-content">
      <div className="resource-content__body">
        {paragraphs.map((paragraph, index) => <p key={`${resource.id}-${index}`}>{paragraph}</p>)}
        {!paragraphs.length && <p className="muted">The organizer has not added page content yet.</p>}
      </div>
      {linkUrl && (
        <a className="resource-content__link" href={linkUrl} target="_blank" rel="noreferrer">
          Open organizer reference <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}
