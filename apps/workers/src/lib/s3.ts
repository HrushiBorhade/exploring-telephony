import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const S3_BUCKET = process.env.S3_BUCKET!;
const S3_REGION = process.env.S3_REGION || "ap-south-1";
const S3_ENDPOINT = process.env.S3_ENDPOINT;

const s3 = new S3Client({
  region: S3_REGION,
  ...(S3_ENDPOINT && {
    endpoint: S3_ENDPOINT,
    forcePathStyle: true,
  }),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

function getPublicBaseUrl(): string {
  if (process.env.S3_PUBLIC_URL) return process.env.S3_PUBLIC_URL;
  if (S3_ENDPOINT) return `${S3_ENDPOINT}/${S3_BUCKET}`;
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
}

/** Extract S3 key from any URL format (regional, global, path-style, virtual-hosted) */
function extractKeyFromUrl(url: string): string {
  const parsed = new URL(url);
  const path = decodeURIComponent(parsed.pathname);

  // Path-style: /{bucket}/{key} (R2, MinIO, or path-style AWS)
  if (path.startsWith(`/${S3_BUCKET}/`)) {
    return path.slice(`/${S3_BUCKET}/`.length);
  }
  // Virtual-hosted: /{key} (standard AWS)
  return path.slice(1);
}

export async function downloadFromS3(url: string): Promise<Buffer> {
  const key = extractKeyFromUrl(url);

  const { Body } = await s3.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  }));

  if (!Body) throw new Error(`S3 download returned empty body for key: ${key}`);
  return Buffer.from(await Body.transformToByteArray());
}

/** Delete all objects under a prefix (e.g., captures/{id}/participant-a/clips/) */
export async function deleteS3Prefix(prefix: string): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const keys = (list.Contents || []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: keys },
      }));
      deleted += keys.length;
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<string> {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return `${getPublicBaseUrl()}/${key}`;
}
