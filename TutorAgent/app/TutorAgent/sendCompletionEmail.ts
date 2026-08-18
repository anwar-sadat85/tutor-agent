import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { NodeHttpHandler } from '@smithy/node-http-handler';

// Same timeout rationale as sendAssignmentEmail — don't let a stalled
// connection hang silently.
const sesClient = new SESClient({
  region: process.env.AWS_REGION ?? 'us-west-2',
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 10_000,
    requestTimeout: 20_000,
  }),
});

const SENDER_EMAIL = process.env.TUTOR_SENDER_EMAIL ?? 'tutor@anwar.nz';

export interface SendCompletionEmailOptions {
  studentEmail: string;
  passCount: number;
}

/**
 * Sends a congratulatory email once a student reaches the required number of
 * passes. No attachment needed, so this uses SES's simpler SendEmail API
 * rather than the MIME-building SendRawEmail path used for worksheets.
 */
export async function sendCompletionEmail(options: SendCompletionEmailOptions): Promise<void> {
  const { studentEmail, passCount } = options;

  console.log(`[sendCompletionEmail] Starting — to=${studentEmail} passCount=${passCount}`);

  try {
    const result = await sesClient.send(
      new SendEmailCommand({
        Source: SENDER_EMAIL,
        Destination: { ToAddresses: [studentEmail] },
        Message: {
          Subject: { Data: "You've completed the reading programme! 🎉" },
          Body: {
            Text: {
              Data:
                `Congratulations!\n\nYou've successfully passed ${passCount} reading ` +
                `comprehension worksheets and completed the programme.\n\n` +
                `Great work — that's it for now, no more worksheets will be sent. Well done!`,
            },
          },
        },
      })
    );
    console.log(`[sendCompletionEmail] SES accepted the message. MessageId=${result.MessageId}`);
  } catch (err) {
    console.error('[sendCompletionEmail] SES send failed:', err);
    throw err;
  }
}