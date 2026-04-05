import crypto from "crypto";

const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY!;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY!;
const S3_BUCKET = process.env.S3_BUCKET!;
const S3_REGION = process.env.S3_REGION || "ap-south-1";
const S3_ENDPOINT = process.env.S3_ENDPOINT;

function getBaseUrl(): string {
  return S3_ENDPOINT || `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
}

function getObjectUrl(key: string): string {
  return S3_ENDPOINT
    ? `${S3_ENDPOINT}/${S3_BUCKET}/${key}`
    : `${getBaseUrl()}/${key}`;
}

export function getPublicUrl(key: string): string {
  const publicBase = process.env.S3_PUBLIC_URL || getBaseUrl();
  return `${publicBase}/${key}`;
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<string> {
  const url = getObjectUrl(key);
  const host = new URL(url).host;
  const dateStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const shortDate = dateStamp.slice(0, 8);
  const region = S3_REGION;

  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateStamp}`,
  ].join("\n") + "\n";

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalUri = S3_ENDPOINT ? `/${S3_BUCKET}/${key}` : `/${key}`;

  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateStamp,
    scope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = [region, "s3", "aws4_request"].reduce(
    (k, msg) => crypto.createHmac("sha256", k).update(msg).digest(),
    crypto.createHmac("sha256", `AWS4${S3_SECRET_KEY}`).update(shortDate).digest(),
  );

  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": dateStamp,
      Authorization: authorization,
    },
    body,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`S3 upload failed ${res.status}: ${errBody}`);
  }

  return getPublicUrl(key);
}
