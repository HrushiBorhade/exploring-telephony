import { EncodedFileOutput, EncodedFileType, S3Upload } from "livekit-server-sdk";
import { env } from "../env";

const { S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION, S3_ENDPOINT } = env;

export function createS3Upload(): S3Upload {
  return new S3Upload({
    accessKey: S3_ACCESS_KEY!,
    secret: S3_SECRET_KEY!,
    bucket: S3_BUCKET!,
    region: S3_REGION || "auto",
    endpoint: S3_ENDPOINT || "",
    forcePathStyle: true,
  });
}

export function createS3FileOutput(captureId: string, suffix = "mixed"): EncodedFileOutput {
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `recordings/${captureId}-${suffix}.mp4`,
    output: { case: "s3", value: createS3Upload() },
  });
}
