const { HfInference } = require('@huggingface/inference');
const { retrieveContext } = require('./retrievalService');
const EmbeddingDocument  = require('../models/EmbeddingDocument');
const { classify }       = require('./queryClassifier');
const aggregationService = require('./aggregationService');
const logger              = require('../utils/logger');
const { correctTypos }    = require('../utils/typoCorrect');
const answerCache          = require('./answerCache');

const hf = new HfInference(process.env.HF_API_KEY);
const CHAT_MODEL = process.env.HF_CHAT_MODEL || 'meta-llama/Llama-3.2-3B-Instruct';

// Minimum vector similarity score (0-1) a retrieved chunk must clear to be trusted.
// Below this, the context is considered too weak to answer from and we refuse
// rather than let the LLM stretch a loosely-related chunk into an answer.
// 0.60 is a realistic bar for BAAI/bge-base-en-v1.5 cosine similarity on short
// domain-specific text (0.80 rejected genuinely relevant chunks in practice —
// check the `rag_retrieval` log's topScore field if answers still get refused
// and tune via RAG_SIMILARITY_THRESHOLD rather than editing this default).
const SIMILARITY_THRESHOLD = Number(process.env.RAG_SIMILARITY_THRESHOLD) || 0.60;

const GREETING_RESPONSE = `Hello! I'm AC, your Graduate Tracer Study assistant. Ask me about employment rates, industries, board exam results, competency ratings, program breakdowns, or anything else in the tracer study records.`;

const HELP_RESPONSE = `I can answer questions about the Graduate Tracer Study records, such as:
- Statistics: "How many graduates are employed?", "Average salary", "Graduates per program"
- Descriptive info: "What skills do graduates commonly use?", "What companies hire graduates?"
- Demographics: employment status, industries, board exam results, further studies, competencies

I only answer using data in the tracer study records — I can't answer questions unrelated to graduate records.`;

const UNKNOWN_RESPONSE = `I'm designed to answer questions related to the Graduate Tracer Study records. I can't answer unrelated questions.`;

const OFFENSIVE_RESPONSE = `Let's keep this conversation respectful. I'm here to help with Graduate Tracer Study questions — please rephrase without offensive language.`;

const LOW_SIMILARITY_RESPONSE = `I couldn't find relevant information in the graduate records.`;

// College codes recognized in a coordinator's question, purely to word the
// college-scope refusal message accurately — see the collegeScope block in
// generateAnswer() below.
const COLLEGE_CODES = ['CPAG', 'CCS', 'COS', 'CIT', 'COE', 'CBA', 'COED', 'CASS', 'CCJE', 'CAFA'];

// Used only for narrating pre-computed MongoDB stats (the "mixed" classification
// path). Unlike SYSTEM_PROMPT, this never tells the model a refusal phrase exists
// to fall back on — the data here is guaranteed complete, so there is nothing to
// refuse. Reusing the RAG-oriented SYSTEM_PROMPT here caused small Llama models to
// occasionally parrot its "not enough data" refusal verbatim despite valid data.
const STATS_NARRATIVE_PROMPT = `You are AC, an AI assistant for the TSU (Tarlac State University) Alumni Portal, College of Computer Studies. The user asked a statistics question, and the exact answer has ALREADY been computed from the database — it is given below as complete, verified data.

Your ONLY task is to rewrite that data as a short, natural-language explanation (2-5 sentences).

STRICT RULES:
1. The data below is complete and sufficient — do NOT say you lack information or cannot answer.
2. Use ONLY the numbers given below. Never add, omit, round differently, or recalculate any figure.
3. Do not add outside knowledge, opinions, or assumptions.
4. Write flowing prose, not a bullet list — narrate the data, don't just repeat its formatting.
5. Do NOT complain that the data is missing a detail the user never asked about (e.g. location, date, department) — the data below fully answers the question exactly as asked, nothing more is needed.
6. Never start your answer with "Unfortunately" or any other hedge, and never use phrases like "does not specify/mention/provide" — state the answer directly and plainly, as a fact.
7. Never rephrase a count into a normalized ratio like "X out of every 100/1000" — state the real counts and percentages exactly as given, do not invent a proportional restatement.`;

// Detects the small model falling back to a refusal template despite guaranteed
// data being present, so we can serve the raw (still-accurate) figures instead.
// Deliberately broad — a false-positive match just falls back to the still-
// correct raw text, a harmless outcome, whereas a missed refusal phrase lets
// a wrong/self-contradictory narration reach the user (e.g. "no data
// provided for the number of BSIT graduates... however, 149..." — the model
// contradicts its own refusal but still opens with one, which the original
// narrow pattern didn't catch at all).
const REFUSAL_PATTERN = /don'?t have (enough )?(data|information)|no data (is |was )?(provided|available)|not (provided|available)\b|couldn'?t find (relevant )?(data|information)|unable to (provide|find|answer)|cannot (provide|find|answer)|there (is|are)n'?t? (any )?data|no (specific )?(data|information) (on|for|about)|does\s*n'?t\s+(specify|mention|provide|include|indicate|state)|does\s+not\s+(specify|mention|provide|include|indicate|state)|^unfortunately\b|\bonly\s+(mentions?|states?|tells?|says?)\b/i;

// Every aggregationService.js answer wraps its key figures in **bold**
// markdown — this is the consistent output format across all ~20 query
// functions. If NONE of those numbers survive into the narrated answer, the
// model either refused in unrecognized wording or hallucinated a different
// answer entirely ("locations" instead of a count) — either way, the
// narration can't be trusted even without matching REFUSAL_PATTERN.
function extractBoldNumbers(text) {
  const nums = [];
  const re = /\*\*([\d.,]+%?)\*\*/g;
  let m;
  while ((m = re.exec(text))) nums.push(m[1]);
  return nums;
}

