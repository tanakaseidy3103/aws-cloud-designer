import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { image, filename } = body;

    if (!image) {
      return NextResponse.json(
        { error: "Missing required parameter: image" },
        { status: 400 }
      );
    }

    // Check environment configuration
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || "ap-northeast-1";
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!accessKeyId || !secretAccessKey || !bucketName) {
      return NextResponse.json(
        {
          error: "AWS S3 S3 integration is not fully configured on the server. Please define AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET_NAME.",
        },
        { status: 501 }
      );
    }

    // Initialize S3 client
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Clean data URL format (e.g., data:image/png;base64,iVBORw0K...)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Construct S3 asset key path
    const fileExtension = "png";
    const cleanFilename = (filename || "architecture")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-");
    const key = `diagrams/${uuidv4().slice(0, 8)}-${cleanFilename}.${fileExtension}`;

    // Put Object command
    const uploadCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: imageBuffer,
      ContentType: `image/${fileExtension}`,
    });

    await s3Client.send(uploadCommand);

    // Build the public object URL
    const s3Url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    return NextResponse.json({
      success: true,
      url: s3Url,
      key,
    });
  } catch (error: unknown) {
    console.error("S3 Upload error: ", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to upload diagram to cloud storage.", details: errorMessage },
      { status: 500 }
    );
  }
}
