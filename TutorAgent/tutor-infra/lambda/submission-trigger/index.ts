import type { SESEvent } from 'aws-lambda';
import { randomUUID } from 'crypto';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'us-west-2';
const agentCoreClient = new BedrockAgentCoreClient({ region });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN;
const STUDENTS_TABLE_NAME = process.env.STUDENTS_TABLE_NAME ?? 'TutorStudents';
const EMAIL_INDEX_NAME = process.env.EMAIL_INDEX_NAME ?? 'EmailIndex';
const INBOUND_BUCKET_NAME = process.env.INBOUND_BUCKET_NAME;

/**
 * Extracts a bare email address from a "From" header, which may be in
 * "Display Name <address@domain>" form or a bare address.
 */
function extractEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).trim().toLowerCase();
}

async function findStudentIdByEmail(email: string): Promise<string | undefined> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: STUDENTS_TABLE_NAME,
      IndexName: EMAIL_INDEX_NAME,
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    })
  );
  const item = result.Items?.[0];
  return item?.studentId as string | undefined;
}

export const handler = async (event: SESEvent): Promise<void> => {
  if (!AGENT_RUNTIME_ARN) {
    throw new Error('AGENT_RUNTIME_ARN environment variable is not set');
  }
  if (!INBOUND_BUCKET_NAME) {
    throw new Error('INBOUND_BUCKET_NAME environment variable is not set');
  }

  for (const record of event.Records) {
    const mail = record.ses.mail;
    const messageId = mail.messageId;
    const fromHeader = mail.commonHeaders.from?.[0];

    if (!fromHeader) {
      console.error('Skipping record — no From header found', { messageId });
      continue;
    }

    const senderEmail = extractEmailAddress(fromHeader);
    console.log(`Inbound email received from ${senderEmail} (messageId=${messageId})`);

    const studentId = await findStudentIdByEmail(senderEmail);
    if (!studentId) {
      console.error('Skipping record — no student found for sender email', {
        senderEmail,
        messageId,
      });
      continue;
    }

    // The S3 action stores the raw email under objectKeyPrefix + messageId,
    // per the receipt rule's S3 action configuration in the CDK stack.
    const s3Key = `incoming/${messageId}`;
    const sessionId = `submission-${randomUUID()}`;

    console.log(`Grading submission for studentId=${studentId}, s3Key=${s3Key}`);

    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: AGENT_RUNTIME_ARN,
      runtimeSessionId: sessionId,
      contentType: 'application/json',
      accept: 'text/event-stream',
      qualifier: 'DEFAULT',
      payload: new TextEncoder().encode(
        JSON.stringify({
          prompt:
            `A student has submitted a photographed answer sheet by email. ` +
            `studentId=${studentId}. The raw email (including the photo attachment) is ` +
            `stored in S3 at bucket=${INBOUND_BUCKET_NAME}, key=${s3Key}. ` +
            `Extract the submission image and grade it.`,
        })
      ),
    });

    try {
      const response = await agentCoreClient.send(command);
      const textResponse = await response.response?.transformToString();
      console.log('AgentCore invocation succeeded', {
        studentId,
        statusCode: response.statusCode,
        response: textResponse,
      });
    } catch (err) {
      console.error('AgentCore invocation failed', { studentId, err });
      throw err;
    }
  }
};