// queryByYear()'s output only bolds the "Batch NNNN" label, not the
// count/percentage figures next to it — so extractBoldNumbers() has nothing
// to check for these answers, and a small model narrating a multi-row
// year-by-year breakdown was observed reliably INVENTING extra batch years
// that never appeared in the source data at all (e.g. asked about only
// Batch 2024-2025, the model fabricated a whole trend spanning 2009-2020).
// This is a distinct failure mode from a dropped number — the model didn't
// omit anything, it added years that don't exist in the verified data — so
// it needs its own check: any year mentioned in the narration that isn't
// also present in the source text is treated as fabricated.
function extractYears(text) {
  const years = new Set();
  const re = /\b(19\d{2}|20\d{2})\b/g;
  let m;
  while ((m = re.exec(text))) years.add(m[1]);
  return years;
}

// Follow-ups like "how about his email?" carry no name at all — vector search
// has no way to resolve "his" to a specific person, since it only compares
// the literal query text. Only trigger the extra LLM call when a pronoun is
// actually present and there's prior conversation to resolve it against —
// standalone questions (the common case) skip this entirely, no added cost.
const PRONOUN_REFERENT_PATTERN = /\b(his|her|their|him|she|he|they|them|those|that person|this person|theirs)\b/i;

// Elliptical continuations ("together with self employed", "what about
// BSIT?") name no subject of their own — read alone, "together with self
// employed" has no "what" to combine self-employed with, so filter
// extraction saw only the literal words present ("self employed") and
// answered that in isolation instead of the combined total the phrase
// actually asks for. These multi-word markers are specific enough not to
// false-positive on complete standalone questions the way single words like
// "also"/"and"/"plus" would (e.g. "employed and unemployed" is already a
// complete compound question on its own).
const CONTINUATION_PATTERN = /\b(together with|along with|combined? with|what about|how about|same for)\b/i;

async function condenseQuestion(question, chatHistory) {
  if (!chatHistory.length || (!PRONOUN_REFERENT_PATTERN.test(question) && !CONTINUATION_PATTERN.test(question))) return question;

  const recentTurns = chatHistory.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
  const messages = [
    {
      role: 'system',
      content: 'Rewrite the user\'s latest message into a fully self-contained question that does not rely on pronouns or prior conversation context — substitute in the actual name/subject from the conversation. If the latest message is an elliptical continuation (e.g. "together with X", "what about Y") that extends or combines with the previous question rather than replacing it, merge them into one combined question (e.g. previous "how many are employed" + latest "together with self employed" → "how many are employed or self-employed combined"). Return ONLY the rewritten question, no explanation, no quotes.',
    },
    { role: 'user', content: `Conversation so far:\n${recentTurns}\n\nLatest message: ${question}\n\nRewritten standalone question:` },
  ];

  try {
    const completion = await hf.chatCompletion({
      model: CHAT_MODEL,
      provider: process.env.HF_PROVIDER || 'featherless-ai',
      messages,
      max_tokens: 60,
    });
    const rewritten = completion.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
    return rewritten || question;
  } catch (err) {
    logger.warn('question_condense_failed', { question, error: err.message });
    return question; // fall back to the original question on any failure
  }
}

const LIST_ALL_PATTERN        = /\b(list|show|give|display|enumerate|who are|names of)\b.*\b(all|every|complete|full)\b.*\b(alumni|graduates?)\b|\b(all|every|complete|full)\b.*\b(alumni|graduates?)\b/i;
const STATS_QUERY_PATTERN     = /\b(how many|count|total|number of|statistics|stat|how much|tally|breakdown|per year|by year|annually)\b/i;
const EMPLOYMENT_STATS_PATTERN = /\b(employment status|employment rate|employed|unemployed|self.?employed|employment breakdown|employment data|tracer survey|tracer study|tracer result)\b/i;

// Same year range/shape aggregationService.extractFilters() uses for
// filters.yearGraduated — reused here (not imported, to keep the RAG vector-
// search path independent of the structured-query module) to narrow vector
// search to the year-tagged subset of chunks when a qualitative question
// names one ("what did 2022 graduates say about..."). Only tracer/roster/
// summary chunks carry a real metadata.year — see fileParser.js.
const QUESTION_YEAR_PATTERN = /\b((?:199\d|20[0-3]\d))\b/;

const SYSTEM_PROMPT = `You are AC, an AI assistant for the TSU (Tarlac State University) Alumni Portal, College of Computer Studies. You help administrators and coordinators understand alumni tracer study results and institutional programs.

STRICT RULES — follow these exactly:
1. Answer ONLY using information explicitly present in the provided context. Do not use your training knowledge to fill gaps.
2. If the context does not contain enough information to answer the question, respond with: "I don't have enough data in the tracer study records to answer that accurately."
3. NEVER invent or estimate statistics, percentages, counts, names, company names, or any specific facts.
4. NEVER say things like "approximately", "around", or "typically" when referring to alumni data — only state what the context explicitly says.
5. For qualitative questions (challenges, reasons, opinions, feedback), only summarize what alumni actually said in the provided context. Do not add general knowledge or assumptions.
6. Keep answers concise and factual. If the context mentions the topic but lacks detail, say so.
7. When answering questions about graduate counts or statistics by year or program, use only the pre-computed totals from the context — do not count individual records.`;

