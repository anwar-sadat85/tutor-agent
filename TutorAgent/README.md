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

## Known issues and gotchas (things that broke, and the fixes)

These were hard-won during initial deployment — worth keeping so they don't get
rediscovered from scratch:

- **Windows: `agentcore dev` fails with `spawn npx ENOENT`.** This is a real bug in the
  CLI on Windows (Node's `spawn()` doesn't resolve `.cmd` shims without `shell: true`).
  Workaround used: skip `agentcore dev` entirely and run the agent directly with
  `npx tsx watch main.ts` from `app/TutorAgent/`, then `curl` the `/invocations`
  endpoint directly (with `Content-Type: application/json`, `Accept: text/event-stream`,
  and an `x-amzn-bedrock-agentcore-runtime-session-id` header).

- **Bedrock model IDs need a region-specific inference profile prefix**, not the bare
  model ID (e.g. `us.anthropic.claude-sonnet-4-6`, not `anthropic.claude-sonnet-4-6`).
  Confirm via `aws bedrock list-inference-profiles --region <region>`.

- **Docker Hub rate limiting (`429 Too Many Requests`) when CodeBuild pulls `node:22-slim`.**
  Fixed by pulling the base image from ECR Public instead:
  `public.ecr.aws/docker/library/node:22-slim`.

- **Puppeteer's bundled Chromium fails on Linux ARM** with
  `Syntax error: word unexpected (expecting ")")` — the downloaded Chrome-for-Testing
  binary is a bash-syntax wrapper script that fails under Debian's default `dash` shell.
  Fixed by skipping Puppeteer's own download (`PUPPETEER_SKIP_DOWNLOAD=true`) and using
  an apt-installed system Chromium instead (`apt-get install chromium`, then
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`), with `--no-sandbox
  --disable-setuid-sandbox --disable-dev-shm-usage` launch args required for running as
  a non-root container user.

- **Never pass large binary content (e.g. a rendered PDF) as a tool-call argument.**
  Originally `render_worksheet_pdf` returned base64-encoded PDF bytes for
  `send_assignment_email` to consume — this caused a ~2–3 minute hang with no visible
  error, because the model had to *generate* that entire base64 string token-by-token as
  part of producing the next tool call. Fixed by having `render_worksheet_pdf` return
  only a file path (`/tmp/worksheet-<timestamp>.pdf`), and `send_assignment_email` reads
  the file from disk directly inside its own tool callback.

- **AgentCore's `environmentVariables` field (as documented in `agentcore.json`'s schema)
  silently does nothing for application-level agents — root cause found.** Confirmed via
  `aws bedrock-agentcore-control get-agent-runtime ... --query "environmentVariables"`
  returning `null` even after redeploying with the field present. Traced the actual deploy
  path (`agentcore.json` → the CLI's generated `agentcore/cdk/lib/cdk-stack.ts` →
  `AgentCoreApplication` → the `@aws/agentcore-cdk` L3 constructs) and found the real
  cause: the construct that actually wires environment variables through
  (`AgentCoreRuntime.js`, which correctly reads a top-level `environmentVariables` prop)
  is only ever instantiated for **MCP server runtimes** (`McpRuntimeCompute.js`) — the
  application/agent runtime construct (`AgentCoreApplication.js`) never references
  `environmentVariables` at all. Separately, the schema (`agent-env.js`) shows the field
  the agent-level construct actually reads is `envVars` — an **array** of `{name, value}`
  objects, not `environmentVariables` as an object map:
  ```json
  "envVars": [
    { "name": "TUTOR_SENDER_EMAIL", "value": "tutor@anwar.nz" }
  ]
  ```
  `agentcore validate` accepts either field name silently (Zod doesn't reject unknown
  extra keys), so the wrong field produces no error — it just never propagates. Switching
  to `envVars` with the correct `{name, value}` array shape fixed it; confirmed via the
  same `get-agent-runtime` query and in the console (Runtime → version → Advanced
  configurations → Environment variables). `@aws/agentcore-cdk` was at `0.1.0-alpha.45`
  at the time — plausible this gets fixed upstream in a later version, worth checking
  `npm outdated @aws/agentcore-cdk` from `agentcore/cdk/` occasionally.

- **A student created via `agentcore invoke` directly (not through the real DynamoDB-first
  enrollment pipeline) can end up with no `email` attribute in DynamoDB**, and therefore
  be invisible to the `EmailIndex` GSI that Flow B's inbound path depends on. Cause: the
  system prompt's Flow A originally only told the agent to persist `currentWorksheet` and
  `topicHistory` via `update_student_state` — never `email` — and separately,
  `updateStudentStateTool`'s Zod schema didn't even accept an `email` field at all, so
  even after the prompt was corrected to mention it, the tool would have silently
  rejected/dropped it. Both are fixed now (prompt says to always include `email`; the
  tool schema accepts it) — but this only matters going forward for students created via
  ad-hoc `agentcore invoke` testing. In the real pipeline, students are always created via
  `dynamodb put-item` first (with `email` included), and `update_student_state`'s merge
  semantics (`SET` only touches fields explicitly provided) mean `email` survives Flow A's
  updates regardless.
  by default.** Each new tool needing AWS access failed with `AccessDenied` until granted
  explicitly. Initially fixed with manual `aws iam put-role-policy` calls during
  development (untracked, directly editing a CDK-managed role); **later moved into
  tracked IaC** — `tutor-infra/lib/tutor-infra-stack.ts` now imports this role by name
  (`iam.Role.fromRoleName`) and attaches three standalone `iam.Policy` resources
  (`TutorSESSendPolicy`, `TutorDynamoDBStatePolicy`, `TutorS3InboundReadPolicy`) to it.
  The manual inline policies were deleted first (`aws iam delete-role-policy`) to avoid
  a name collision before deploying the CDK-tracked versions. See `tutor-infra/README.md`
  for the actual policy definitions.

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