import puppeteer from 'puppeteer';
import type { GeneratedWorksheet } from './generateWorksheet.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildWorksheetHtml(worksheet: GeneratedWorksheet): string {
  const paragraphs = worksheet.passage
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n');

  const questions = worksheet.questions
    .map(
      (q) => `
      <li class="question">
        <span class="qnum">${q.number}.</span>
        <span class="qtext">${escapeHtml(q.text)}</span>
      </li>`
    )
    .join('\n');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a;
    max-width: 700px;
    margin: 40px auto;
    line-height: 1.6;
    font-size: 14px;
  }
  h1 {
    font-family: -apple-system, 'Segoe UI', sans-serif;
    font-size: 22px;
    border-bottom: 3px solid #2d2a26;
    padding-bottom: 8px;
    margin-bottom: 4px;
  }
  .meta {
    font-family: -apple-system, 'Segoe UI', sans-serif;
    font-size: 12px;
    color: #666;
    margin-bottom: 24px;
  }
  .passage p {
    margin: 0 0 14px 0;
    text-align: justify;
  }
  .questions-heading {
    font-family: -apple-system, 'Segoe UI', sans-serif;
    font-size: 16px;
    font-weight: bold;
    margin-top: 28px;
    margin-bottom: 12px;
    border-top: 1px solid #ccc;
    padding-top: 16px;
  }
  ol.questions {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .question {
    display: flex;
    gap: 8px;
    margin-bottom: 18px;
    font-family: -apple-system, 'Segoe UI', sans-serif;
    font-size: 13.5px;
  }
  .qnum {
    font-weight: bold;
    flex-shrink: 0;
  }
  .instructions {
    font-family: -apple-system, 'Segoe UI', sans-serif;
    font-size: 12px;
    color: #444;
    background: #f5f3ee;
    border-radius: 6px;
    padding: 12px 16px;
    margin-top: 24px;
  }
</style>
</head>
<body>
  <h1>${escapeHtml(worksheet.title)}</h1>
  <div class="meta">Year ${worksheet.yearLevel} — Reading Comprehension</div>

  <div class="passage">
    ${paragraphs}
  </div>

  <div class="questions-heading">Questions</div>
  <ol class="questions">
    ${questions}
  </ol>

  <div class="instructions">
    Write your answers on a separate sheet of paper. Start each answer with the
    question number, then photograph or scan your answer sheet clearly and
    reply to this email with the photo attached.
  </div>
</body>
</html>`;
}

/**
 * Renders a generated worksheet to a PDF file on disk.
 * Returns the path to the generated PDF.
 */
export async function renderWorksheetPdf(
  worksheet: GeneratedWorksheet,
  outputPath: string
): Promise<string> {
  const html = buildWorksheetHtml(worksheet);

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}