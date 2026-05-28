import mammoth from "mammoth";
import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canCreateControlledDocuments } from "@/lib/roles";
import {
  extractTextFromHtml,
  hasMeaningfulRichText,
  plainTextToHtml,
  sanitizeRichHtml,
} from "@/lib/rich-text.server";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

function isWordDocument(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function isHtmlDocument(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".html") || name.endsWith(".htm") || file.type === "text/html";
}

function isPlainTextDocument(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    file.type.startsWith("text/")
  );
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canCreateControlledDocuments(requester.role)) {
    return NextResponse.json(
      { error: "You do not have permission to import controlled documents." },
      { status: 403 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A document file is required." }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "The selected file is empty." }, { status: 400 });
  }

  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: `File is too large. Maximum import size is ${MAX_IMPORT_BYTES / 1024 / 1024}MB.` },
      { status: 400 },
    );
  }

  if (!isWordDocument(file) && !isHtmlDocument(file) && !isPlainTextDocument(file)) {
    return NextResponse.json(
      { error: "Import supports .docx, .html, .htm, .txt, and .md files." },
      { status: 400 },
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    let rawHtml = "";
    let warnings: string[] = [];

    if (isWordDocument(file)) {
      const result = await mammoth.convertToHtml(
        { buffer: fileBuffer },
        {
          convertImage: mammoth.images.imgElement((image) =>
            image.read("base64").then((imageBuffer) => ({
              src: `data:${image.contentType};base64,${imageBuffer}`,
            })),
          ),
        },
      );
      rawHtml = result.value;
      warnings = result.messages
        .map((message) => message.message?.trim())
        .filter((message): message is string => Boolean(message));
    } else {
      const text = new TextDecoder("utf-8").decode(arrayBuffer);
      rawHtml = isHtmlDocument(file) ? text : plainTextToHtml(text);
    }

    const convertedHtml = sanitizeRichHtml(rawHtml).trim();
    const textLength = extractTextFromHtml(convertedHtml).length;

    if (!hasMeaningfulRichText(convertedHtml)) {
      return NextResponse.json(
        { error: "No readable document content could be extracted from that file." },
        { status: 422 },
      );
    }

    if (/<img\b[^>]*\bsrc=["']data:/i.test(convertedHtml)) {
      warnings.push("Embedded images were preserved inline; verify readability before approval.");
    }

    return NextResponse.json({
      convertedHtml,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      fileDataBase64: fileBuffer.toString("base64"),
      fileSha256: createHash("sha256").update(fileBuffer).digest("hex"),
      textLength,
      warnings: Array.from(new Set(warnings)).slice(0, 10),
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to import the selected document.",
      },
      { status: 500 },
    );
  }
}
