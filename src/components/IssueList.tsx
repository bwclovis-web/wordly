import type { Issue } from "@/domain/issues";

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues">
      {issues.map((issue, i) => (
        <li key={i} className={`issue ${issue.severity}`}>
          <code>{issue.code}</code> {issue.message}
          {issue.path ? <span className="small"> (at {issue.path})</span> : null}
        </li>
      ))}
    </ul>
  );
}
