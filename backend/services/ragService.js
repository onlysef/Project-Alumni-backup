const { HfInference } = require('@huggingface/inference');
const { retrieveContext } = require('./retrievalService');
const EmbeddingDocument  = require('../models/EmbeddingDocument');
const { classify }       = require('./queryClassifier');
const aggregationService = require('./aggregationService');
const logger              = require('../utils/logger');
const { correctTypos }    = require('../utils/typoCorrect');

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

const LOW_SIMILARITY_RESPONSE = `I couldn't find relevant information in the graduate records.`;

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
4. Write flowing prose, not a bullet list — narrate the data, don't just repeat its formatting.`;

// Detects the small model falling back to a refusal template despite guaranteed
// data being present, so we can serve the raw (still-accurate) figures instead.
const REFUSAL_PATTERN = /don'?t have enough (data|information)|couldn'?t find (relevant )?information/i;

// Follow-ups like "how about his email?" carry no name at all — vector search
// has no way to resolve "his" to a specific person, since it only compares
// the literal query text. Only trigger the extra LLM call when a pronoun is
// actually present and there's prior conversation to resolve it against —
// standalone questions (the common case) skip this entirely, no added cost.
const PRONOUN_REFERENT_PATTERN = /\b(his|her|their|him|she|he|them|that person|this person|theirs)\b/i;

async function condenseQuestion(question, chatHistory) {
  if (!chatHistory.length || !PRONOUN_REFERENT_PATTERN.test(question)) return question;

  const recentTurns = chatHistory.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
  const messages = [
    {
      role: 'system',
      content: 'Rewrite the user\'s latest message into a fully self-contained question that does not rely on pronouns or prior conversation context — substitute in the actual name/subject from the conversation. Return ONLY the rewritten question, no explanation, no quotes.',
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

async function streamHF(messages, onToken, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let fullAnswer = '';
      const stream = hf.chatCompletionStream({
        model: CHAT_MODEL,
        provider: process.env.HF_PROVIDER || 'featherless-ai',
        messages,
        max_tokens: 512,
      });
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        fullAnswer += token;
        if (onToken && token) onToken(token);
      }
      return fullAnswer;
    } catch (err) {
      const isRateLimit = err?.statusCode === 429 || err?.statusCode === 503 || /rate|limit|overload/i.test(err?.message || '');
      if (isRateLimit && attempt < retries) {
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      throw err;
    }
  }
}

async function generateAnswer(question, chatHistory = [], filters = {}, onToken = null) {
  const startedAt  = Date.now();

  // Correct typos in domain keywords ONCE, upstream of everything — classify(),
  // detectTopic(), extractFilters(), and vector search all key off exact
  // spellings, so a single typo'd trigger word ("gradutes") used to silently
  // break routing for the rest of the pipeline. Reassigning `question` here
  // means every downstream use (including the final LLM prompt) sees the
  // corrected text; the original is kept only for logging.
  const rawQuestion = question;
  question = correctTypos(question);

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
    });
    return result;
  };

  // ── Greeting / help / unknown: answer directly, no DB or LLM call needed ──────
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

  // ── Hybrid path: try MongoDB aggregation first for statistical questions ──────
  if (queryType === 'statistical' || queryType === 'mixed') {
    const aggResult = await aggregationService.query(question);
    if (aggResult) {
      const aggText     = typeof aggResult === 'string' ? aggResult : aggResult.text;
      // Context-aware, guaranteed-answerable suggestions — built from the same
      // topic dispatch table aggregationService just used to answer this question.
      const suggestions = aggregationService.suggestFollowUps(aggResult.topic, aggResult.filters);

      // Plain counting questions ("how many X") get the pre-computed MongoDB
      // text verbatim — instant, free, and zero risk of the LLM touching a number.
      // "mixed" questions (explain/describe/summarize + statistical intent)
      // signal the user wants a written explanation, not a raw table — those get
      // phrased by Llama, but strictly from this same pre-computed text, under
      // the SYSTEM_PROMPT rule that forbids inventing or recalculating any figure.
      if (queryType === 'statistical' && aggResult.direct) {
        if (onToken) {
          for (const line of aggText.split('\n')) onToken(line + '\n');
        }
        return finish({ answer: aggText, sources: ['graduate_records'], type: 'statistics', suggestions });
      }

      const context  = `=== TRACER STUDY DATA (from structured records) ===\n${aggText}`;
      const messages = [
        { role: 'system', content: `${STATS_NARRATIVE_PROMPT}\n\nContext:\n${context}` },
        ...chatHistory.slice(-2),
        { role: 'user', content: question },
      ];

      // Buffer the narrative (no onToken yet): if the model still refuses despite
      // guaranteed-valid data, fall back to the raw MongoDB text instead of
      // streaming a false "no data" refusal to the user.
      const narrativeAnswer = await streamHF(messages, null);
      const finalAnswer = REFUSAL_PATTERN.test(narrativeAnswer.trim()) ? aggText : narrativeAnswer;

      if (onToken) {
        for (const line of finalAnswer.split('\n')) onToken(line + '\n');
      }
      return finish({ answer: finalAnswer, sources: ['graduate_records'], type: 'statistics', suggestions });
    }
  }

  // ── Fallback: chunk-scanning for employment stats (legacy / when no Graduate records) ──
  // Gated to statistical/mixed only — this used to fire on ANY question containing an
  // employment keyword regardless of classification, which intercepted genuinely
  // qualitative questions ("Why are some graduates unemployed?") before they ever
  // reached vector search, answering with an unrelated raw stats dump instead.
  if ((queryType === 'statistical' || queryType === 'mixed') && EMPLOYMENT_STATS_PATTERN.test(question)) {
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
  if ((queryType === 'statistical' || queryType === 'mixed') && LIST_ALL_PATTERN.test(question)) {
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

      const fullAnswer = await streamHF(messages, onToken);
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

  // Resolve pronoun-only follow-ups ("how about his email?") into a
  // self-contained query before embedding — otherwise vector search has no
  // way to know who "his" refers to and matches on generic textual similarity.
  const searchQuestion = await condenseQuestion(question, chatHistory);

  // Retrieve relevant chunks via vector search
  const chunks = await retrieveContext(searchQuestion, {
    topK:        filters.topK        || 10,
    sourceTypes: filters.sourceTypes || [],
  });

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

  const fullAnswer = await streamHF(messages, onToken);
  const sources = [...new Set(confidentChunks.map(c => c.source_type))];
  return finish({ answer: fullAnswer, sources, type: 'rag' });
}

module.exports = { generateAnswer };
