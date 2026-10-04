const { getEmbedding, getEmbeddingsBatch } = require('./embeddingService');

// Semantic fallback for detectTopic() in aggregationService.js — recognizes a
// NEW phrasing of an EXISTING built-in topic (not a custom per-college
// question; see tracerQuestionCatalogService.js for that, same pattern) by
// MEANING instead of needing one more hand-written regex alternative added
// every time a live question slips through TOPIC_PATTERNS. Mirrors that
// file's own proven shape exactly: embedding similarity decides WHICH
// deterministic dispatch arm to route to, never the answer itself — the
// matched topic still flows into the exact same extractFilters()/dispatch
// pipeline every regex-matched topic already uses, so the actual numbers are
// always a real MongoDB query, never an LLM guess (see
// feedback_prefer_deterministic_over_llm_prompt_patching).
//
// One entry per TOPIC_PATTERNS key (aggregationService.js) with a short
// description plus a few representative phrasings DIFFERENT from the ones
// TOPIC_PATTERNS already matches — duplicating those wastes catalog entries
// on phrasings the regex layer already resolves for free before this ever
// runs. Static and code-defined (not editable by an admin, unlike the
// per-college custom-question catalog), so there's no DB model for it —
// embeddings are computed once, lazily, and cached in a module-level
// variable for the life of the process.
//
// Deliberately excludes a handful of topic-adjacent capabilities that are
// EARLY BYPASSES inside queryInner() rather than real TOPIC_PATTERNS entries
// (e.g. "who is the most recent graduate added," "which batch had the most
// graduates") — those run before topic dispatch ever happens and aren't
// reachable through this catalog. Documented scope boundary, not an
// oversight: see the plan this file was built from.
const BUILTIN_CAPABILITIES = [
  {
    topic: 'rate',
    description: 'A derived percentage — employment rate, unemployment rate, or the share of alumni with a given outcome.',
    examples: [
      'What fraction of graduates have jobs right now?',
      'How successful has the program been at getting alumni hired?',
      'What proportion of alumni are without work?',
    ],
  },
  {
    topic: 'count',
    description: 'A raw headcount of alumni matching some condition.',
    examples: [
      'Give me the total number of graduates on file.',
      'Tally up everyone who completed the survey.',
      'How many records exist in the system?',
    ],
  },
  {
    topic: 'industry',
    description: 'What industries or sectors alumni work in, ranked by how common each one is.',
    examples: [
      'What lines of business do our graduates end up in?',
      'Break down the alumni by the sector they work for.',
      'Where do most graduates land job-wise, industry-wise?',
    ],
  },
  {
    topic: 'job_positions',
    description: 'Which job titles or roles alumni hold, ranked by frequency.',
    examples: [
      'What jobs do graduates typically end up with?',
      'List the most common roles alumni are working in.',
      'What positions are most/least represented among alumni?',
    ],
  },
  {
    topic: 'top_companies',
    description: 'Which employers/companies hire the most alumni, ranked by headcount.',
    examples: [
      'Who are the biggest employers of our graduates?',
      'Which organizations have hired the most alumni?',
      'Rank companies by how many graduates they employ.',
    ],
  },
  {
    topic: 'work_type',
    description: 'Employment arrangement type — regular/permanent, contractual, part-time, project-based, freelance, self-employed — or government vs private sector.',
    examples: [
      'What kind of job arrangement do alumni have — regular or contractual?',
      'Are graduates mostly working government jobs or private sector?',
      'Breakdown of employment arrangement among alumni.',
    ],
  },
  {
    topic: 'job_relevance',
    description: 'Whether an alumnus\'s current job matches or relates to what they studied in college.',
    examples: [
      'Did graduates end up in careers matching their degree?',
      'How well does the work alumni do match their field of study?',
      'Are alumni using what they learned in school?',
    ],
  },
  {
    topic: 'work_location',
    description: 'Whether alumni work locally (within the country) or abroad (overseas/OFW).',
    examples: [
      'How many graduates went to work overseas?',
      'Split alumni by whether they stayed in the country or left for work abroad.',
    ],
  },
  {
    topic: 'further_studies',
    description: 'Whether alumni pursued further/graduate education after their degree (masters, doctorate, etc.).',
    examples: [
      'Did any alumni go back to school for a higher degree?',
      'How many graduates continued on to a masters or PhD?',
    ],
  },
  {
    topic: 'licensure',
    description: 'Whether alumni took and/or passed a professional licensure/board exam.',
    examples: [
      'How did alumni do on their professional licensing exam?',
      'What share of graduates are licensed professionals now?',
    ],
  },
  {
    topic: 'promotion',
    description: 'Whether alumni were promoted at their job.',
    examples: [
      'Have graduates been moving up in their careers / getting promoted?',
      'How many alumni advanced to a higher position at work?',
    ],
  },
  {
    topic: 'further_training',
    description: 'Whether alumni attended trainings, seminars, or workshops after graduating.',
    examples: [
      'Did graduates attend any professional development sessions?',
      'How many alumni joined extra skills training after school?',
      'Do alumni keep upskilling or learning new things after they leave school?',
    ],
  },
  {
    topic: 'accomplishments',
    description: 'Significant career accomplishments or awards alumni reported.',
    examples: [
      'What notable achievements have graduates earned in their careers?',
      'Any alumni who won awards or recognition at work?',
    ],
  },
  {
    topic: 'competencies',
    description: 'Self-rated competency/skill levels alumni gave themselves (technical skills, communication, teamwork, adaptability, problem-solving, critical thinking, project management, work-life balance).',
    examples: [
      'How do graduates rate their own abilities after finishing the program?',
      'What do alumni think of their own technical/communication skills?',
      'Self-assessment scores of alumni across different competency areas.',
    ],
  },
  {
    topic: 'skills_list',
    description: 'Concrete, named skills alumni list on their profile (e.g. Python, Java, SQL) — distinct from the competency self-ratings above.',
    examples: [
      'What concrete technical skills do alumni have listed?',
      'Most common tools or languages graduates know.',
    ],
  },
  {
    topic: 'gender',
    description: 'Gender distribution/breakdown of alumni (male, female, LGBTQIA+).',
    examples: [
      'What is the male-to-female split of our graduates?',
      'How diverse is the alumni population by gender?',
    ],
  },
  {
    topic: 'by_program',
    description: 'Any of the above broken down PER academic program or specialization/track, compared side by side.',
    examples: [
      'Break this down for every degree program separately.',
      'Compare outcomes between the different courses offered.',
      'Which course/track performs best on this measure?',
    ],
  },
  {
    topic: 'by_year',
    description: 'Any of the above broken down PER graduation batch/year, compared side by side.',
    examples: [
      'Show this split out year by year.',
      'How has this changed across different graduating batches?',
      'Which batch stands out on this measure?',
    ],
  },
  {
    topic: 'names',
    description: 'A list of specific alumni (by name) matching some criteria, or finding a specific person/group.',
    examples: [
      'Give me the roster of graduates matching this filter.',
      'I need the actual list of people, not just a number.',
    ],
  },
  {
    topic: 'overview',
    description: 'A general, high-level summary of the tracer study data overall — not any one specific metric.',
    examples: [
      'Give me a general rundown of the survey results.',
      'Summarize the tracer study data for me.',
    ],
  },
  {
    topic: 'tracer_activity',
    description: 'Submission/record-keeping activity on the tracer form itself — who submitted, updated, or has records added recently (not about alumni employment outcomes).',
    examples: [
      'How active has data collection been lately?',
      'Has anyone updated their survey response recently?',
    ],
  },
  {
    topic: 'events',
    description: 'Alumni portal events/activities — attendance, participants, scheduling (not tracer-study employment data at all).',
    examples: [
      'Who showed up to the recent alumni gathering?',
      'What activities does the portal have coming up?',
      'Was turnout good at our last event?',
    ],
  },
  {
    topic: 'event_feedback',
    description: 'Feedback/ratings submitted specifically about a portal event (not general tracer-study feedback about careers/curriculum).',
    examples: [
      'What did people think of the last event we held?',
      'Ratings or comments left for a specific activity.',
    ],
  },
];