const NO_CONTEXT_RESPONSE = `I don't have enough information in the tracer study records to answer that accurately. You may try rephrasing your question, or ask about employment rates, industries, board exams, competency ratings, or program breakdowns — those I can answer directly.`;

function assembleContext(chunks) {
  const groups = {
    tracer:        [],
    employment:    [],
    imported_file: [],
    announcement:  [],
    event:         [],
    job:           [],
    partnership:   [],
    user:          [],
  };

  const MAX_CHUNK_CHARS = 1500;
  for (const chunk of chunks) {
    const key     = chunk.source_type;
    const content = chunk.content.length > MAX_CHUNK_CHARS
      ? chunk.content.slice(0, MAX_CHUNK_CHARS) + '…'
      : chunk.content;
    if (groups[key]) groups[key].push(content);
  }

  const sections = [];

  if (groups.tracer.length || groups.employment.length) {
    sections.push('=== ALUMNI TRACER & EMPLOYMENT DATA ===');
    [...groups.tracer, ...groups.employment].forEach(c => sections.push(c));
  }

  if (groups.imported_file.length) {
    sections.push('=== HISTORICAL ALUMNI RECORDS ===');
    groups.imported_file.forEach(c => sections.push(c));
  }

  if (groups.announcement.length || groups.event.length) {
    sections.push('=== PROGRAMS & EVENTS ===');
    [...groups.announcement, ...groups.event].forEach(c => sections.push(c));
  }

  if (groups.job.length || groups.partnership.length) {
    sections.push('=== JOB MARKET & PARTNERS ===');
    [...groups.job, ...groups.partnership].forEach(c => sections.push(c));
  }

  if (groups.user.length) {
    sections.push('=== ALUMNI DEMOGRAPHICS ===');
    groups.user.forEach(c => sections.push(c));
  }

  return sections.join('\n');
}

