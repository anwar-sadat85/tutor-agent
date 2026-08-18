import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { readFile } from 'fs/promises';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

// The AWS SDK v3 sets no request/connection timeout by default — an SES call
// that hangs (e.g. a stalled TCP connection) would otherwise wait
// indefinitely. Explicit timeouts turn a silent hang into a fast, visible
// failure instead.
const sesClient = new SESClient({
  region: process.env.AWS_REGION ?? 'us-west-2',
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 10_000,
    requestTimeout: 20_000,
  }),
});

const SENDER_EMAIL = process.env.TUTOR_SENDER_EMAIL ?? 'tutor@anwar.nz';

export interface SendAssignmentEmailOptions {
  studentEmail: string;
  worksheetTitle: string;
  pdfPath: string;
}

/**
 * Sends the worksheet PDF to the student via SES. Uses SendRawEmail (not the
 * simpler SendEmail) because attachments require a raw MIME message — SES's
 * plain SendEmail API has no attachment support.
 *
 * Takes a file path, not raw bytes/base64 — the PDF is read directly from
 * disk here rather than being passed as a tool-call argument the model would
 * otherwise have to generate token-by-token (which, for a PDF-sized base64
 * string, is slow enough to look like a hang).
 */
export async function sendAssignmentEmail(options: SendAssignmentEmailOptions): Promise<void> {
  const { studentEmail, worksheetTitle, pdfPath } = options;

  console.log(`[sendAssignmentEmail] Starting — to=${studentEmail} from=${SENDER_EMAIL} pdfPath=${pdfPath}`);

  const pdfBytes = await readFile(pdfPath);
  console.log(`[sendAssignmentEmail] Read ${pdfBytes.length} bytes from ${pdfPath}`);

  const mail = new MailComposer({
    from: SENDER_EMAIL,
    to: studentEmail,
    subject: `Your next reading assignment: ${worksheetTitle}`,
    text:
      `Hi!\n\nHere's your next reading comprehension worksheet: "${worksheetTitle}".\n\n` +
      `Please write your answers on a separate sheet of paper — start each answer with ` +
      `the question number — then photograph or scan your answers clearly and reply to ` +
      `this email with the photo attached.\n\nGood luck!`,
    attachments: [
      {
        filename: `${worksheetTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`,
        content: pdfBytes,
        contentType: 'application/pdf',
      },
    ],
  });

  console.log('[sendAssignmentEmail] Compiling MIME message...');
  const rawMessage: Buffer = await new Promise((resolve, reject) => {
    mail.compile().build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
  console.log(`[sendAssignmentEmail] MIME compiled — ${rawMessage.length} bytes. Calling SES...`);

  try {
    const result = await sesClient.send(
      new SendRawEmailCommand({
        RawMessage: { Data: rawMessage },
      })
    );
    console.log(`[sendAssignmentEmail] SES accepted the message. MessageId=${result.MessageId}`);
  } catch (err) {
    console.error('[sendAssignmentEmail] SES send failed:', err);
    throw err;
  }
}