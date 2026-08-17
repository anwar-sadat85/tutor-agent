# Tutor POC — Local Test Harness

Day 1 scope: test `generate_worksheet` locally against Bedrock, no AWS
infrastructure (SES/Lambda/DynamoDB) yet.

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

Swap `us-west-2` for `ap-southeast-2` if that's where you have model access.
Update the `region` and `modelId` in `src/testGenerateWorksheet.ts` /
`src/generateWorksheet.ts` to match.

## Run

```bash
npm run test:generate
```

This calls `generateWorksheet()` once and prints the generated passage,
questions, and answer key to the console for manual review.

## What to check on first run

- Does `result` from `agent.invoke()` return the structured object directly,
  or nested under a property like `result.structuredOutput`? The exact
  accessor may differ slightly depending on the installed SDK version —
  adjust the return statement in `generateWorksheet.ts` if needed.
- Passage length close to 300-350 words?
- 8 questions, matching the type distribution in `STYLE_NOTES`?
- Answer key entries all present and genuinely matching their questions?
- Topic clearly different from "The Lost Track" (the embedded sample)?

## Next steps after this works

1. Run it 2-3 times, feed each `topic` back into `recentTopics` on the next
   call, confirm topics stay distinct
2. Build `render_worksheet_pdf` to turn a generated worksheet into an actual
   PDF
3. Build `assess_submission` — test with a real photographed numbered
   answer sheet against a generated worksheet's answer key
