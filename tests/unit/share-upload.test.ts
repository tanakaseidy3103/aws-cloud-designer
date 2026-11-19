import { describe, expect, it } from "vitest";
import {
  DEFAULT_URL_TTL_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_URL_TTL_SECONDS,
  readShareConfig,
  sanitizeShareFilename,
  validateUpload,
} from "@/lib/share/upload";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const pngDataUrl = (buf = PNG) => `data:image/png;base64,${buf.toString("base64")}`;

describe("validateUpload", () => {
  it("accepts a PNG data URL and a bare base64 PNG", () => {
    for (const image of [pngDataUrl(), PNG.toString("base64")]) {
      const r = validateUpload({ image, filename: "My Arch" });
      expect(r).toMatchObject({ ok: true, filename: "my-arch" });
      if (r.ok) expect(r.image.equals(PNG)).toBe(true);
    }
  });

  it.each([
    [null, 400],
    ["text", 400],
    [{}, 400],
    [{ image: 42 }, 400],
    [{ image: "" }, 400],
    [{ image: "data:image/png;base64,@@@" }, 400],
  ])("rejects malformed body %j with %i", (body, status) => {
    expect(validateUpload(body)).toMatchObject({ ok: false, status });
  });

  it("rejects non-PNG content even when labelled as PNG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    expect(validateUpload({ image: pngDataUrl(jpeg) })).toMatchObject({ ok: false, status: 415 });
    expect(validateUpload({ image: Buffer.from("<html>").toString("base64") })).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects other declared media types", () => {
    expect(validateUpload({ image: `data:text/html;base64,${PNG.toString("base64")}` })).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects images over the size limit", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(validateUpload({ image: pngDataUrl(big) })).toMatchObject({ ok: false, status: 413 });
  });

  it("accepts an image exactly at the limit", () => {
    const exact = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES - PNG.length)]);
    expect(validateUpload({ image: pngDataUrl(exact) }).ok).toBe(true);
  });
});

describe("sanitizeShareFilename", () => {
  it.each([
    ["../../etc/passwd", "etc-passwd"],
    ["Prod  Stack!!", "prod-stack"],
    ["", "architecture"],
    [undefined, "architecture"],
    ["---", "architecture"],
    ["x".repeat(200), "x".repeat(64)],
  ])("%j → %s", (input, expected) => {
    expect(sanitizeShareFilename(input)).toBe(expected);
  });
});

describe("readShareConfig", () => {
  it("is disabled without a bucket", () => {
    expect(readShareConfig({})).toBeNull();
    expect(readShareConfig({ AWS_S3_BUCKET_NAME: "  " })).toBeNull();
  });

  it("uses the default credential chain unless both static keys are set", () => {
    expect(readShareConfig({ AWS_S3_BUCKET_NAME: "b" })?.credentials).toBeUndefined();
    expect(readShareConfig({ AWS_S3_BUCKET_NAME: "b", AWS_ACCESS_KEY_ID: "AKIA" })?.credentials).toBeUndefined();
    expect(readShareConfig({ AWS_S3_BUCKET_NAME: "b", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "s" })?.credentials).toEqual({
      accessKeyId: "a",
      secretAccessKey: "s",
    });
  });

  it("defaults and caps the presigned URL lifetime", () => {
    expect(readShareConfig({ AWS_S3_BUCKET_NAME: "b" })).toMatchObject({ region: "ap-northeast-1", urlTtlSeconds: DEFAULT_URL_TTL_SECONDS });
    expect(readShareConfig({ AWS_S3_BUCKET_NAME: "b", SHARE_URL_TTL_SECONDS: "999999999" })?.urlTtlSeconds).toBe(MAX_URL_TTL_SECONDS);
    expect(readShareConfig({ AWS_S3_BUCKET_NAME: "b", SHARE_URL_TTL_SECONDS: "-5" })?.urlTtlSeconds).toBe(DEFAULT_URL_TTL_SECONDS);
  });
});
