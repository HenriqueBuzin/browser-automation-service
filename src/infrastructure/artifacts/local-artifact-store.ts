import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ArtifactStore, StoredArtifact } from "../../ports/artifact-store.js";
import type { ArtifactRecord } from "../../domain/artifact.js";

export class LocalArtifactStore implements ArtifactStore {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = resolve(root);
  }

  public async open(artifact: ArtifactRecord): Promise<Buffer> {
    return readFile(this.#resolveSafe(artifact.path));
  }

  public async put(input: {
    content: Buffer;
    contentType: string;
    executionId: string;
    id: string;
    name: string;
    now: Date;
  }): Promise<StoredArtifact> {
    const relativePath = `${input.executionId}/${input.id}.png`;
    const absolutePath = this.#resolveSafe(relativePath);
    await mkdir(resolve(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, input.content, { flag: "wx" });
    return {
      absolutePath,
      contentType: input.contentType,
      createdAt: input.now,
      executionId: input.executionId,
      id: input.id,
      name: input.name,
      path: relativePath,
      size: input.content.byteLength,
    };
  }

  public async remove(artifact: ArtifactRecord): Promise<void> {
    await unlink(this.#resolveSafe(artifact.path)).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }

  #resolveSafe(relativePath: string): string {
    const target = resolve(this.#root, relativePath);
    if (target !== this.#root && !target.startsWith(`${this.#root}${sep}`)) {
      throw new Error("Artifact path escapes storage root");
    }
    return target;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
