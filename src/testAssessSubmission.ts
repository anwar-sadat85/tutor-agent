import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { generateWorksheet } from './generateWorksheet.js';
import { renderWorksheetPdf } from './renderWorksheetPdf.js';
import { assessSubmission } from './assessSubmission.js';
import { loadRecentTopics, addTopic } from './topicHistory.js';
import { loadStudentState, saveStudentState, PASSES_REQUIRED } from './studentState.js';
import { selectNextAssignment } from './selectNextAssignment.js';
import type { GeneratedWorksheet } from './generateWorksheet.js';

const WORKSHEET_JSON_PATH = './current-worksheet.json';
const PASS_THRESHOLD = 0.7; // 70% of questions correct — adjust as needed

async function generateAndSaveNextWorksheet(): Promise<GeneratedWorksheet> {
  const recentTopics = await loadRecentTopics();
  const worksheet = await generateWorksheet({ yearLevel: 6, recentTopics, region: 'ap-southeast-2' });
  await writeFile(WORKSHEET_JSON_PATH, JSON.stringify(worksheet, null, 2));
  await addTopic(worksheet.topic);

  const pdfPath = './current-worksheet.pdf';
  await renderWorksheetPdf(worksheet, pdfPath);

  console.log(`Generated: "${worksheet.title}"`);
  console.log(`Saved worksheet data to ${WORKSHEET_JSON_PATH}`);
  console.log(`Saved PDF to ${pdfPath}`);

  return worksheet;
}

async function main() {
  const args = process.argv.slice(2);
  const imagePaths = args; // supports one or more image paths (multi-page submissions)

  const studentState = await loadStudentState();

  if (studentState.completed) {
    console.log(
      `Programme already complete — student passed ${studentState.passCount}/${PASSES_REQUIRED} worksheets. ` +
        'No further assignments would be sent.'
    );
    return;
  }

  if (imagePaths.length === 0) {
    if (existsSync(WORKSHEET_JSON_PATH)) {
      console.log('A worksheet is already pending a submission — nothing to do without a photo.\n');
      return;
    }
    console.log('No current worksheet found — generating the first one...\n');
    await generateAndSaveNextWorksheet();
    console.log(
      '\nNow answer this worksheet by hand on a separate numbered sheet, photograph it,\n' +
        'and re-run: npm run test:grade -- <path-to-photo> [<path-to-photo2> ...]'
    );
    return;
  }

  // Grade the submitted photo(s) against the currently pending worksheet.
  const raw = await readFile(WORKSHEET_JSON_PATH, 'utf-8');
  const worksheet = JSON.parse(raw) as GeneratedWorksheet;

  console.log(`Grading submission against: "${worksheet.title}" (${imagePaths.length} page(s))\n`);

  const assessment = await assessSubmission({
    worksheet,
    imagePaths,
    region: 'ap-southeast-2',
  });

  console.log('=== LEGIBILITY ===');
  console.log(`Legible: ${assessment.legible}`);
  console.log(`Confidence: ${assessment.confidence}`);

  // Don't rely solely on the model's `legible` boolean — treat low confidence
  // as a second gating signal too, since a model can technically say
  // legible=true while still reconstructing text from fragments/context.
  const shouldRequestClearerPhoto = !assessment.legible || assessment.confidence === 'low';

  if (shouldRequestClearerPhoto) {
    console.log(
      '\n>>> Would trigger request_clearer_photo — no grading proceeds, no state update. <<<'
    );
    return; // student state and current-worksheet.json are untouched, per spec
  }

  console.log('\n=== PER-QUESTION RESULTS ===');
  for (const q of assessment.perQuestion) {
    console.log(
      `Q${q.number} [${q.status}] correct=${q.correct} — read: ${q.answerRead ?? '(none)'}`
    );
  }

  console.log(`\n=== OVERALL SCORE: ${assessment.overallScore} / ${worksheet.questions.length} ===`);
  console.log('\n=== FEEDBACK ===');
  console.log(assessment.feedback);

  const passed = assessment.overallScore / worksheet.questions.length >= PASS_THRESHOLD;
  console.log(`\n>>> Result: ${passed ? 'PASS' : 'FAIL'} <<<`);

  const { action, updatedState } = selectNextAssignment(studentState, passed);
  await saveStudentState(updatedState);

  console.log(`\n=== PROGRESS: ${updatedState.passCount} / ${PASSES_REQUIRED} passed ===`);

  if (action.kind === 'complete') {
    console.log('\nProgramme complete! No further worksheets will be sent.');
    return;
  }

  console.log('\nGenerating next worksheet (new topic, same Year 6 level)...\n');
  await generateAndSaveNextWorksheet();
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
