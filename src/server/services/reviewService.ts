import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";

export async function listReviewItems(db: DbOrTx, projectId: string, status: "open" | "resolved" | "all" = "open") {
  return db.reviewItem.findMany({
    where: { projectId, ...(status === "all" ? {} : { status }) },
    orderBy: { createdAt: "desc" },
    include: { record: { select: { id: true, title: true, type: true } } },
  });
}

export async function resolveReviewItem(db: Db, projectId: string, reviewItemId: string, actor = "author") {
  await db.$transaction(async (tx) => {
    const item = await tx.reviewItem.findFirst({ where: { id: reviewItemId, projectId } });
    if (!item) throw new NotFoundError(`Review item ${reviewItemId} not found`);
    if (item.status === "resolved") return;
    await tx.reviewItem.update({ where: { id: item.id }, data: { status: "resolved", resolvedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "review.resolve",
      actor,
      summary: `Resolved review item for ${item.recordId}`,
      details: { reviewItemId: item.id, recordId: item.recordId, packageId: item.packageId },
    });
  });
}