async function buildEmploymentStatsContext() {
  const docs = await EmbeddingDocument.find({ source_type: 'imported_file' })
    .select('content')
    .lean();

  const stats = {
    total: 0,
    employed: 0,
    notEmployed: 0,
    neverEmployed: 0,
    employmentType: {},
    industries: {},
    jobTitles: {},
    programs: {},
    relatedToField: { yes: 0, no: 0 },
    tookExam: { yes: 0, no: 0 },
    furtherStudies: { yes: 0, no: 0 },
  };

  // Extract value for a given column/question key from a chunk line.
  // Handles two formats:
  //   Period-separated: "Question?: Answer. Next question?: Answer."
  //   Comma-separated:  "Column: Value, Next Column: Value, ..."
  const findAnswer = (line, questionKeyword) => {
    const escaped = questionKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = line.match(new RegExp(escaped + '[^:]*:\\s*', 'i'));
    if (!m) return null;
    const after = line.slice(m.index + m[0].length);
    // Stop at the next field boundary: ", Capital..." or ". Capital..." or end-of-string
    const boundary = after.search(/[,.]\s*[A-Z]/);
    return (boundary > 0 ? after.slice(0, boundary) : after).replace(/[,.]$/, '').trim() || null;
  };

  for (const doc of docs) {
    const lines = doc.content.split('\n');
    for (const line of lines) {
      // ── Format 1: tracer parser output ─────────────────────────────────────
      const isTracerFmt = line.startsWith('Tracer study respondent:');

      // ── Format 2: raw Microsoft Forms Excel export ──────────────────────────
      // "Are you presently employed?: Yes. What is your present employment status?: Private."
      const isRawFmt = !isTracerFmt && /are you presently employed\?/i.test(line);

      // ── Format 3: generic "unknown" Excel rows ──────────────────────────────
      // fileParser.js unknown-type chunks: "ColumnHeader: Value. NextColumn: Value."
      // Detect by presence of any employment-related column header as a key.
      const isGenericFmt = !isTracerFmt && !isRawFmt && (
        /\bemployment\s*status\s*:/i.test(line) ||
        /\bare you\b.{0,50}employed[^:]*:/i.test(line) ||
        /\bwork\s*status\s*:/i.test(line) ||
        /\bemployed\s*:/i.test(line)
      );

      if (!isTracerFmt && !isRawFmt && !isGenericFmt) continue;
      stats.total++;

      if (isTracerFmt) {
        // ── Tracer format: "Tracer study respondent: Name. Field: Value. ..."
        const get = (label) => {
          const m = line.match(new RegExp(`${label}:\\s*([^.]+)\\.`));
          return m ? m[1].trim() : null;
        };

        const employed = get('Presently Employed');
        if (employed) {
          const e = employed.toLowerCase();
          if (e === 'yes') stats.employed++;
          else if (/never/i.test(e)) stats.neverEmployed++;
          else stats.notEmployed++;
        }

        const empType = get('Employment Type');
        if (empType) stats.employmentType[empType] = (stats.employmentType[empType] || 0) + 1;
        const industry = get('Industry');
        if (industry) stats.industries[industry] = (stats.industries[industry] || 0) + 1;
        const job = get('Job Title');
        if (job) stats.jobTitles[job] = (stats.jobTitles[job] || 0) + 1;
        const program = get('Program');
        if (program) stats.programs[program] = (stats.programs[program] || 0) + 1;
        const related = get('Job Related to Course');
        if (related) { if (/yes/i.test(related)) stats.relatedToField.yes++; else stats.relatedToField.no++; }
        const exam = get('Took Professional Exam');
        if (exam) { if (/yes/i.test(exam)) stats.tookExam.yes++; else stats.tookExam.no++; }
        const further = get('Pursued Further Studies');
        if (further) { if (/yes/i.test(further)) stats.furtherStudies.yes++; else stats.furtherStudies.no++; }

      } else if (isRawFmt) {
        // ── Raw MS Forms format: "Question?: Answer. Next question?: Answer."
        const employed = findAnswer(line, 'Are you presently employed?');
        if (employed) {
          const e = employed.toLowerCase();
          if (e === 'yes') stats.employed++;
          else if (/never/i.test(e)) stats.neverEmployed++;
          else stats.notEmployed++;
        }
        const empType = findAnswer(line, 'What is your present employment status?');
        if (empType) stats.employmentType[empType] = (stats.employmentType[empType] || 0) + 1;
        const industry = findAnswer(line, 'What is the primary field or industry');
        if (industry) stats.industries[industry] = (stats.industries[industry] || 0) + 1;
        const job = findAnswer(line, 'What is the title/name of your present occupation?');
        if (job) stats.jobTitles[job] = (stats.jobTitles[job] || 0) + 1;
        const program = findAnswer(line, 'What is/are the program');
        if (program) stats.programs[program] = (stats.programs[program] || 0) + 1;
        const related = findAnswer(line, 'Is your current job related to the field of study');
        if (related) { if (/yes/i.test(related)) stats.relatedToField.yes++; else stats.relatedToField.no++; }
        const exam = findAnswer(line, 'Have you taken any professional examination?');
        if (exam) { if (/yes/i.test(exam)) stats.tookExam.yes++; else stats.tookExam.no++; }
        const further = findAnswer(line, 'Have you pursued any further education');
        if (further) { if (/yes/i.test(further)) stats.furtherStudies.yes++; else stats.furtherStudies.no++; }

      } else {
        // ── Generic format: "ColumnHeader: Value. AnotherColumn: Value."
        // Tries multiple common column name conventions used in TSU tracer forms.
        const employed =
          findAnswer(line, 'Employment Status') ||
          findAnswer(line, 'Are you presently employed') ||
          findAnswer(line, 'Are you currently employed') ||
          findAnswer(line, 'Employed') ||
          findAnswer(line, 'Work Status');
        if (employed) {
          const e = employed.toLowerCase().trim();
          if (/^(yes|employed)$/.test(e) || (/employ/i.test(e) && !/un|not|never/i.test(e))) {
            stats.employed++;
          } else if (/never/i.test(e) || /never.*employ/i.test(e)) {
            stats.neverEmployed++;
          } else {
            stats.notEmployed++;
          }
        }

        const empType =
          findAnswer(line, 'Employment Type') ||
          findAnswer(line, 'Type of Employment') ||
          findAnswer(line, 'Nature of Work') ||
          findAnswer(line, 'What is your present employment status');
        if (empType) stats.employmentType[empType] = (stats.employmentType[empType] || 0) + 1;

        const industry =
          findAnswer(line, 'Industry') ||
          findAnswer(line, 'Industry Field') ||
          findAnswer(line, 'Sector') ||
          findAnswer(line, 'Field of Work') ||
          findAnswer(line, 'What is the primary field or industry');
        if (industry) stats.industries[industry] = (stats.industries[industry] || 0) + 1;

        const job =
          findAnswer(line, 'Job Title') ||
          findAnswer(line, 'Position') ||
          findAnswer(line, 'Designation') ||
          findAnswer(line, 'Occupation') ||
          findAnswer(line, 'What is the title');
        if (job) stats.jobTitles[job] = (stats.jobTitles[job] || 0) + 1;

        const program =
          findAnswer(line, 'Program') ||
          findAnswer(line, 'Course') ||
          findAnswer(line, 'Degree') ||
          findAnswer(line, 'What is/are the program');
        if (program) stats.programs[program] = (stats.programs[program] || 0) + 1;

        const related =
          findAnswer(line, 'Relevance to Course') ||
          findAnswer(line, 'Job Relevance') ||
          findAnswer(line, 'Related to Course') ||
          findAnswer(line, 'Is your current job related');
        if (related) { if (/yes/i.test(related)) stats.relatedToField.yes++; else stats.relatedToField.no++; }

        const exam =
          findAnswer(line, 'Professional Exam') ||
          findAnswer(line, 'Board Exam') ||
          findAnswer(line, 'Licensure Exam') ||
          findAnswer(line, 'Have you taken any professional');
        if (exam) { if (/yes/i.test(exam)) stats.tookExam.yes++; else stats.tookExam.no++; }

        const further =
          findAnswer(line, 'Further Studies') ||
          findAnswer(line, 'Graduate Studies') ||
          findAnswer(line, 'Have you pursued any further');
        if (further) { if (/yes/i.test(further)) stats.furtherStudies.yes++; else stats.furtherStudies.no++; }
      }
    }
  }

  if (stats.total === 0) return null;

  const topN = (obj, n = 5) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => `  - ${k}: ${v}`).join('\n');

  return `=== TRACER STUDY EMPLOYMENT STATISTICS (${stats.total} respondents) ===
Employment Status:
  - Employed: ${stats.employed} (${Math.round(stats.employed / stats.total * 100)}%)
  - Not Currently Employed: ${stats.notEmployed} (${Math.round(stats.notEmployed / stats.total * 100)}%)
  - Never Been Employed: ${stats.neverEmployed} (${Math.round(stats.neverEmployed / stats.total * 100)}%)

Employment Type Breakdown:
${topN(stats.employmentType)}

Top Industries:
${topN(stats.industries)}

Top Job Titles:
${topN(stats.jobTitles, 8)}

Programs:
${topN(stats.programs)}

Job Related to Field of Study:
  - Yes: ${stats.relatedToField.yes}
  - No: ${stats.relatedToField.no}

Took Professional Exam:
  - Yes: ${stats.tookExam.yes}
  - No: ${stats.tookExam.no}

Pursued Further Studies:
  - Yes: ${stats.furtherStudies.yes}
  - No: ${stats.furtherStudies.no}`;
}

