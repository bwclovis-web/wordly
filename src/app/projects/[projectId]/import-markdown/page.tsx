import { MarkdownImportClient } from "./MarkdownImportClient";

export default async function ImportMarkdownPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <h1>Import Markdown references</h1>
      <p className="muted small">
        Select one or more <code>.md</code> files. Nothing is written until you review the preview and choose, for every
        file, its document type, canon status, and protection. Nothing is inferred from filenames. Imports create
        reference documents only, never manuscript chapters. Each file&apos;s original name and exact content are kept
        with its provenance, and the whole batch is applied together or not at all.
      </p>
      <MarkdownImportClient projectId={projectId} />
    </>
  );
}
