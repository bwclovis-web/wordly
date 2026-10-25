import { newId } from "@/domain/ids";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";

export async function createWorkspace(db: Db, input: { name: string; id?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("Workspace name is required");
  return db.workspace.create({ data: { id: input.id ?? newId("wsp"), name } });
}

export async function createProject(
  db: Db,
  input: { workspaceId: string; title: string; id?: string; actor?: string },
) {
  const title = input.title.trim();
  if (!title) throw new Error("Project title is required");
  return db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new NotFoundError(`Workspace ${input.workspaceId} not found`);
    const project = await tx.project.create({
      data: { id: input.id ?? newId("prj"), workspaceId: workspace.id, title },
    });
    await writeAudit(tx, {
      projectId: project.id,
      action: "project.create",
      actor: input.actor ?? "author",
      summary: `Created project "${title}"`,
      details: { projectId: project.id, workspaceId: workspace.id },
    });
    return project;
  });
}

export async function listWorkspacesWithProjects(db: DbOrTx) {
  return db.workspace.findMany({
    orderBy: { createdAt: "asc" },
    include: { projects: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getProject(db: DbOrTx, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { workspace: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  return project;
}

export async function findProject(db: DbOrTx, projectId: string) {
  return db.project.findUnique({ where: { id: projectId }, include: { workspace: true } });
}
