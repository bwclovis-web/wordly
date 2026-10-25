import { getDb } from "@/server/db";
import { listWorkspacesWithProjects } from "@/server/services/projectService";
import { RestoreClient } from "./RestoreClient";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const workspaces = await listWorkspacesWithProjects(getDb());
  return (
    <>
      <h1>Backup &amp; restore</h1>
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Download a workspace backup</h2>
        <p className="small muted">
          A <code>wordly.workspace-backup</code> file contains every project, record, revision, provenance source,
          protection flag, canon status, applied change package (with its hash), audit entry, open review item, and
          imported source file in the workspace. Keep it outside the repository.
        </p>
        {workspaces.length === 0 ? <p className="muted">No workspaces.</p> : null}
        <ul>
          {workspaces.map((w) => (
            <li key={w.id}>
              <a href={`/backup/${w.id}`} download>
                {w.name}
              </a>{" "}
              <span className="muted small">
                {w.id} &middot; {w.projects.length} project{w.projects.length === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">
          For a full database snapshot as well (all workspaces plus the raw SQLite file), run <code>pnpm db:backup</code>.
        </p>
      </section>
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Restore a backup as a new workspace</h2>
        <p className="small muted">
          The backup is checked completely before anything is written. It is restored beside your existing work as a
          separate workspace with new IDs, in a single transaction. Existing workspaces are never modified. To restore
          with the original IDs into a separate database file, use <code>pnpm db:restore &lt;file&gt; --new-database
          &lt;path&gt;</code>.
        </p>
        <RestoreClient />
      </section>
    </>
  );
}
