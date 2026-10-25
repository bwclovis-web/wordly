import type { ContentClass } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";

export function StatusBadge({ status }: { status: AuthorityStatus | string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export function ProtectionBadge({ isProtected }: { isProtected: boolean }) {
  return isProtected ? <span className="badge protected">protected</span> : null;
}

export function ContentClassBadge({ contentClass }: { contentClass: ContentClass }) {
  return contentClass === "manuscript" ? <span className="badge manuscript">manuscript</span> : null;
}

export function RevisionBadge({ revision }: { revision: number }) {
  return <span className="badge">rev {revision}</span>;
}
