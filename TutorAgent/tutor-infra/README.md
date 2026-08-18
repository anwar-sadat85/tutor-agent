# tutor-infra

CDK stack providing the **automatic triggers** for Tutor: a DynamoDB table holding student
state, a Lambda that fires on new student enrollment (generates + sends the first
worksheet), and the inbound-email path that grades a student's photographed submission —
SES receipt rule → S3 (raw email) → Lambda → AgentCore, all invoking the deployed
`TutorAgent` AgentCore Runtime.

This is a separate CDK app from `TutorAgent/` (the AgentCore agent itself) and is
deployed independently — `TutorAgent` must already be deployed first, since this stack
needs its Runtime ARN.

## Project Structure

```
tutor-infra/
├── bin/tutor-infra.ts          # CDK app entry point
├── lib/tutor-infra-stack.ts    # DynamoDB table + GSI, both Lambdas, S3 bucket, SES receipt rule, IAM
└── lambda/
    ├── new-student-trigger/index.ts   # Fires on DynamoDB Stream INSERT — generate + send first worksheet
    └── submission-trigger/index.ts    # Fires on inbound-email S3 PutObject — grade a submitted photo
```

Note: this project is nested inside `TutorAgent/` on disk
(`TutorAgent/tutor-infra/`), which matters for a couple of the gotchas below.

## What it deploys

- **DynamoDB table** (`TutorStudents`) — partition key `studentId`, Streams enabled
  (`NEW_IMAGE`), plus a **GSI** (`EmailIndex`, partition key `email`) so the submission
  Lambda can reverse-lookup `studentId` from an inbound email's sender address
- **Lambda** (`tutor-new-student-trigger`) — subscribed to the table's stream,
  filters to `INSERT` events only, invokes the AgentCore Runtime
- **S3 bucket** (`tutor-inbound-email-<account>-<region>`) — durable storage for raw
  inbound emails, written by SES before the Lambda runs; `DESTROY`/auto-delete removal
  policy (POC convenience, not for production)
- **SES receipt rule set** (`tutor-receipt-rules`, one rule `SubmissionRule`) — the only
  active rule set for the account/region; routes mail for `TUTOR_RECEIVING_DOMAIN` through
  two ordered actions: S3 (store raw email under `incoming/<messageId>`), then Lambda
  (async invoke)
- **Lambda** (`tutor-submission-trigger`) — fires on that SES→Lambda action, extracts the
  sender address from the raw email, looks up `studentId` via the `EmailIndex` GSI, and
  invokes the AgentCore Runtime with the S3 bucket/key so the agent can pull the photo and
  grade it (Flow B in `TutorAgent/README.md`)

SES identities (sender + recipient) are **not** managed by this stack — they were
verified manually via the SES console, since verifying them again through CDK's
`ses.EmailIdentity` conflicts with identities that already exist. Inbound receiving also
requires a domain you control (not a plain Gmail address) — `TUTOR_RECEIVING_DOMAIN`
defaults to `anwar.nz`.

## Deployment

```bash
npm install
export AGENT_RUNTIME_ARN="arn:aws:bedrock-agentcore:us-west-2:<account>:runtime/<runtime-id>"
export TUTOR_SENDER_EMAIL="..."
export TUTOR_RECEIVING_DOMAIN="..."   # domain you control, for inbound SES receiving
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

To test the submission path, email a photo of a completed worksheet to an address at
`TUTOR_RECEIVING_DOMAIN` from the address stored as that student's `email` in DynamoDB,
then tail the other Lambda:

```bash
aws logs tail /aws/lambda/tutor-submission-trigger --region us-west-2 --follow
```

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

**Enrollment trigger** — confirmed working end-to-end: a `dynamodb put-item` call triggers
`tutor-new-student-trigger`, which successfully invokes the deployed `TutorAgent`
AgentCore Runtime, which generates, renders, and emails a worksheet — with the email
physically delivered. No manual `agentcore invoke` involved.

**Submission trigger** — deployed (S3 bucket, SES receipt rule, `EmailIndex` GSI,
`tutor-submission-trigger` Lambda all synth/deploy cleanly), but not yet confirmed
end-to-end via a real inbound email the way the enrollment path has been. See
`TutorAgent/README.md`'s Status section for the same caveat from the agent side.

## Not yet done

- SES `send*` IAM permission on the AgentCore execution role is a manual
  `put-role-policy` fix (see `TutorAgent/README.md`), not tracked in this or any
  other IaC — worth moving into this stack or the agent's own CDK if this becomes
  more than a POC.
- `AGENT_RUNTIME_ARN` is passed as a shell env var at deploy time — fine for manual
  deploys, but would need a different mechanism (SSM parameter, CDK cross-stack
  reference, etc.) for CI/CD.
- The submission trigger path (SES → S3 → Lambda → AgentCore grading) hasn't had a real
  end-to-end test with an actual inbound email yet — worth doing before relying on it.