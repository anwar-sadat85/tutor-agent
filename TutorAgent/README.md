# TutorAgent

An AgentCore Runtime agent for **Tutor** — a background AI tutor that generates Year 6
reading comprehension worksheets, renders them to PDF, emails them to a student, and grades
a photographed answer sheet the student emails back (looping until the student has 5 passes,
each on a fresh topic). Built with the Strands Agents SDK (TypeScript), deployed as a
Container-build agent on Amazon Bedrock AgentCore Runtime.

This project was scaffolded with the [AgentCore CLI](https://github.com/aws/agentcore-cli)
and has been customized for Tutor's specific tools and deployment requirements.

## Project Structure

```
TutorAgent/
├── agentcore/
│   ├── agentcore.json      # Project config — runtime, build type, env vars
│   ├── aws-targets.json    # Deployment target (account + region: us-west-2)
│   └── cdk/                # CDK infrastructure (managed by the CLI, don't hand-edit)
└── app/TutorAgent/         # Agent application code
    ├── main.ts             # Entry point — Agent + tool registration, system prompt
    │                       #   (Flow A: generate+send, Flow B: grade submission),
    │                       #   BedrockAgentCoreApp, per-session Agent cache
    ├── model/load.ts        # Bedrock model config
    ├── generateWorksheet.ts
    ├── renderWorksheetPdf.ts
    ├── sendAssignmentEmail.ts
    ├── assessSubmission.ts     # Grades photographed answer sheet(s) against a worksheet's answer key
    ├── getSubmissionImage.ts   # Pulls the raw inbound email out of S3, extracts image attachment(s) to disk
    ├── selectNextAssignment.ts # Pure pass/fail → next-action decision (5 passes required to complete)
    ├── studentState.ts         # Read/write student record in DynamoDB (topicHistory, passCount, completed)
    ├── samples.ts               # Few-shot worksheet sample used for generation style
    ├── tools/
    │   ├── generateWorksheetTool.ts
    │   ├── renderWorksheetPdfTool.ts
    │   ├── sendAssignmentEmailTool.ts
    │   ├── getStudentStateTool.ts
    │   ├── updateStudentStateTool.ts
    │   ├── assessSubmissionTool.ts
    │   ├── selectNextAssignmentTool.ts
    │   └── getSubmissionImageTool.ts
    ├── scripts/                # Standalone check scripts for exercising a tool in isolation
    └── Dockerfile
```

A sibling project, `tutor-infra/`, holds the separate CDK stack for DynamoDB (student
state, with Streams enabled), S3 (raw inbound email storage), SES (inbound receipt rule),
and the two Lambdas that trigger this agent — one on new student enrollment, one on an
inbound graded-submission email. See that project's own README for its status.

## Prerequisites

- **Node.js** 22.x
- **AWS credentials** configured (`aws configure`), region `us-west-2`
- No local Docker needed — `agentcore deploy` builds the container image via AWS
  CodeBuild, not locally

## Tools implemented

| Tool | Purpose |
|---|---|
| `generate_worksheet` | Generates a Year 6 reading comprehension worksheet + answer key (structured output via Zod schema) |
| `render_worksheet_pdf` | Renders the worksheet to a PDF file on disk via Puppeteer, returns the **file path** (not the PDF content — see gotcha below) |
| `send_assignment_email` | Reads the PDF from the path returned above, sends it via SES (`SendRawEmail`, for attachment support) |
| `get_student_state` | Reads a student's record from DynamoDB (`topicHistory`, `passCount`, `completed`, `email`) |
| `update_student_state` | Writes a student's record back to DynamoDB |
| `get_submission_image` | Pulls the raw inbound email out of S3 (bucket/key from the submission-trigger Lambda) and extracts the photo attachment(s) to local disk, returns `imagePaths` |
| `assess_submission` | Grades photographed answer sheet(s) (by path) against the student's current worksheet's answer key — legibility, per-question results, overall score, pass/fail |
| `select_next_assignment` | Pure decision: given current `passCount` and the latest pass/fail, returns the new `passCount` and whether the 5-pass programme is now `completed` |
| `send_completion_email` | Sends a congratulatory email once a student reaches 5 passes, instead of another worksheet. Uses SES's plain `SendEmail` (no attachment needed, unlike `send_assignment_email`) |

No MCP clients, no AgentCore Memory — state persistence for the full system lives in
DynamoDB (`tutor-infra`), accessed via the `get`/`update_student_state` tools above, not
via AgentCore's managed memory. The agent runs two distinct flows off one system prompt,
selected from the prompt text at invocation time — see `main.ts`:

- **Flow A** (new enrollment): `get_student_state` → `generate_worksheet` →
  `update_student_state` → `render_worksheet_pdf` → `send_assignment_email`.
- **Flow B** (graded submission, triggered by the `submission-trigger` Lambda in
  `tutor-infra` on an inbound email): `get_submission_image` → `assess_submission` → (stop
  if illegible) → `get_student_state` → `select_next_assignment` → `update_student_state` →
  `send_completion_email` if the programme just completed (stop, no more worksheets),
  otherwise run Flow A again for the next worksheet.

## Setup (first time)
Copy the example config files and fill in your real values:
```bash
cp agentcore/agentcore.example.json agentcore/agentcore.json
cp agentcore/aws-targets.example.json agentcore/aws-targets.json
```
Edit both with your actual AWS account ID, region, and sender email before running `agentcore deploy`.

## Deployment

```bash
agentcore deploy
```

Deploys via CDK: builds the Docker image through CodeBuild, pushes to ECR, updates the
AgentCore Runtime. Takes several minutes.

```bash
agentcore invoke "Generate and send a worksheet for studentId=test-001, email=..., yearLevel=6."
```

Invokes the deployed agent directly — useful for testing the `generate → render → send`
chain in isolation, without the DynamoDB/Lambda trigger path.

## Deploying and testing the full end-to-end system

`TutorAgent` alone can only be invoked manually (above). To get the actual automatic
behaviour — a DynamoDB write triggering everything else — `tutor-infra` has to be deployed
too, and it needs this agent's Runtime ARN to do it. Order matters:

**1. Deploy this project first** (per Setup/Deployment above), then grab its Runtime ARN:
```bash
agentcore status
# or:
aws bedrock-agentcore-control list-agent-runtimes --region us-west-2 \
  --query "agentRuntimes[?agentRuntimeName=='TutorAgent_TutorAgent'].agentRuntimeArn" --output text
```

**2. Deploy `tutor-infra`**, passing that ARN and your sender/receiving domain in:
```bash
cd tutor-infra
npm install
export AGENT_RUNTIME_ARN="<arn from step 1>"
export TUTOR_SENDER_EMAIL="tutor@yourdomain.com"
export TUTOR_RECEIVING_DOMAIN="yourdomain.com"
npx cdk bootstrap aws://<account>/us-west-2   # one-time per account/region
npx cdk deploy
```
See `tutor-infra/README.md` for the SES domain verification and IAM permission steps this
needs before it'll actually work (both are one-time setup per AWS account).

**3. Test the whole loop by writing one new student record to DynamoDB** — nothing else,
no `agentcore invoke`, no manual trigger:
```bash
aws dynamodb put-item --table-name TutorStudents --region us-west-2 --item \
  '{"studentId": {"S": "e2e-test-001"}, "email": {"S": "your-real-email@example.com"}, "yearLevel": {"N": "6"}, "passCount": {"N": "0"}, "completed": {"BOOL": false}}'
```
Use a fresh, never-before-used `studentId` each time you re-test — DynamoDB Streams only
fires on a genuine `INSERT`, so re-writing an existing `studentId` won't trigger anything.

**4. Watch it happen, in a second terminal:**
```bash
aws logs tail /aws/lambda/tutor-new-student-trigger --region us-west-2 --follow
```
Within a few seconds you should see the Stream event picked up and an AgentCore invocation
fire — then check the inbox at the email you used in step 3 for the actual worksheet PDF.

**5. To test the reply/grading half (Flow B):** answer the worksheet by hand on a separate
numbered sheet (question number, then answer, one per line), photograph it, and reply to
the worksheet email — sending your reply to the same `tutor@` address `TUTOR_SENDER_EMAIL`
used. Watch the other Lambda:
```bash
aws logs tail /aws/lambda/tutor-submission-trigger --region us-west-2 --follow
```
A graded result should follow within roughly a minute, and either a new worksheet email or
(at 5 passes) a completion email should arrive.

**6. Confirm state directly, if you want to check without waiting on email:**
```bash
aws dynamodb get-item --table-name TutorStudents --region us-west-2 \
  --key '{"studentId": {"S": "e2e-test-001"}}'
```
Look for `currentWorksheet` (the full worksheet + answer key, persisted right after
generation) and `passCount`/`completed` (updated right after grading).

## Status

Both flows confirmed working end-to-end, fully automatically, via real email — no manual
`agentcore invoke` involved in either.

**Flow A (generate + send)** — writing a new student record to DynamoDB → Stream event →
`new-student-trigger` Lambda → AgentCore invocation → `generate_worksheet` →
`render_worksheet_pdf` → `send_assignment_email`, with the email physically delivered.

**Flow B (grade a submission)** — student replies by email with a photo of their answers →
SES receives it (domain: `anwar.nz`) → S3 (raw email stored) → `submission-trigger` Lambda
(looks up `studentId` via the `EmailIndex` GSI) → AgentCore invocation →
`get_submission_image` (extracts the photo from the raw email) → `assess_submission` →
`select_next_assignment` → `update_student_state` → either the next worksheet is generated
and sent (Flow A again), or — once the student reaches 5 passes —
`send_completion_email` fires instead and no further worksheet is sent.

See `tutor-infra/README.md` for the SES/Lambda-side setup and the considerable number of
distinct bugs found getting the inbound path working (SES domain verification needing to
happen in *two* regions, an `InvokeAgentRuntimeCommand` missing required parameters, a
stuck CloudFormation rollback, a `cmd.exe` quoting bug that silently corrupted every env
var, and more).