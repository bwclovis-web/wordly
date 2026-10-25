import { ImportClient } from "./ImportClient";

export default async function ImportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <h1>Import change package</h1>
      <p className="muted small">
        Paste or upload a <code>wordly.change-package</code> JSON file. It is validated in full and previewed before
        anything changes. Applying is all-or-nothing, and a package ID can only be applied once.
      </p>
      <ImportClient projectId={projectId} />
    </>
  );
}