async function buildListAllContext() {
  const rosterDocs = await EmbeddingDocument.find({ source_type: 'imported_file' })
    .select('content metadata')
    .lean();

  const names = [];
  for (const doc of rosterDocs) {
    const lines = doc.content.split('\n');
    for (const line of lines) {
      const match = line.match(/^Graduate:\s*([^.]+)/);
      if (match) names.push(match[1].trim());
    }
  }
  return { names, total: names.length };
}

async function streamHF(messages, onToken, retries = 3, maxTokens = 512, onReset = null) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let sentAny = false;
    try {
      let fullAnswer = '';
      const stream = hf.chatCompletionStream({
        model: CHAT_MODEL,
        provider: process.env.HF_PROVIDER || 'featherless-ai',
        messages,
        max_tokens: maxTokens,
      });
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        fullAnswer += token;
        if (onToken && token) { onToken(token); sentAny = true; }
      }
      return fullAnswer;
    } catch (err) {
      const isRateLimit = err?.statusCode === 429 || err?.statusCode === 503 || /rate|limit|overload/i.test(err?.message || '');
      if (isRateLimit && attempt < retries) {
        // If tokens from this failed attempt already reached the client, a
        // plain retry would stream a second full answer appended after that
        // fragment — garbled, doubled-up output, since already-flushed SSE
        // data can't be un-sent. Tell the client to discard what it's shown
        // so far before the retry starts streaming a clean answer.
        if (sentAny && onReset) onReset();
        // Was 2000ms/attempt (2s, 4s, 6s...) — a full round of retries could
        // add 6+ seconds of pure backoff on top of the request time itself.
        // 800ms/attempt keeps a real gap for the provider to recover from a
        // rate limit without piling onto already-slow responses.
        await new Promise(r => setTimeout(r, attempt * 800));
        continue;
      }
      throw err;
    }
  }
}

