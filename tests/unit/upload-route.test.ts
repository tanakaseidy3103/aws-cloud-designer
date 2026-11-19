import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The AWS SDK is fully mocked: no network, no credentials, no S3 resources.
const send = vi.fn();
const clientOptions: unknown[] = [];
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(opts: unknown) {
      clientOptions.push(opts);
    }
    send = send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
const getSignedUrl = vi.fn(async () => "https://bucket.s3.amazonaws.com/diagrams/x.png?X-Amz-Signature=abc");
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));

const { POST } = await import("@/app/api/upload/route");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/upload", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
const pngBody = JSON.stringify({ image: `data:image/png;base64,${PNG.toString("base64")}`, filename: "Demo" });

const ENV_KEYS = ["AWS_S3_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "SHARE_URL_TTL_SECONDS"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  send.mockReset();
  getSignedUrl.mockClear();
  clientOptions.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("POST /api/upload", () => {
  it("returns 501 and never touches S3 when the bucket is not configured", async () => {
    const res = await POST(req(pngBody));
    expect(res.status).toBe(501);
    expect(send).not.toHaveBeenCalled();
  });

  it("uploads a PNG and returns a presigned URL, using the default credential chain", async () => {
    process.env.AWS_S3_BUCKET_NAME = "my-private-bucket";
    send.mockResolvedValue({});
    const res = await POST(req(pngBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toContain("X-Amz-Signature");
    expect(json.key).toMatch(/^diagrams\/[0-9a-f]{8}-demo\.png$/);
    expect(json.expiresIn).toBe(3600);
    expect(clientOptions[0]).toMatchObject({ region: "ap-northeast-1", credentials: undefined });
    const put = send.mock.calls[0][0] as { input: { Bucket: string; ContentType: string; Body: Buffer } };
    expect(put.input).toMatchObject({ Bucket: "my-private-bucket", ContentType: "image/png" });
    expect(put.input.Body.equals(PNG)).toBe(true);
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 3600 });
  });

  it.each([
    ["not json", 400],
    [JSON.stringify({ image: Buffer.from("GIF89a....").toString("base64") }), 415],
    [JSON.stringify({}), 400],
  ])("rejects %j with %i before calling S3", async (body, status) => {
    process.env.AWS_S3_BUCKET_NAME = "b";
    const res = await POST(req(body));
    expect(res.status).toBe(status);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies from the Content-Length header without reading them", async () => {
    process.env.AWS_S3_BUCKET_NAME = "b";
    const res = await POST(req(pngBody, { "content-length": String(50 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies even when Content-Length is missing or wrong", async () => {
    process.env.AWS_S3_BUCKET_NAME = "b";
    const res = await POST(req("x".repeat(8 * 1024 * 1024)));
    expect(res.status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not leak internal AWS error details to the client", async () => {
    process.env.AWS_S3_BUCKET_NAME = "b";
    send.mockRejectedValue(new Error("AccessDenied: arn:aws:iam::123456789012:user/deployer"));
    const res = await POST(req(pngBody));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("123456789012");
    expect(text).not.toContain("details");
  });
});
