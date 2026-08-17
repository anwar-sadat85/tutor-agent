import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda';

// Set these before deploying. For a POC, SES starts in "sandbox" mode —
// both the sender AND recipient addresses must be verified identities
// until you request production access.
const SENDER_EMAIL = process.env.TUTOR_SENDER_EMAIL ?? 'tutor@example.com';
const STUDENT_EMAIL = process.env.TUTOR_STUDENT_EMAIL ?? 'student@example.com';

export class TutorInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---- SES: verify sender and (while in sandbox) recipient identities ----
    new ses.EmailIdentity(this, 'SenderIdentity', {
      identity: ses.Identity.email(SENDER_EMAIL),
    });
    new ses.EmailIdentity(this, 'StudentIdentity', {
      identity: ses.Identity.email(STUDENT_EMAIL),
    });
    // Note: CDK/CloudFormation can create the identity and trigger the
    // verification email, but actually clicking the verification link is a
    // manual step — check the inbox for both addresses after first deploy.

    // ---- DynamoDB: student state, with Streams enabled for enrollment ----
    const studentsTable = new dynamodb.Table(this, 'TutorStudents', {
      tableName: 'TutorStudents',
      partitionKey: { name: 'studentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      // RETAIN in production; DESTROY is convenient for a POC you'll tear down/rebuild often.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---- New Student Trigger Lambda ----
    // Fires on INSERT events from the stream, invokes the deployed AgentCore
    // agent to generate and send the student's first worksheet.
    const newStudentTrigger = new lambda.NodejsFunction(this, 'NewStudentTrigger', {
      functionName: 'tutor-new-student-trigger',
      runtime: Runtime.NODEJS_22_X,
      entry: 'lambda/new-student-trigger/index.ts',
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        // Set this after `agentcore deploy` gives you the runtime ARN.
        // Left blank here deliberately — filled in via GitHub Actions or
        // manually after the agent's first deployment.
        AGENT_RUNTIME_ARN: process.env.AGENT_RUNTIME_ARN ?? '',
      },
    });

    // Subscribe the Lambda to the DynamoDB Stream — batch size 1 keeps this
    // simple for a POC (one enrollment triggers one invocation, no batching
    // logic to reason about).
    newStudentTrigger.addEventSource(
      new lambdaEventSources.DynamoEventSource(studentsTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 1,
        retryAttempts: 3,
      })
    );

    // Permission to invoke the deployed AgentCore agent
    newStudentTrigger.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: ['*'], // narrow to the specific agent runtime ARN once known
      })
    );

    // ---- Outputs ----
    new cdk.CfnOutput(this, 'StudentsTableName', { value: studentsTable.tableName });
    new cdk.CfnOutput(this, 'StudentsTableStreamArn', {
      value: studentsTable.tableStreamArn ?? 'none',
    });
    new cdk.CfnOutput(this, 'NewStudentTriggerFunctionName', {
      value: newStudentTrigger.functionName,
    });
    new cdk.CfnOutput(this, 'SenderEmail', { value: SENDER_EMAIL });
  }
}