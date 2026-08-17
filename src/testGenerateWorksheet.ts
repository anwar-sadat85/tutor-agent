import { generateWorksheet } from './generateWorksheet.js';
import { loadRecentTopics, addTopic } from './topicHistory.js';

async function main() {
  const recentTopics = await loadRecentTopics();
  console.log(`Recent topics on file: ${recentTopics.length ? recentTopics.join(', ') : '(none yet)'}\n`);
  console.log('Generating Year 6 reading comprehension worksheet...\n');

  const worksheet = await generateWorksheet({
    yearLevel: 6,
    recentTopics,
    region: 'us-west-2',
  });

  console.log('=== TITLE ===');
  console.log(worksheet.title);
  console.log('\n=== TOPIC (for repetition tracking) ===');
  console.log(worksheet.topic);
  console.log('\n=== PASSAGE ===');
  console.log(worksheet.passage);
  console.log('\n=== QUESTIONS ===');
  for (const q of worksheet.questions) {
    console.log(`${q.number}. [${q.type}] ${q.text}`);
  }
  console.log('\n=== ANSWER KEY ===');
  for (const a of worksheet.answerKey) {
    console.log(`${a.number}. ${a.expectedAnswer}`);
    console.log(`   Notes: ${a.gradingNotes}`);
  }

  // Sanity checks worth eyeballing manually:
  console.log('\n=== SANITY CHECKS ===');
  console.log(`Word count (rough): ${worksheet.passage.split(/\s+/).length}`);
  console.log(`Question count: ${worksheet.questions.length} (expect 8)`);
  console.log(`Answer key count: ${worksheet.answerKey.length} (expect 8)`);

  await addTopic(worksheet.topic);
  console.log(`\nSaved topic "${worksheet.topic}" to topic-history.json for next run.`);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});