export type ArtifactRecord = {
  contentType: string;
  createdAt: Date;
  executionId: string;
  id: string;
  name: string;
  path: string;
  size: number;
};

export type ArtifactReference = {
  artifactId: string;
  contentType: string;
  name: string;
  size: number;
  url: string;
};
