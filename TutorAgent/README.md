# TutorAgent

An AgentCore Runtime agent for **Tutor** — a background AI tutor that generates Year 6
reading comprehension worksheets, renders them to PDF, and emails them to a student.
Built with the Strands Agents SDK (TypeScript), deployed as a Container-build agent on
Amazon Bedrock AgentCore Runtime.

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
    ├── main.ts             # Entry point — Agent + tool registration + BedrockAgentCoreApp
    ├── model/load.ts        # Bedrock model config
    ├── generateWorksheet.ts
    ├── renderWorksheetPdf.ts
    ├── sendAssignmentEmail.ts
    ├── samples.ts            # Few-shot worksheet sample used for generation style
    ├── tools/
    │   ├── generateWorksheetTool.ts
    │   ├── renderWorksheetPdfTool.ts
    │   └── sendAssignmentEmailTool.ts
    └── Dockerfile
```

A sibling project, `tutor-infra/`, holds the separate CDK stack for DynamoDB (student
state, with Streams enabled) and the Lambda that triggers this agent on new student
enrollment. See that project's own README for its status.

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

No MCP clients, no AgentCore Memory — state persistence for the full system lives in
DynamoDB (`tutor-infra`), accessed as a tool, not via AgentCore's managed memory.

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

- **AgentCore's `environmentVariables` field (set in `agentcore.json` under the
  runtime entry) did not propagate to the deployed runtime** — confirmed via
  `aws bedrock-agentcore-control get-agent-runtime ... --query "environmentVariables"`
  returning `null` even after redeploying with the field present. Root cause not yet
  found. Workaround: the sender email is hardcoded as the default value in
  `sendAssignmentEmail.ts` rather than relying on the env var. Worth revisiting.

- **The AgentCore CLI's auto-generated execution role has no SES permissions by
  default.** `send_assignment_email` will fail with an IAM `AccessDenied` error until
  this is added. Confirmed missing via:
  ```bash
  aws iam list-role-policies --role-name <execution-role-name> --region us-west-2
  aws iam get-role-policy --role-name <execution-role-name> --policy-name <auto-generated-policy-name> --region us-west-2
  ```
  Fixed by attaching a scoped inline policy directly to the role (find the exact role
  name via `agentcore status` or the CloudFormation stack outputs — it's the
  `...RuntimeExecutionRole...` resource):

  `ses-policy.json`:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "ses:SendRawEmail",
          "ses:SendEmail"
        ],
        "Resource": "*"
      }
    ]
  }
  ```

  ```bash
  aws iam put-role-policy \
    --role-name <execution-role-name> \
    --policy-name TutorSESSendPolicy \
    --policy-document file://ses-policy.json \
    --region us-west-2
  ```

  This is a manual, out-of-band fix — it directly edits a role that CDK/AgentCore
  manages, so a future full stack update to this role could potentially overwrite or
  orphan it. Ideally this permission should be moved into tracked IaC (e.g. added to
  the CDK stack or wherever AgentCore CLI supports custom IAM policy attachments)
  rather than left as a manual side-fix.

## Status

End-to-end `generate_worksheet → render_worksheet_pdf → send_assignment_email` confirmed
working against the real deployed AgentCore Runtime, with an email successfully
delivered via SES. The DynamoDB → Lambda → AgentCore automatic trigger path
(`tutor-infra`) has not yet been deployed or tested.