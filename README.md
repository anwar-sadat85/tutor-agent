# Tutor POC — Local Test Harness

Local, no-AWS-infra test harness for Tutor's core logic: generate a Year 6 reading
comprehension worksheet, render it to PDF, grade a photographed answer sheet against it,
and decide what happens next — all run by hand from the CLI against Bedrock directly (no
DynamoDB, Lambda, SES, or AgentCore Runtime).

The deployed, fully working end-to-end system (AgentCore Runtime, DynamoDB student state,
SES email in/out — enrollment through grading through completion) lives in
[`TutorAgent/`](TutorAgent/README.md) — see that project's README (and
`TutorAgent/tutor-infra/README.md`) for the production architecture and deployment. This
root-level harness is where the core logic (`generateWorksheet`, `renderWorksheetPdf`,
`assessSubmission`, `selectNextAssignment`) was originally proven out locally before being
copied into `TutorAgent/app/TutorAgent/` and wired up as agent tools.

## Setup

```bash
npm install
```

Confirm AWS credentials and Bedrock model access:

```bash
aws sts get-caller-identity
aws bedrock list-foundation-models --region us-west-2 \
  --query "modelSummaries[?contains(modelId, 'claude')].modelId"
```

Swap `us-west-2` for another region if that's where you have model access — update the
`region` argument passed to `generateWorksheet()` / `assessSubmission()` in the `src/test*.ts`
scripts to match.

## What's here

| File | Purpose |
|---|---|
| `src/generateWorksheet.ts` | Calls Bedrock (via Strands `Agent`, structured output with Zod) to generate a worksheet + answer key |
| `src/renderWorksheetPdf.ts` | Renders a generated worksheet to a PDF via Puppeteer |
| `src/assessSubmission.ts` | Grades one or more photographed answer-sheet images against a worksheet's answer key |
| `src/selectNextAssignment.ts` | Pure function: given current pass count + latest pass/fail, decides `complete` vs `send_new_worksheet` |
| `src/studentState.ts` | Reads/writes local `student-state.json` (`passCount`, `completed`) — stands in for the DynamoDB record used in `TutorAgent/` |
| `src/topicHistory.ts` | Reads/writes local `topic-history.json` — recent topics fed back into `generateWorksheet` so topics don't repeat |
| `src/samples.ts` | Few-shot sample worksheet + style notes used to steer generation |

## Run

```bash
npm run test:generate   # generate a worksheet only, print to console
npm run test:pdf        # render an existing worksheet to PDF
npm run test:grade      # full local loop — see below
```

### The full local loop (`npm run test:grade`)

`src/testAssessSubmission.ts` drives the whole cycle from the CLI:

1. **No `current-worksheet.json` present** → generates a new worksheet (using
   `topic-history.json` to avoid repeat topics), saves it as `current-worksheet.json` and
   `current-worksheet.pdf`, and stops — print out the PDF, answer it by hand on a separate
   numbered sheet, and photograph it.
2. **Re-run with photo path(s)**:
   ```bash
   npm run test:grade -- <path-to-photo> [<path-to-photo2> ...]
   ```
   Grades the photo(s) against the pending `current-worksheet.json` via `assessSubmission`
   (Bedrock vision). If the submission is illegible or low-confidence, it stops there —
   no state change, same worksheet stays pending. Otherwise it scores the submission
   (70% pass threshold), updates `student-state.json` via `selectNextAssignment`, and — if
   the 5-pass programme isn't complete — generates and saves the next worksheet
   automatically.

Photographed answer sheets used for this are gitignored (`test/`) — see the repo's
`.gitignore` for why (may contain a real child's handwriting).

## What to check on first run

- Passage length close to 300-350 words?
- 8 questions, matching the type distribution in `STYLE_NOTES` (`src/samples.ts`)?
- Answer key entries all present and genuinely matching their questions?
- Topic clearly different from "The Lost Track" (the embedded sample) and from anything in
  `topic-history.json`?
- On grading: does `assessSubmission` correctly flag an illegible/blurry photo rather than
  guessing at answers?