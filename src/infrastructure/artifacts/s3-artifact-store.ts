import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ArtifactRecord } from "../../domain/artifact.js";
import type { ArtifactStore, StoredArtifact } from "../../ports/artifact-store.js";

export class S3ArtifactStore implements ArtifactStore {
  readonly #client: S3Client;

  public constructor(
    private readonly bucket: string,
    options: { endpoint?: string; forcePathStyle?: boolean; region?: string } = {},
    client?: S3Client,
  ) {
    this.#client =
      client ??
      new S3Client({
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
        ...(options.region ? { region: options.region } : {}),
      });
  }

  public async open(artifact: ArtifactRecord): Promise<Buffer> {
    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: artifact.path }),
    );
    if (!response.Body) throw new Error(`Artifact '${artifact.id}' has no content`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  public async put(input: {
    content: Buffer;
    contentType: string;
    executionId: string;
    id: string;
    name: string;
    now: Date;
  }): Promise<StoredArtifact> {
    const path = `${input.executionId}/${input.id}.png`;
    await this.#client.send(
      new PutObjectCommand({
        Body: input.content,
        Bucket: this.bucket,
        ContentType: input.contentType,
        Key: path,
      }),
    );
    return {
      contentType: input.contentType,
      createdAt: input.now,
      executionId: input.executionId,
      id: input.id,
      name: input.name,
      path,
      size: input.content.byteLength,
    };
  }

  public async remove(artifact: ArtifactRecord): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: artifact.path }));
  }
}
