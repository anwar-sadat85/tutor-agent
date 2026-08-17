import { generateWorksheet } from './generateWorksheet.js';
import { renderWorksheetPdf } from './renderWorksheetPdf.js';
import { loadRecentTopics, addTopic } from './topicHistory.js';

async function main() {
  const recentTopics = await loadRecentTopics();
  console.log(`Recent topics on file: ${recentTopics.length ? recentTopics.join(', ') : '(none yet)'}\n`);
  console.log('Generating Year 6 reading comprehension worksheet...\n');

  const worksheet = await generateWorksheet({
    yearLevel: 6,
    recentTopics,
    region: 'ap-southeast-2',
  });

  console.log(`Generated: "${worksheet.title}" (topic: ${worksheet.topic})`);

  const outputPath = `./output-worksheet-${Date.now()}.pdf`;
  await renderWorksheetPdf(worksheet, outputPath);
  console.log(`\nPDF rendered to: ${outputPath}`);
  console.log('Open it and check: layout clean, text not cut off, questions all present.');

  await addTopic(worksheet.topic);
  console.log(`\nSaved topic "${worksheet.topic}" to topic-history.json for next run.`);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
