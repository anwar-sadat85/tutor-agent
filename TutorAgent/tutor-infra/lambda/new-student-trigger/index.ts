import type { DynamoDBStreamHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

const client = new BedrockAgentCoreClient({ region: process.env.AWS_REGION ?? 'us-west-2' });

// Set after `agentcore deploy` — the deployed agent's runtime ARN.
const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN;

export const handler: DynamoDBStreamHandler = async (event) => {
  if (!AGENT_RUNTIME_ARN) {
    throw new Error('AGENT_RUNTIME_ARN environment variable is not set');
  }

  for (const record of event.Records) {
    // Only react to new student enrollments, not updates (e.g. pass count changes)
    // or deletes — this Lambda's only job is "send the first worksheet."
    if (record.eventName !== 'INSERT') continue;

    const newImage = record.dynamodb?.NewImage;
    if (!newImage) continue;

    const studentId = newImage.studentId?.S;
    const email = newImage.email?.S;
    const yearLevel = newImage.yearLevel?.N;

    if (!studentId || !email) {
      console.error('Skipping record — missing studentId or email', { studentId, email });
      continue;
    }

    console.log(`New student enrolled: ${studentId} (${email}), year ${yearLevel}`);

    // AgentCore requires runtimeSessionId to be at least 33 characters.
    // A UUID (36 chars) safely satisfies this regardless of studentId length
    // or timestamp — string concatenation (e.g. `enroll-${studentId}-${Date.now()}`)
    // can land just under the limit depending on studentId length.
    const sessionId = `enroll-${randomUUID()}`;

    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: AGENT_RUNTIME_ARN,
      runtimeSessionId: sessionId,
      // Both required — without contentType the runtime returns 415, without
      // accept it returns 406. The deployed agent's server only supports
      // streaming (SSE) responses, confirmed earlier via direct curl testing.
      contentType: 'application/json',
      accept: 'text/event-stream',
      qualifier: 'DEFAULT',
      payload: new TextEncoder().encode(
        JSON.stringify({
          prompt:
            `A new student has enrolled. studentId=${studentId}, email=${email}, ` +
            `yearLevel=${yearLevel ?? 6}. Generate their first reading comprehension ` +
            `worksheet and send it to their email.`,
        })
      ),
    });

    try {
      const response = await client.send(command);
      // Consume the full streamed response — the agent's actual work
      // (generate → render → send) happens during this stream, so the
      // Lambda must wait for it to finish rather than returning as soon as
      // headers arrive.
      const textResponse = await response.response?.transformToString();
      console.log('AgentCore invocation succeeded', {
        studentId,
        statusCode: response.statusCode,
        response: textResponse,
      });
    } catch (err) {
      // Let this throw so the Lambda records a failure — DynamoDB Streams
      // will retry the batch (up to the event source mapping's configured
      // retry policy) rather than silently dropping a new enrollment.
      console.error('AgentCore invocation failed', { studentId, err });
      throw err;
    }
  }
};