import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { env } from "../env";

const { S3_BUCKET, S3_REGION, S3_ENDPOINT } = env;

const s3 = new S3Client({
  region: S3_REGION,
  ...(S3_ENDPOINT && {
    endpoint: S3_ENDPOINT,
    forcePathStyle: true,
  }),
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

function getPublicBaseUrl(): string {
  if (env.S3_PUBLIC_URL) return env.S3_PUBLIC_URL;
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s timeout
  try {
    const { Body } = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }), { abortSignal: controller.signal });

    if (!Body) throw new Error(`S3 download returned empty body for key: ${key}`);
    return Buffer.from(await Body.transformToByteArray());
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Delete all objects under a prefix (e.g., captures/{id}/participant-a/clips/) */
export async function deleteS3Prefix(prefix: string): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s timeout
  try {
    do {
      const list = await s3.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }), { abortSignal: controller.signal });

      const keys = (list.Contents || []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: { Objects: keys },
        }), { abortSignal: controller.signal });
        deleted += keys.length;
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s timeout
  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }), { abortSignal: controller.signal });

    return `${getPublicBaseUrl()}/${key}`;
  } finally {
    clearTimeout(timeoutId);
  }
}
