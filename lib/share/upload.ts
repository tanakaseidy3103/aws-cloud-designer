/**
 * Pure validation for the diagram share upload (`POST /api/upload`).
 * Kept free of AWS SDK imports so it can be unit-tested without network access.
 */

/** Largest decoded PNG accepted (5 MiB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Largest request body accepted before JSON parsing (base64 overhead + filename). */
export const MAX_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096;
/** Presigned GET URL lifetime: default 1 hour, capped at the SigV4 maximum of 7 days. */
export const DEFAULT_URL_TTL_SECONDS = 3600;
export const MAX_URL_TTL_SECONDS = 7 * 24 * 3600;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface ShareConfig {
  bucket: string;
  region: string;
  urlTtlSeconds: number;
  /** Static keys only when both are set; otherwise the default AWS credential chain is used. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** Reads share settings from the environment. Returns null when the feature is not configured. */
export function readShareConfig(env: Record<string, string | undefined>): ShareConfig | null {
  const bucket = env.AWS_S3_BUCKET_NAME?.trim();
  if (!bucket) return null;
  const ttl = Number.parseInt(env.SHARE_URL_TTL_SECONDS ?? "", 10);
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  return {
    bucket,
    region: env.AWS_REGION?.trim() || "ap-northeast-1",
    urlTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, MAX_URL_TTL_SECONDS) : DEFAULT_URL_TTL_SECONDS,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  };
}

export type UploadValidation =
  | { ok: true; image: Buffer; filename: string }
  | { ok: false; status: 400 | 413 | 415; error: string };

export function sanitizeShareFilename(name: unknown): string {
  const clean = (typeof name === "string" ? name : "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return clean || "architecture";
}

/** Validates the parsed JSON body: a base64 PNG (optionally as a data URL) and a filename. */
export function validateUpload(body: unknown): UploadValidation {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "Request body must be a JSON object." };
  const { image, filename } = body as { image?: unknown; filename?: unknown };
  if (typeof image !== "string" || image.length === 0) return { ok: false, status: 400, error: "Missing required parameter: image" };

  let data = image;
  const dataUrl = /^data:([\w/+.-]+);base64,/.exec(image);
  if (dataUrl) {
    if (dataUrl[1] !== "image/png") return { ok: false, status: 415, error: "Only PNG images are accepted." };
    data = image.slice(dataUrl[0].length);
  }
  if (data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) return { ok: false, status: 413, error: "Image exceeds the 5 MB limit." };
  if (!BASE64.test(data)) return { ok: false, status: 400, error: "Image is not valid base64." };

  const buf = Buffer.from(data, "base64");
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: "Image exceeds the 5 MB limit." };
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { ok: false, status: 415, error: "Only PNG images are accepted." };
  }
  return { ok: true, image: buf, filename: sanitizeShareFilename(filename) };
}
