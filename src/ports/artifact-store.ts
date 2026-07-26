import type { ArtifactRecord } from "../domain/artifact.js";

export type StoredArtifact = ArtifactRecord & { absolutePath: string };

export type ArtifactStore = {
  open: (artifact: ArtifactRecord) => Promise<Buffer>;
  put: (input: {
    content: Buffer;
    contentType: string;
    executionId: string;
    id: string;
    name: string;
    now: Date;
  }) => Promise<StoredArtifact>;
  remove: (artifact: ArtifactRecord) => Promise<void>;
};
