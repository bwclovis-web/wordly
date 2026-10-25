import Link from "next/link";
import { getDb } from "@/server/db";
import { listWorkspacesWithProjects } from "@/server/services/projectService";
import { createProjectAction, createWorkspaceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const workspaces = await listWorkspacesWithProjects(getDb());

  return (
    <>
      <h1>Workspaces</h1>
      {workspaces.length === 0 ? (
        <p className="muted">
          No workspaces yet. Create one below, or run <code>pnpm db:seed</code> for a demo project.
        </p>
      ) : null}

      {workspaces.map((w) => (
        <section key={w.id} className="panel">
          <h2 style={{ marginTop: 0 }}>
            {w.name} <span className="muted small">{w.id}</span>
          </h2>
          {w.projects.length === 0 ? <p className="muted">No projects.</p> : null}
          <ul>
            {w.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`}>{p.title}</Link> <span className="muted small">{p.id}</span>
              </li>
            ))}
          </ul>
          <form action={createProjectAction} className="row">
            <input type="hidden" name="workspaceId" value={w.id} />
            <input type="text" name="title" placeholder="New project title" required />
            <button type="submit" className="secondary">
              Add project
            </button>
          </form>
        </section>
      ))}

      <section className="panel">
        <h3>New workspace</h3>
        <form action={createWorkspaceAction} className="row">
          <input type="text" name="name" placeholder="Workspace name" required />
          <button type="submit">Create workspace</button>
        </form>
      </section>
    </>
  );
}
