import { getDb } from "@/server/db";
import { createWorkspaceBackup } from "@/server/services/backupService";
import { NotFoundError } from "@/server/services/errors";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  try {
    const backup = await createWorkspaceBackup(getDb(), workspaceId);
    const stamp = backup.createdAt.replace(/[:.]/g, "-");
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${workspaceId}-${stamp}.wordly-backup.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Workspace not found", { status: 404 });
    throw error;
  }
}
