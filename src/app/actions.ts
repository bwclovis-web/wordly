"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { createProject, createWorkspace } from "@/server/services/projectService";

export async function createWorkspaceAction(formData: FormData) {
  await createWorkspace(getDb(), { name: String(formData.get("name") ?? "") });
  revalidatePath("/");
}

export async function createProjectAction(formData: FormData) {
  const project = await createProject(getDb(), {
    workspaceId: String(formData.get("workspaceId") ?? ""),
    title: String(formData.get("title") ?? ""),
  });
  redirect(`/projects/${project.id}`);
}
