import { NextResponse } from "next/server";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { MAX_BODY_BYTES, readShareConfig, validateUpload } from "@/lib/share/upload";

/**
 * Uploads a PNG snapshot of the diagram to the operator's S3 bucket and returns a
 * short-lived presigned GET URL, so the bucket can stay private.
 *
 * There is no user authentication in this app: do not expose this route on the
 * public internet with production credentials. Each upload is a billable S3 PUT.
 */
export async function POST(request: Request) {
  const config = readShareConfig(process.env);
  if (!config) {
    return NextResponse.json(
      { error: "Cloud share is not configured on this server. Set AWS_S3_BUCKET_NAME to enable it." },
      { status: 501 }
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body." }, { status: 400 });
  }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const upload = validateUpload(body);
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status });

  const key = `diagrams/${uuidv4().slice(0, 8)}-${upload.filename}.png`;
  try {
    // Without static keys the SDK uses the default credential chain (SSO, profile, role).
    const s3 = new S3Client({ region: config.region, credentials: config.credentials });
    await s3.send(
      new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: upload.image, ContentType: "image/png" })
    );
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
      expiresIn: config.urlTtlSeconds,
    });
    return NextResponse.json({ success: true, url, key, expiresIn: config.urlTtlSeconds });
  } catch (error: unknown) {
    // Internal AWS error details stay in the server log.
    console.error("S3 upload error:", error);
    return NextResponse.json({ error: "Failed to upload diagram to cloud storage." }, { status: 502 });
  }
}
