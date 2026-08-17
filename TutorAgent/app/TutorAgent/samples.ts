// Sample worksheets used as few-shot style/difficulty reference for generate_worksheet.
// Sourced from the 5 Year 6 reading comprehension templates drafted for the Tutor POC.
// Trimmed to one full example + short pattern notes to keep the prompt compact —
// swap SAMPLE_WORKSHEET for a real teacher-supplied worksheet once available.

export const SAMPLE_WORKSHEET = `
Title: The Lost Track
Year level: 6

Passage (approx. 320 words):
Mia adjusted the straps on her backpack and looked back at the car park, now just a smudge
of grey between the trees. She had walked this track with her dad a dozen times, but today
he had let her go ahead while he tied his bootlace, and somewhere in the last ten minutes
she had taken a wrong turn.

The bush around her was thick with ferns, and the path beneath her feet had narrowed to
little more than a rabbit trail. She stopped and listened. No voices, no footsteps — just
the creak of branches and the distant call of a tui. Her heart began to beat a little
faster, but she remembered what her dad always said: if you're lost, stop before you go
any further.

She sat down on a fallen log and pulled out her water bottle. Panicking wouldn't help. She
thought back over her steps. The track had split at a big rimu tree with a carving on its
trunk — she was sure of that. If she followed her own footprints back through the soft mud,
she might find it again.

[...]

Questions (8 total, mixed types):
1. Literal — recall a specific detail or event
2. Literal — recall a specific clue or fact
3. Inferential — explain reasoning/advice and why it matters
4. Vocabulary — find a word in the passage matching a given meaning
5. Inferential — infer character feelings, supported by text evidence
6. Literal/inferential — explain a character's decision
7. Literal — explain the significance of an object/detail
8. Summary — explain the resolution in the student's own words
`;

export const STYLE_NOTES = `
Style and difficulty notes for Year 6 reading comprehension worksheets:
- Passage length: 300-350 words
- Narrative or nonfiction/informational, third person
- Vocabulary: age-appropriate but includes 1-2 slightly challenging words worth testing
  in a vocabulary-in-context question
- Sentence structure: mostly compound/complex sentences, not overly simple
- 8 questions per worksheet, in this mix:
  - 2-3 literal recall questions
  - 2-3 inferential questions (require reasoning, not just lookup)
  - 1 vocabulary-in-context question ("find a word that means...")
  - 1 open-ended opinion/reasoning question with no single correct answer
  - 1 summary question asking the student to explain something in their own words
- Avoid: overly dark or upsetting themes, real named public figures, copyrighted characters
- New Zealand context is welcome but not required (e.g. native flora/fauna, local settings)
`;