let cachedCatalog = null; // [{ topic, text, embedding }]

// Each topic's description + every individual example question become their
// OWN separate catalog entry/embedding — NOT one combined paragraph per
// topic. Tried the combined-paragraph shape first; it measurably hurt match
// quality (a live test query that scored 0.91 cosine similarity against its
// single matching example sentence alone scored only 0.53 — BELOW
// MATCH_THRESHOLD, and even below an unrelated topic — once that same
// sentence was diluted inside one long "description + 3 examples" blob).
// Matching against many short, specific exemplars and taking the single
// best-scoring one (same shape tracerQuestionCatalogService.js's own
// toEmbeddableText() already uses: one short label per entry, never a
// multi-sentence paragraph) keeps each exemplar's own signal intact instead
// of averaging it away.
function flattenCatalog() {
  const flat = [];
  for (const c of BUILTIN_CAPABILITIES) {
    flat.push({ topic: c.topic, text: c.description });
    for (const ex of c.examples) flat.push({ topic: c.topic, text: ex });
  }
  return flat;
}

async function getCatalogEmbeddings() {
  if (cachedCatalog) return cachedCatalog;
  const flat = flattenCatalog();
  const embeddings = await getEmbeddingsBatch(flat.map((f) => f.text));
  cachedCatalog = flat.map((f, i) => ({ topic: f.topic, text: f.text, embedding: embeddings[i] }));
  return cachedCatalog;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Calibrated separately from tracerQuestionCatalogService.js's own 0.55 —
// tried reusing that number first (same embedding model/space, seemed like
// a reasonable starting point), but this catalog's own live test found it
// doesn't hold here: genuinely off-topic questions ("what is the weather
// today," "tell me a joke," "what is the best pizza topping") scored as
// high as 0.555 — AT that threshold — against this catalog's per-exemplar
// entries, while a batch of 22 deliberately hard, non-copied real
// paraphrases of every topic above scored no lower than 0.647 (20/22 also
// landed on the CORRECT topic, not just above-threshold on some topic).
// 0.60 sits in the gap between those two, with margin on both sides — matches
// this file's own "lowest threshold that cleanly separates true from false"
// calibration philosophy, just re-run for this catalog's specific shape
// (many short per-topic exemplars) rather than assumed to transfer from a
// differently-shaped catalog (one embedding per admin custom question).
const MATCH_THRESHOLD = 0.6;

// Finds which (if any) built-in topic a question is semantically asking
// about. Pure vector-similarity match — no LLM call, fully deterministic
// given the same catalog + question text. Returns null below
// MATCH_THRESHOLD rather than a low-confidence guess (see
// feedback_ac_clarify_dont_guess) — queryInner()'s existing null-topic
// handling (bare-industry heuristic, names-vs-count fallback, final decline)
// still runs exactly as before when this returns null.
async function matchBuiltinTopic(questionText) {
  const catalog = await getCatalogEmbeddings();
  const queryEmbedding = await getEmbedding(questionText);
  let best = null;
  let bestScore = -Infinity;
  for (const entry of catalog) {
    const score = cosineSimilarity(queryEmbedding, entry.embedding);
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  if (!best || bestScore < MATCH_THRESHOLD) return null;
  return { topic: best.topic, similarity: bestScore };
}

module.exports = { matchBuiltinTopic, MATCH_THRESHOLD, BUILTIN_CAPABILITIES };
