import type { DiffPart, FieldDiff } from "@/changePackage/diff";

export function TextDiff({ parts, empty = "(no text)" }: { parts: DiffPart[]; empty?: string }) {
  if (parts.length === 0) return <div className="diff muted">{empty}</div>;
  return (
    <div className="diff">
      {parts.map((p, i) =>
        p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>,
      )}
    </div>
  );
}

function show(value: unknown) {
  return <code>{JSON.stringify(value)}</code>;
}

export function FieldDiffTable({ diffs }: { diffs: FieldDiff[] }) {
  if (diffs.length === 0) return null;
  return (
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {diffs.map((d) => (
          <tr key={d.key}>
            <td>
              <code>{d.key}</code> <span className="muted small">{d.change}</span>
            </td>
            <td>{d.change === "added" ? <span className="muted">-</span> : <del>{show(d.before)}</del>}</td>
            <td>{d.change === "removed" ? <span className="muted">-</span> : <ins>{show(d.after)}</ins>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
