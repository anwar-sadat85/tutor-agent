import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { writeFile } from 'fs/promises';
import { simpleParser } from 'mailparser';

const IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/heic']);

/**
 * Fetches the raw MIME email SES stored in S3 (SES writes the entire raw
 * email — headers, body, attachments — as a single object; it does not
 * extract attachments itself), parses it, and writes each image attachment
 * found to local disk.
 *
 * Returns local file paths, not image content — matching the same pattern
 * established for render_worksheet_pdf/send_assignment_email, since passing
 * image bytes as a tool-call argument the model must generate would cause
 * the same multi-minute token-generation hang discovered earlier.
 */
export async function getSubmissionImage(options: {
  bucket: string;
  key: string;
  region: string;
}): Promise<{ imagePaths: string[] }> {
  const { bucket, key, region } = options;

  const s3Client = new S3Client({ region });

  const raw = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const rawBody = await raw.Body?.transformToByteArray();
  if (!rawBody) {
    throw new Error(`Could not read raw email body from s3://${bucket}/${key}`);
  }

  const parsed = await simpleParser(Buffer.from(rawBody));

  const imageAttachments = parsed.attachments.filter((a) =>
    IMAGE_CONTENT_TYPES.has(a.contentType.toLowerCase())
  );

  if (imageAttachments.length === 0) {
    throw new Error(
      `No image attachment found in the email at s3://${bucket}/${key}. ` +
        `Found ${parsed.attachments.length} attachment(s) with content types: ` +
        `${parsed.attachments.map((a) => a.contentType).join(', ') || '(none)'}.`
    );
  }

  const imagePaths: string[] = [];
  for (let i = 0; i < imageAttachments.length; i++) {
    const attachment = imageAttachments[i];
    const extension = attachment.contentType.toLowerCase().includes('png') ? 'png' : 'jpg';
    const path = `/tmp/submission-${Date.now()}-${i}.${extension}`;
    await writeFile(path, attachment.content);
    imagePaths.push(path);
  }

  return { imagePaths };
}