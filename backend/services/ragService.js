const { HfInference } = require('@huggingface/inference');
const { retrieveContext } = require('./retrievalService');
const EmbeddingDocument  = require('../models/EmbeddingDocument');
const { classify }       = require('./queryClassifier');
const aggregationService = require('./aggregationService');

const hf = new HfInference(process.env.HF_API_KEY);
const CHAT_MODEL = process.env.HF_CHAT_MODEL || 'meta-llama/Llama-3.2-3B-Instruct';

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
  // ── Hybrid path: try MongoDB aggregation first for statistical questions ──────
  const queryType = classify(question);
  if (queryType === 'statistical' || queryType === 'mixed') {
    const aggResult = await aggregationService.query(question);
    if (aggResult) {
      // Names queries: bypass LLM and stream the formatted list directly
      if (aggResult.direct) {
        const text = aggResult.text;
        if (onToken) {
          for (const line of text.split('\n')) onToken(line + '\n');
        }
        return { answer: text, sources: ['graduate_records'] };
      }

      const aggText  = typeof aggResult === 'string' ? aggResult : aggResult.text;
      const context  = `=== TRACER STUDY DATA (from structured records) ===\n${aggText}`;
      const messages = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
        ...chatHistory.slice(-2),
        { role: 'user', content: question },
      ];
      const fullAnswer = await streamHF(messages, onToken);
      return { answer: fullAnswer, sources: ['graduate_records'] };
    }
  }

  // ── Fallback: chunk-scanning for employment stats (legacy / when no Graduate records) ──
  if (EMPLOYMENT_STATS_PATTERN.test(question)) {
    const statsContext = await buildEmploymentStatsContext();
    if (statsContext) {
      // Stream the stats directly without sending to LLM — avoids hallucination
      if (onToken) onToken(statsContext);
      return { answer: statsContext, sources: ['imported_file'] };
    }
  }

  // Special case: "list all alumni" — fetch names directly
  if (LIST_ALL_PATTERN.test(question)) {
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
      return { answer: fullAnswer, sources: ['imported_file'] };
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

  // Retrieve relevant chunks via vector search
  const chunks = await retrieveContext(question, {
    topK:        filters.topK        || 10,
    sourceTypes: filters.sourceTypes || [],
  });

  const allChunks = statsDoc
    ? [{ content: statsDoc.content, source_type: 'imported_file' }, ...chunks]
    : chunks;

  const context = assembleContext(allChunks);

  // If the retrieved context is empty or too thin, don't call the LLM —
  // it will hallucinate rather than admit it doesn't know.
  if (!context || context.replace(/=+[^=]+=+/g, '').trim().length < 80) {
    if (onToken) onToken(NO_CONTEXT_RESPONSE);
    return { answer: NO_CONTEXT_RESPONSE, sources: [] };
  }

  const MAX_HISTORY_CHARS = 300;
  const trimmedHistory = chatHistory.slice(-4).map(m => ({
    role:    m.role,
    content: m.content.length > MAX_HISTORY_CHARS ? m.content.slice(0, MAX_HISTORY_CHARS) + '…' : m.content,
  }));

  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
    ...trimmedHistory,
    { role: 'user', content: question },
  ];

  const fullAnswer = await streamHF(messages, onToken);
  const sources = [...new Set(chunks.map(c => c.source_type))];
  return { answer: fullAnswer, sources };
}

module.exports = { generateAnswer };
