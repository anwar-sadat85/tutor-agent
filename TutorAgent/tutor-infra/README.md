# tutor-infra

CDK stack providing the **automatic enrollment trigger** for Tutor: a DynamoDB table
(with Streams enabled) holding student state, and a Lambda that fires on new student
enrollment, invoking the deployed `TutorAgent` AgentCore Runtime to generate and send
that student's first worksheet.

This is a separate CDK app from `TutorAgent/` (the AgentCore agent itself) and is
deployed independently — `TutorAgent` must already be deployed first, since this stack
needs its Runtime ARN.

## Project Structure

```
tutor-infra/
├── bin/tutor-infra.ts          # CDK app entry point
├── lib/tutor-infra-stack.ts    # DynamoDB table, Lambda, event source mapping, IAM
└── lambda/new-student-trigger/
    └── index.ts                 # The actual trigger Lambda handler
```

Note: this project is nested inside `TutorAgent/` on disk
(`TutorAgent/tutor-infra/`), which matters for a couple of the gotchas below.

## What it deploys

- **DynamoDB table** (`TutorStudents`) — partition key `studentId`, Streams enabled
  (`NEW_IMAGE`)
- **Lambda** (`tutor-new-student-trigger`) — subscribed to the table's stream,
  filters to `INSERT` events only, invokes the AgentCore Runtime

SES identities (sender + recipient) are **not** managed by this stack — they were
verified manually via the SES console, since verifying them again through CDK's
`ses.EmailIdentity` conflicts with identities that already exist.

## Deployment

```bash
npm install
export AGENT_RUNTIME_ARN="arn:aws:bedrock-agentcore:us-west-2:<account>:runtime/<runtime-id>"
export TUTOR_SENDER_EMAIL="..."
export TUTOR_STUDENT_EMAIL="..."
npx cdk bootstrap aws://<account>/us-west-2   # one-time per account/region
npx cdk deploy
```

## Testing the trigger

```bash
aws dynamodb put-item --table-name TutorStudents --region us-west-2 --item \
  '{"studentId": {"S": "student-XXX"}, "email": {"S": "..."}, "yearLevel": {"N": "6"}, "passCount": {"N": "0"}, "completed": {"BOOL": false}}'

aws logs tail /aws/lambda/tutor-new-student-trigger --region us-west-2 --follow
```

Use a fresh `studentId` each time — DynamoDB Streams only fires on genuine `INSERT`,
so re-using an existing ID won't retrigger anything.

## Known issues and gotchas

Getting the Lambda → AgentCore invocation working correctly took several rounds of
genuinely distinct bugs. In the order they were found:

1. **`runtimeSessionId` must be at least 33 characters.** The original
   `` `enroll-${studentId}-${Date.now()}` `` landed at exactly 32 for a
   `student-XXX`-style ID — one character short, causing a
   `ValidationException`. Fixed by using a UUID instead:
   `` `enroll-${randomUUID()}` `` (43 chars, always safely over the limit,
   regardless of studentId length).

2. **`InvokeAgentRuntimeCommand` requires `contentType` explicitly.** Omitting it
   causes the runtime to reject the request with HTTP 415 before it ever reaches the
   agent. Set `contentType: 'application/json'`.

3. **The deployed agent's server requires `accept: 'text/event-stream'` explicitly.**
   Omitting it causes HTTP 406. (Confirmed earlier via direct `curl` testing against
   the agent's `/invocations` endpoint — it only supports streaming SSE responses.)

4. **Default Lambda memory (128MB) is too low**, causing `Runtime.OutOfMemory` during
   *init* — before the handler even runs — likely from `@aws-sdk/client-bedrock-agentcore`'s
   module loading footprint. Fixed by setting `memorySize: 256`.

5. **The Lambda wasn't consuming the response stream**, meaning it could return before
   the agent finished its actual work (generate → render → send happens *during* the
   stream). Fixed by awaiting `response.response?.transformToString()` before
   returning. Also bumped the Lambda timeout to 120s to accommodate the full stream
   duration (a real invocation took ~57s end to end).

6. **The actual root cause behind a long run of `Runtime.HandlerNotFound` errors:**
   the Lambda handler file (`lambda/new-student-trigger/index.ts`) had at some point
   been overwritten with the **stack definition's content** (i.e. it contained
   `import * as cdk from 'aws-cdk-lib'` and `class TutorInfraStack` instead of the
   actual handler). This wasn't a CDK bug — confirmed by downloading and inspecting
   the actual deployed Lambda package (`aws lambda get-function ... --query
   "Code.Location"`, then unzipping): the bundle was 58MB and contained `aws-cdk-lib`
   itself. If you ever see a `HandlerNotFound` error that survives a clean redeploy
   with correct-looking source, **check that the Lambda entry file actually contains
   the handler code and not something else** — `findstr /C:"export const handler"
   lambda/new-student-trigger/index.ts` is a fast sanity check.

   (A red herring pursued along the way: explicit `bundling: { format:
   OutputFormat.CJS }` and an absolute `path.join(__dirname, ...)` entry path were
   added while chasing this — neither was the actual fix, but both are harmless and
   were left in place.)

7. **SES identities can't be created twice.** If sender/recipient addresses were
   already verified manually via the console, CDK's `ses.EmailIdentity` resources
   for the same addresses fail with `Resource ... already exists`. This project
   deliberately does not manage SES identities in CDK for that reason.

## Status

Confirmed working end-to-end: a `dynamodb put-item` call triggers the Lambda, which
successfully invokes the deployed `TutorAgent` AgentCore Runtime, which generates,
renders, and emails a worksheet — with the email physically delivered. No manual
`agentcore invoke` involved.

## Not yet done

- SES `send*` IAM permission on the AgentCore execution role is a manual
  `put-role-policy` fix (see `TutorAgent/README.md`), not tracked in this or any
  other IaC — worth moving into this stack or the agent's own CDK if this becomes
  more than a POC.
- `AGENT_RUNTIME_ARN` is passed as a shell env var at deploy time — fine for manual
  deploys, but would need a different mechanism (SSM parameter, CDK cross-stack
  reference, etc.) for CI/CD.