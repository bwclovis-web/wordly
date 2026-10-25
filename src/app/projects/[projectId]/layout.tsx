import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { findProject } from "@/server/services/projectService";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await findProject(getDb(), projectId);
  if (!project) notFound();
  const base = `/projects/${project.id}`;

  return (
    <>
      <nav className="subnav">
        <span className="title">
          {project.title} <span className="muted small">{project.workspace.name}</span>
        </span>
        <Link href={base}>Records</Link>
        <Link href={`${base}/import`}>Import change package</Link>
        <Link href={`${base}/export`}>Export context</Link>
        <Link href={`${base}/history`}>History &amp; review</Link>
      </nav>
      {children}
    </>
  );
}
