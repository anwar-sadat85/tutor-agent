import type { DynamoDBStreamHandler } from 'aws-lambda';
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

    const sessionId = `enroll-${studentId}-${Date.now()}`;

    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: AGENT_RUNTIME_ARN,
      runtimeSessionId: sessionId,
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
      console.log('AgentCore invocation succeeded', {
        studentId,
        statusCode: response.statusCode,
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