async function generateAnswer(question, chatHistory = [], filters = {}, onToken = null, onReset = null) {
  const startedAt  = Date.now();
  const timings    = {};

  // Wraps whatever onToken the caller passed so every downstream call site
  // (there are ~10 of them below, for each early-return type) can keep
  // calling the plain `onToken` name unchanged, while this closure captures
  // the timestamp of the first token for the latency log without needing to
  // touch every call site individually.
  let firstTokenAt = null;
  const callerOnToken = onToken;
  onToken = callerOnToken ? (token) => {
    if (firstTokenAt === null) firstTokenAt = Date.now();
    callerOnToken(token);
  } : null;

  // Correct typos in domain keywords ONCE, upstream of everything — classify(),
  // detectTopic(), extractFilters(), and vector search all key off exact
  // spellings, so a single typo'd trigger word ("gradutes") used to silently
  // break routing for the rest of the pipeline. Reassigning `question` here
  // means every downstream use (including the final LLM prompt) sees the
  // corrected text; the original is kept only for logging.
  const rawQuestion = question;
  question = correctTypos(question);

  // Resolve pronoun follow-ups ("How many are they?" right after a list of
  // unemployed alumni was shown) into a self-contained question BEFORE
  // classification/aggregation — not just before vector search as before.
  // Without this, aggregationService.query() never sees the prior turn at
  // all (it's a stateless per-question function), so "how many are they"
  // matched no filter, no topic, nothing — and confidently refused with "I
  // don't have enough data" even though the very list it should have
  // counted was still on screen. condenseQuestion() itself no-ops (returns
  // the question unchanged) unless a referent pronoun AND prior history are
  // both present, so ordinary standalone questions pay no extra cost here.
  question = await condenseQuestion(question, chatHistory);

  // A college coordinator only ever sees their own college's tracer study
  // data (see aggregationService.query()'s college-scope handling and
  // utils/collegeScope.js for why). Declared this early (rather than just
  // before the aggregation block below) so the cache lookup right after can
  // scope its key by college too — one coordinator's cached answer must
  // never be served to a different college.
  const collegeScope = filters.college || null;

  // Cache lookup on the fully-resolved, self-contained question (after typo
  // correction and pronoun/continuation resolution above) — two different
  // raw phrasings that condense to the same question correctly share one
  // cache entry. Only ever skips the classify/aggregation/vector-search/LLM
  // work below on a hit; assumes the default topK/sourceTypes every real
  // caller (aiController.chat) actually uses.
  const cached = answerCache.get(question, collegeScope);
  if (cached) {
    if (onToken) onToken(cached.answer);
    logger.info('chat_answered', {
      question, cacheHit: true, type: cached.type, sources: cached.sources,
      latencyMs: Date.now() - startedAt,
    });
    return { ...cached };
  }

  const queryType  = classify(question);
  logger.info('chat_question', {
    question,
    rawQuestion: rawQuestion !== question ? rawQuestion : undefined,
    classification: queryType,
  });

  const finish = (result) => {
    logger.info('chat_answered', {
      question,
      classification: queryType,
      type:           result.type,
      sources:        result.sources,
      latencyMs:      Date.now() - startedAt,
      timings:        { ...timings, llmFirstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null },
    });
    answerCache.set(question, collegeScope, result);
    return result;
  };

  // ── Offensive / greeting / help / unknown: answer directly, no DB or LLM call needed ──
  if (queryType === 'offensive') {
    if (onToken) onToken(OFFENSIVE_RESPONSE);
    return finish({ answer: OFFENSIVE_RESPONSE, sources: [], type: 'offensive' });
  }
  if (queryType === 'greeting') {
    if (onToken) onToken(GREETING_RESPONSE);
    return finish({ answer: GREETING_RESPONSE, sources: [], type: 'greeting' });
  }
  if (queryType === 'help') {
    if (onToken) onToken(HELP_RESPONSE);
    return finish({ answer: HELP_RESPONSE, sources: [], type: 'help' });
  }
  if (queryType === 'unknown') {
    if (onToken) onToken(UNKNOWN_RESPONSE);
    return finish({ answer: UNKNOWN_RESPONSE, sources: [], type: 'unknown' });
  }

  // collegeScope (declared above, before the cache check) means: that scope
  // only reaches Graduate documents through a Mongoose hook — it does NOT
  // reach EmbeddingDocument, which vector search reads from separately and
  // has no college tag to filter on at all (retrieveContext() now also
  // fails closed on its own if this ever changes — see retrievalService.js).
  // So when scoping is active, EVERY question (including ones that would
  // normally classify as 'qualitative' and skip straight to vector search)
  // is forced through the scoped structured-aggregation path first, and
  // stops with an explicit "no data" answer if that finds nothing — never
  // falling through to an unscoped RAG search that could surface another
  // college's embedded tracer/employment data.

  // ── Hybrid path: try MongoDB aggregation first for statistical questions ──────
  if (queryType === 'statistical' || queryType === 'mixed' || collegeScope) {
    const aggStart = Date.now();
    const aggResult = await aggregationService.query(question, { college: collegeScope });
    timings.aggregationMs = Date.now() - aggStart;
    if (aggResult) {
      const aggText     = typeof aggResult === 'string' ? aggResult : aggResult.text;
      // Context-aware, guaranteed-answerable suggestions — built from the same
      // topic dispatch table aggregationService just used to answer this question.
      const suggestions = aggregationService.suggestFollowUps(aggResult.topic, aggResult.filters);

      // A single-fact answer ("There are **149** graduates...") is already
      // one readable sentence — sending it to the LLM just to get the same
      // fact back in different words costs a full external API round trip
      // (regularly 3-14s, sometimes a timeout) for no real readability gain.
      // Plain single-fact counts are served instantly, straight from MongoDB.
      //
      // Multi-line BULLETED breakdowns (by-program, by-year, rankings — one
      // clearly-labeled data point per line) used to still get sent through
      // LLM narration on the theory that raw bullets read "awkwardly" — in
      // practice the model collapses them into one dense run-on paragraph
      // ("Among the graduates, 37 out of 59 ... In contrast, 39 out of 54
      // ... Similarly, 33 out of 48 ...") that's genuinely harder to read
      // than the bullets it started from, not easier. The already-computed
      // aggText is guaranteed complete and correctly formatted, so bulleted
      // answers skip narration entirely now, the same as isListTopic below.
      const aggLineCount   = aggText.split('\n').filter(l => l.trim()).length;
      // Dash/asterisk bullets AND numbered lists ("1. **X** — Y graduates",
      // used by ranking-style breakdowns like queryIndustry()) both count —
      // the first version of this check only looked for "- ", so numbered
      // rankings still slipped through to narration and came back as the
      // same kind of dense run-on paragraph this check exists to prevent.
      const bulletLineCount = (aggText.match(/^(?:[-*]|\d+\.)\s/gm) || []).length;
      const isListTopic = ['names', 'jobs', 'announcements', 'staff', 'appointments', 'events', 'partnerships'].includes(aggResult.topic);
      if (queryType === 'statistical' && (aggLineCount <= 1 || isListTopic || bulletLineCount >= 2)) {
        if (onToken) onToken(aggText);
        return finish({ answer: aggText, sources: ['graduate_records'], type: 'statistics', suggestions, chart: aggResult.chart || null });
      }

      const context  = `=== TRACER STUDY DATA (from structured records) ===\n${aggText}`;
      const messages = [
        { role: 'system', content: `${STATS_NARRATIVE_PROMPT}\n\nContext:\n${context}` },
        ...chatHistory.slice(-2),
        { role: 'user', content: question },
      ];

      // Buffer the narrative (no onToken yet): if the model still refuses despite
      // guaranteed-valid data, fall back to the raw MongoDB text instead of
      // streaming a false "no data" refusal to the user. The narration call
      // is also wrapped in try/catch — every statistical answer now depends
      // on this external LLM call succeeding, so a transient provider outage
      // or timeout (which does happen on the HF inference API) must still
      // resolve to the already-verified MongoDB text instead of a hard
      // error, since that data was fully computed before the LLM was ever
      // involved.
      let finalAnswer;
      const narrateStart = Date.now();
      try {
        // STATS_NARRATIVE_PROMPT only asks for 2-5 sentences, but every
        // streamHF() call defaulted to the same 512-token cap used for full
        // open-ended RAG answers — letting the model generate far more than
        // needed and directly inflating latency on every single statistical
        // question. 200 tokens comfortably covers a short paragraph while
        // cutting worst-case generation time well below the old cap.
        const narrativeAnswer = await streamHF(messages, null, 3, 200);
        timings.llmMs = Date.now() - narrateStart;
        const trimmed = narrativeAnswer.trim();
        const aggNumbers = extractBoldNumbers(aggText);
        // Only require the narration to carry over at least ONE of the
        // source numbers — a multi-figure answer legitimately narrows to its
        // main point in prose, but zero surviving numbers means the model
        // dropped the actual answer entirely (refusal or hallucination).
        const droppedTheAnswer = aggNumbers.length > 0 && !aggNumbers.some(n => trimmed.includes(n));
        // Catches the opposite failure: the model didn't drop a number, it
        // ADDED a year/batch that was never in the source data at all.
        const aggYears = extractYears(aggText);
        const fabricatedYear = aggYears.size > 0 && [...extractYears(trimmed)].some(y => !aggYears.has(y));
        finalAnswer = (REFUSAL_PATTERN.test(trimmed) || droppedTheAnswer || fabricatedYear) ? aggText : trimmed;
      } catch (err) {
        timings.llmMs = Date.now() - narrateStart;
        logger.warn('stats_narration_failed', { question, error: err.message });
        finalAnswer = aggText;
      }

      if (onToken) {
        for (const line of finalAnswer.split('\n')) onToken(line + '\n');
      }
      return finish({ answer: finalAnswer, sources: ['graduate_records'], type: 'statistics', suggestions, chart: aggResult.chart || null });
    }

    // See the collegeScope comment above — a scoped coordinator query that
    // found nothing must stop here, not fall through to an unscoped RAG
    // search that has no per-college filter at all.
    //
    // Wording matters here: a bare "I don't have data for CCS" reads as
    // "CCS itself has no data," which is FALSE and confusing to a CCS
    // coordinator who knows perfectly well their own college has records —
    // the real reason is they asked about a DIFFERENT college they aren't
    // allowed to see. Naming that other college explicitly (when the
    // question mentions one) makes the actual cause clear instead of
    // sounding like a data-completeness bug.
    if (collegeScope) {
      const askedCollege = COLLEGE_CODES.find(c => c !== collegeScope && new RegExp(`\\b${c}\\b`, 'i').test(question));
      const msg = askedCollege
        ? `As a ${collegeScope} coordinator, you can only access ${collegeScope} alumni tracer study data — I don't have access to ${askedCollege} or other colleges' records.`
        : `I don't have any tracer study data matching that within ${collegeScope} alumni records.`;
      if (onToken) onToken(msg);
      return finish({ answer: msg, sources: [], type: 'out_of_scope' });
    }
  }

  // Both legacy fallbacks below only make sense when the Graduate collection
  // itself is empty — they scan old imported-file chunks directly, bypassing
  // every filter (gender/year/program/etc.) aggregationService.query() just
  // correctly applied. Once real Graduate data exists, a null from query()
  // means "this specific cohort/filter combo has no data" (e.g. batch 2026
  // hasn't graduated yet) — a deliberate, filter-aware decision to defer to
  // RAG — NOT "go dump an unrelated, unfiltered stats blob instead." Without
  // this guard, any question merely containing "employed" got intercepted
  // here and answered with numbers that ignored the actual question asked.
  const hasGraduateData = await aggregationService.hasData();

  // ── Fallback: chunk-scanning for employment stats (legacy / when no Graduate records) ──
  // Gated to statistical/mixed only — this used to fire on ANY question containing an
  // employment keyword regardless of classification, which intercepted genuinely
  // qualitative questions ("Why are some graduates unemployed?") before they ever
  // reached vector search, answering with an unrelated raw stats dump instead.
  if (!hasGraduateData && (queryType === 'statistical' || queryType === 'mixed') && EMPLOYMENT_STATS_PATTERN.test(question)) {
    const statsContext = await buildEmploymentStatsContext();
    if (statsContext) {
      // Stream the stats directly without sending to LLM — avoids hallucination
      if (onToken) onToken(statsContext);
      return finish({ answer: statsContext, sources: ['imported_file'], type: 'statistics' });
    }
  }

  // Special case: "list all alumni" — fetch names directly.
  // Gated the same way as the EMPLOYMENT_STATS_PATTERN fallback above: the
  // second half of LIST_ALL_PATTERN (`all|every|...` + `alumni|graduates`) is
  // broad enough to match genuinely qualitative questions like "Describe the
  // challenges all graduates face" — without this gate, those got redirected
  // to a raw alumni name roster instead of reaching real RAG/vector search.
  if (!hasGraduateData && (queryType === 'statistical' || queryType === 'mixed') && LIST_ALL_PATTERN.test(question)) {
    const { names, total } = await buildListAllContext();
    if (total > 0) {
      const MAX_NAMES = 80;
      const shown    = names.slice(0, MAX_NAMES);
      const nameList = shown.map((n, i) => `${i + 1}. ${n}`).join('\n');
      const note     = total > MAX_NAMES
        ? `\n\n(Showing first ${MAX_NAMES} of ${total} total graduates on record.)`
        : '';
      const context  = `=== HISTORICAL ALUMNI RECORDS ===\nTotal graduates on record: ${total}\n\n${nameList}${note}`;

      const messages = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
        ...chatHistory.slice(-2),
        { role: 'user', content: question },
      ];

      const listStart = Date.now();
      const fullAnswer = await streamHF(messages, onToken, 3, 512, onReset);
      timings.llmMs = Date.now() - listStart;
      return finish({ answer: fullAnswer, sources: ['imported_file'], type: 'statistics' });
    }
  }

  // Fetch stats summary only for count/statistics questions
  const isStatsQuery = STATS_QUERY_PATTERN.test(question);
  let statsDoc = null;
  if (isStatsQuery) {
    statsDoc = await EmbeddingDocument.findOne({
      'metadata.sheet_type': 'stats_summary'
    }).select('content source_type').lean();
  }

  // `question` was already condensed (pronoun follow-ups resolved) near the
  // top of this function — reused here under its old name so the rest of
  // this vector-search block doesn't need touching.
  const searchQuestion = question;

  // Retrieve relevant chunks via vector search
  const questionYearMatch = searchQuestion.match(QUESTION_YEAR_PATTERN);
  const retrieval = await retrieveContext(searchQuestion, {
    topK:        filters.topK        || 10,
    sourceTypes: filters.sourceTypes || [],
    year:        questionYearMatch ? parseInt(questionYearMatch[1], 10) : null,
  });
  const chunks = retrieval.chunks;
  timings.embedMs       = retrieval.embedMs;
  timings.vectorSearchMs = retrieval.searchMs;

  // Similarity gate: drop chunks that don't clear the confidence threshold —
  // a loosely-related chunk is worse than no chunk, since the LLM will try to use it.
  const confidentChunks = chunks.filter(c => (c.score ?? 0) >= SIMILARITY_THRESHOLD);
  logger.info('rag_retrieval', {
    question,
    searchQuestion: searchQuestion !== question ? searchQuestion : undefined,
    retrieved:  chunks.length,
    confident:  confidentChunks.length,
    topScore:   chunks[0]?.score ?? null,
    threshold:  SIMILARITY_THRESHOLD,
  });

  if (chunks.length > 0 && confidentChunks.length === 0 && !statsDoc) {
    if (onToken) onToken(LOW_SIMILARITY_RESPONSE);
    return finish({ answer: LOW_SIMILARITY_RESPONSE, sources: [], type: 'rag' });
  }

  const allChunks = statsDoc
    ? [{ content: statsDoc.content, source_type: 'imported_file' }, ...confidentChunks]
    : confidentChunks;

  const context = assembleContext(allChunks);

  // If the retrieved context is empty or too thin, don't call the LLM —
  // it will hallucinate rather than admit it doesn't know.
  if (!context || context.replace(/=+[^=]+=+/g, '').trim().length < 80) {
    if (onToken) onToken(NO_CONTEXT_RESPONSE);
    return finish({ answer: NO_CONTEXT_RESPONSE, sources: [], type: 'rag' });
  }

  // A question naming ONE specific person ("what is Danica Manlapig's
  // employment status") already failed aggregationService's own Graduate
  // lookup by this point (that's why it fell through to vector search at
  // all — see query()'s personName branch). The retrieved chunks above only
  // cleared a generic topical similarity bar ("employment status" reads as
  // similar to any tracer-study chunk), NOT relevance to this specific
  // person — so the LLM, given context that never actually mentions them,
  // reliably hallucinates a confident-sounding answer using the name from
  // the question itself (e.g. inventing "Danica Manlapig is listed as an
  // Alumni record" when no such record exists). Requiring every token of
  // the named person to literally appear somewhere in the assembled context
  // catches this before the LLM call, without touching ordinary aggregate
  // questions (extractPersonName only fires on the "who is X" question
  // shape, never on topic/statistic phrasing).
  const namedPerson = aggregationService.extractPersonName(question);
  if (namedPerson) {
    const nameTokens = namedPerson.replace(/'s$/i, '').split(/\s+/).filter(Boolean);
    const allTokensPresent = nameTokens.length > 0 && nameTokens.every(t =>
      new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(context)
    );
    if (!allTokensPresent) {
      const notFoundMsg = `I don't have any record of "${namedPerson.replace(/'s$/i, '')}" in the tracer study or alumni data.`;
      if (onToken) onToken(notFoundMsg);
      return finish({ answer: notFoundMsg, sources: [], type: 'rag' });
    }
  }

  const MAX_HISTORY_CHARS = 300;
  const trimmedHistory = chatHistory.slice(-4).map(m => ({
    role:    m.role,
    content: m.content.length > MAX_HISTORY_CHARS ? m.content.slice(0, MAX_HISTORY_CHARS) + '…' : m.content,
  }));

  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
    ...trimmedHistory,
    { role: 'user', content: searchQuestion },
  ];

  // SYSTEM_PROMPT already instructs "keep answers concise," but nothing
  // enforced that — the default 512-token cap let genuinely simple
  // qualitative answers run far longer than needed. 350 still gives real
  // room for summarizing multiple alumni's feedback in one answer, just
  // without the extreme worst-case tail latency of the uncapped default.
  const ragStart = Date.now();
  const fullAnswer = await streamHF(messages, onToken, 3, 350, onReset);
  timings.llmMs = Date.now() - ragStart;

  // Extends the number/year fabrication check the stats-narration path above
  // already relies on (§ REFUSAL_PATTERN/extractBoldNumbers/extractYears) to
  // this general RAG path — but unlike that path, there's no guaranteed-
  // correct raw text to fall back to here (context is free-text alumni
  // input, not pre-computed figures), so a suspected fabrication is logged
  // for visibility rather than silently swapped for a worse answer or
  // rejecting an otherwise-good response over one heuristic.
  const contextYears = extractYears(context);
  const answerYears   = extractYears(fullAnswer);
  if (contextYears.size > 0 && [...answerYears].some(y => !contextYears.has(y))) {
    logger.warn('rag_possible_fabrication', {
      question, answerYears: [...answerYears], contextYears: [...contextYears],
    });
  }

  const sources = [...new Set(confidentChunks.map(c => c.source_type))];
  return finish({ answer: fullAnswer, sources, type: 'rag' });
}

module.exports = { generateAnswer };
