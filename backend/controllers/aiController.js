const multer        = require('multer');
const crypto        = require('crypto');
const EmbeddingDocument = require('../models/EmbeddingDocument');
const ImportedFile  = require('../models/ImportedFile');
const Graduate      = require('../models/Graduate');
const { generateAnswer }  = require('../services/ragService');
const { getEmbedding }    = require('../services/embeddingService');
const { parseFile }       = require('../utils/fileParser');
const { matchesFileSignature } = require('../utils/fileSignature');
const logger               = require('../utils/logger');
const answerCache          = require('../services/answerCache');
const { stripInjectionPhrases } = require('../utils/injectionFilter');
const AiFlag                = require('../models/AiFlag');

// Same limit the frontend chat composer's <textarea maxLength> enforces —
// kept here too since this endpoint is reachable directly, not just through
// that form.
const MAX_QUESTION_LENGTH = 500;

// Maps fileParser's TRACER_COLUMNS field names → Graduate model fields
function mapNormalizedToGraduate(n) {
  const year = parseInt(n.date_graduated, 10);
  return {
    name:             n.full_name   || null,
    email:            n.email       || null,
    contact:          n.contact     || null,
    gender:           n.sex         || null,
    program:          n.program     || null,
    yearGraduated:    isNaN(year)   ? null : year,
    employmentStatus: n.employment_status || null,
    employmentType:   n.employment_type   || null,
    workLocation:     n.work_location     || null,
    jobTitle:         n.job_title         || null,
    companyName:      n.company           || null,
    industry:         n.industry          || null,
    jobRelated:       n.relevance         || null,
    yearsInJob:       n.job_duration      || null,
    tookExam:         n.board_exam        || null,
    furtherEducation: n.further_studies   || null,
    furtherTraining:  n.trainings         || null,
    hasPromotion:     n.promoted          || null,
    competencies: {
      technicalSkills:   n.comp_technical          || null,
      communication:     n.comp_communication      || null,
      problemSolving:    n.comp_problem_solving     || null,
      projectManagement: n.comp_project_management  || null,
      teamwork:          n.comp_teamwork            || null,
      adaptability:      n.comp_adaptability        || null,
      workLifeBalance:   n.comp_work_life_balance   || null,
      criticalThinking:  n.comp_critical_thinking   || null,
    },
  };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Accepts { question, history } and streams back tokens via SSE.
const chat = async (req, res) => {
  const { question, history = [] } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ message: 'Question is required.' });
  }
  // Mirrors the frontend composer's maxLength — that only stops TYPING past
  // the limit (a direct API call bypasses it entirely), so the real
  // enforcement has to live here. An overly long message is also just bad
  // for this system specifically: it gets interpolated into the LLM prompt
  // alongside retrieved context, so an unbounded question risks blowing the
  // model's context window or degrading answer quality long before any rate
  // limit would ever kick in.
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ message: `Question is too long (max ${MAX_QUESTION_LENGTH} characters).` });
  }

  // Set up Server-Sent Events stream
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  try {
    // College coordinators only ever see their own college's tracer study
    // data — admins see everything. See utils/collegeScope.js for why.
    const college = req.user?.role === 'coordinator' ? req.user.college : null;

    const { sources, type, suggestions, chart, charts, sampleSize, lowConfidence } = await generateAnswer(
      question,
      history,
      {
        college,
        userName: req.user?.firstName || null,
        userRole: req.user?.role || null,
        // Distinct from `college` above (which is the college-SCOPE filter —
        // null for admins on purpose, since they aren't restricted to one).
        // The "who am I" answer needs the account's actual profile college
        // regardless of role, so it's threaded through separately.
        userCollege: req.user?.college || null,
      },
      (token) => {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      },
      () => {
        // A partial answer already reached the client and is being retried
        // from scratch — tell it to discard that fragment before more
        // tokens arrive, instead of appending a second answer onto it.
        res.write(`data: ${JSON.stringify({ reset: true })}\n\n`);
      }
    );

    // Final event with sources, classification type, (when available)
    // backend-computed follow-up suggestions guaranteed answerable by
    // aggregation, and (when available) chart data for an inline graph.
    res.write(`data: ${JSON.stringify({ done: true, sources, type, suggestions, chart, charts, sampleSize, lowConfidence })}\n\n`);
  } catch (err) {
    logger.error('chat_request_failed', { question, error: err });
    const isRateLimit = err?.status === 429 || err?.status === 413;
    const msg = isRateLimit
      ? 'Too many requests — please wait a few seconds and try again.'
      : 'Failed to generate answer. Please try again.';
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  } finally {
    res.end();
  }
};

// ─── POST /api/ai/ingest ──────────────────────────────────────────────────────
// Upload a file (Excel, DOCX, PDF) and ingest it into the vector store.
const ingestFile = [
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    const { originalname, buffer } = req.file;
    const ext = originalname.split('.').pop().toLowerCase();

    const allowedExts = ['xlsx', 'xls', 'csv', 'docx', 'pdf'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ message: `Unsupported file type: .${ext}` });
    }
    if (!matchesFileSignature(buffer, ext)) {
      return res.status(400).json({ message: `File content doesn't match a .${ext} file.` });
    }

    // Re-uploading the exact same file (even under a different name) used to
    // silently double-ingest every row into Graduate/EmbeddingDocument —
    // duplicate chunks in RAG search and duplicate respondents skewing every
    // dashboard stat that reads from Graduate. Hash the raw bytes and block
    // a repeat of anything that already finished ingesting successfully —
    // also block a repeat while the FIRST upload is still 'processing'
    // (ingestion runs in the background via setImmediate below and can take
    // a while), otherwise two near-simultaneous uploads of the same file
    // both pass this check before either reaches 'done'.
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const existing = await ImportedFile.findOne({ content_hash: contentHash, status: { $in: ['done', 'processing'] } });
    if (existing) {
      const message = existing.status === 'processing'
        ? `This file is already being imported (started ${new Date(existing.createdAt).toLocaleString()}). Please wait for it to finish.`
        : `This file was already imported as "${existing.file_name}" on ${existing.ingested_at ? new Date(existing.ingested_at).toLocaleDateString() : new Date(existing.createdAt).toLocaleDateString()}. Delete that import first if you need to re-ingest it.`;
      return res.status(409).json({ message });
    }

    // Create an ImportedFile record immediately so the UI can track progress
    const importedFile = await ImportedFile.create({
      file_name:    originalname,
      file_type:    ext === 'xlsx' || ext === 'xls' ? 'excel' : ext,
      status:       'processing',
      content_hash: contentHash,
      imported_by:  req.user.id,
    });

    res.json({ message: 'File received, ingestion started.', file_id: importedFile._id });

    // Run ingestion asynchronously after responding
    setImmediate(async () => {
      try {
        const { chunks, rawRows, sheet_type, row_count, file_type } = await parseFile(buffer, originalname);

        if (chunks.length === 0) {
          await ImportedFile.findByIdAndUpdate(importedFile._id, {
            status: 'failed',
            error_message: 'No parseable content found in file.',
          });
          return;
        }

        // Embed each chunk and save — bounded concurrency (a handful of HF
        // embedding calls in flight at once) instead of one at a time.
        // Ingestion of a few-hundred-row tracer file used to mean a few
        // hundred sequential network round trips; each worker below claims
        // the next unclaimed index, so chunk_index/ordering per document is
        // unaffected even though completion order across workers isn't.
        let savedCount = 0;
        let lastEmbedError = null;
        const EMBED_CONCURRENCY = 5;
        let nextChunkIndex = 0;

        async function embedWorker() {
          while (nextChunkIndex < chunks.length) {
            const i = nextChunkIndex++;
            const { text: rawText, metadata } = chunks[i];
            // Indirect prompt injection defense — an imported tracer/employment
            // sheet is free text an alumnus (or whoever filled the form) typed,
            // not a trusted source. Without this, an injection phrase sitting in
            // one respondent's row gets embedded once and can resurface inside
            // any future user's LLM context indefinitely — the same class of
            // attack sanitizePrompt.js only ever covered for the live chat
            // question, never for ingested content. Stripped before BOTH the
            // embedding call and the stored `content` (the text that actually
            // reaches the LLM's context later), not just one or the other.
            const { cleaned: text, injectionDetected } = stripInjectionPhrases(rawText);
            if (injectionDetected) {
              logger.warn('ingest_injection_stripped', { file: originalname, chunkIndex: i });
              AiFlag.create({
                type: 'injection',
                detail: rawText.slice(0, 300),
                sourceType: 'ingest_file',
              }).catch(() => {});
            }
            try {
              const embedding = await getEmbedding(text);
              await EmbeddingDocument.create({
                source_type: 'imported_file',
                file_id:     importedFile._id,
                content:     text,
                metadata:    { ...metadata, file_name: originalname, file_type },
                embedding,
                chunk_index: i,
              });
              savedCount++;
            } catch (embedErr) {
              console.error(`Embedding failed for chunk ${i} of ${originalname}:`, embedErr.message);
              lastEmbedError = embedErr.message;
            }
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(EMBED_CONCURRENCY, chunks.length) }, embedWorker)
        );

        // Every chunk parsed fine but every embedding call failed (e.g. the
        // HF inference quota is exhausted) — this used to still report
        // status "done" with chunk_count 0, which reads as a successfully
        // ingested-but-empty file in the UI ("READY · 0 chunks") instead of
        // the actual problem: nothing got embedded, so this file is
        // invisible to every RAG search.
        if (chunks.length > 0 && savedCount === 0) {
          await ImportedFile.findByIdAndUpdate(importedFile._id, {
            status: 'failed',
            error_message: `All ${chunks.length} chunks failed to embed: ${lastEmbedError || 'unknown error'}`,
          });
          return;
        }

        // Save structured Graduate records for aggregation queries.
        // Only rows that actually identify a person (name or program present)
        // are kept — sheet-type detection can misclassify summary/aggregate
        // tables (e.g. "Employment Status: Employed, f: 104, %: 91%") as
        // individual tracer rows, which would otherwise insert phantom
        // "Unknown Graduate" records and inflate every aggregation statistic.
        if (rawRows && rawRows.length > 0) {
          const gradDocs = rawRows
            .map((r, idx) => ({
              fileId:    importedFile._id,
              rowIndex:  idx + 1,
              data:      r.raw,
              ...mapNormalizedToGraduate(r.normalized),
            }))
            .filter(g => g.name || g.program);
          const skipped = rawRows.length - gradDocs.length;

          await Graduate.deleteMany({ fileId: importedFile._id });
          if (gradDocs.length > 0) await Graduate.insertMany(gradDocs, { ordered: false });
          console.log(`[AI] Saved ${gradDocs.length} Graduate records for ${originalname}${skipped ? ` (skipped ${skipped} rows with no identifiable name/program)` : ''}.`);
        }

        await ImportedFile.findByIdAndUpdate(importedFile._id, {
          status:      'done',
          sheet_type,
          chunk_count: savedCount,
          raw_row_count: row_count,
          ingested_at: new Date(),
        });

        console.log(`[AI] Ingested ${originalname}: ${savedCount} chunks.`);
        // New Graduate/EmbeddingDocument data exists now — any cached answer
        // computed before this point may no longer be accurate.
        answerCache.bumpDataVersion();
      } catch (err) {
        console.error(`[AI] Ingestion failed for ${originalname}:`, err.message);
        await ImportedFile.findByIdAndUpdate(importedFile._id, {
          status:        'failed',
          error_message: err.message,
        });
      }
    });
  },
];

// ─── GET /api/ai/ingest/status ────────────────────────────────────────────────
// Poll the status of a specific ingestion job.
const ingestStatus = async (req, res) => {
  try {
    const file = await ImportedFile.findById(req.params.id).select('-__v');
    if (!file) return res.status(404).json({ message: 'File not found.' });
    res.json(file);
  } catch (err) {
    console.error('aiController.ingestStatus error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ─── GET /api/ai/sources ─────────────────────────────────────────────────────
// List all imported files.
const listSources = async (req, res) => {
  try {
    const files = await ImportedFile.find()
      .sort({ createdAt: -1 })
      .populate('imported_by', 'firstName lastName')
      .select('-__v');
    res.json({ files });
  } catch (err) {
    console.error('aiController.listSources error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ─── DELETE /api/ai/sources/:id ──────────────────────────────────────────────
// Remove an imported file and all its embedding chunks.
const deleteSource = async (req, res) => {
  try {
    const file = await ImportedFile.findByIdAndDelete(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found.' });

    const { deletedCount } = await EmbeddingDocument.deleteMany({ file_id: req.params.id });
    await Graduate.deleteMany({ fileId: req.params.id });
    answerCache.bumpDataVersion();
    res.json({ message: `${file.file_name} removed. ${deletedCount} chunks deleted.` });
  } catch (err) {
    console.error('aiController.deleteSource error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ─── POST /api/ai/reembed ─────────────────────────────────────────────────────
const reembed = async (req, res) => {
  res.json({ message: 'Re-embedding started in background.' });

  setImmediate(async () => {
    try {
      const mongoose = require('mongoose');
      const EmbeddingDocument = require('../models/EmbeddingDocument');
      const TracerStudyResponse = require('../models/TracerStudyResponse');
      const AlumniEmployment   = require('../models/AlumniEmployment');
      const User               = require('../models/User');
      const { getEmbedding }   = require('../services/embeddingService');

      const alumniUsers = await User.find().lean();
      const userMap = {};
      for (const u of alumniUsers) userMap[String(u._id)] = u;

      // Scoped to tracer study data only (per explicit product decision — the
      // AC assistant answers Graduate Tracer Study questions, not portal-wide
      // ones). Announcements/events/jobs/partnerships used to be embedded
      // here too; removed along with their aggregationService.js fast-path
      // handlers so those topics can't leak back in through vector search.
      const collections = [
        { name: 'tracer', docs: await TracerStudyResponse.find().lean(), toText: d => {
          const u = userMap[String(d.alumni_id)];
          const name = u ? `${u.firstName} ${u.lastName}` : 'Unknown Alumni';
          return `Tracer study for ${name}${u?.course ? ' (' + u.course + ')' : ''}. Status: ${d.employmentStatus || ''}. Occupation: ${d.occupationTitle || ''}. Industry: ${d.industryField || ''}.`;
        }},
        { name: 'employment', docs: await AlumniEmployment.find().lean(), toText: d => {
          const u = userMap[String(d.alumni_id)];
          const name = u ? `${u.firstName} ${u.lastName}` : 'Unknown Alumni';
          let text = `Employment for ${name}${u?.course ? ' (' + u.course + ')' : ''}. Status: ${d.employment_status || ''}. Company: ${d.company_name || ''}. Job: ${d.job_title || ''}.`;
          // reason_unemployed is the only field on this model that actually
          // carries alumni-authored qualitative text (why they're
          // unemployed — job-hunting struggles, further studies, etc.).
          // Every other qualitative-sounding question ("what challenges do
          // alumni face") had nothing to retrieve without this, because the
          // rest of the schema is pure structured status/company/job data.
          if (d.reason_unemployed) text += ` Reason unemployed: ${d.reason_unemployed}.`;
          if (d.industry) text += ` Industry: ${d.industry}.`;
          return text;
        }},
        { name: 'user', docs: alumniUsers.filter(u => u.role === 'alumni'), toText: d => `Alumni: ${d.firstName} ${d.lastName}. Course: ${d.course || ''}. Year: ${d.graduationYear || ''}.` },
      ];

      for (const col of collections) {
        for (const doc of col.docs) {
          // Live tracer/employment text (esp. reason_unemployed, a free-text
          // field alumni type themselves) gets the same indirect-injection
          // stripping as imported-file chunks above — same reasoning: this
          // text is embedded once and can resurface in any future user's LLM
          // context, so it needs the same defense as the ingestFile path.
          const { cleaned: text, injectionDetected } = stripInjectionPhrases(col.toText(doc));
          if (injectionDetected) {
            logger.warn('ingest_injection_stripped', { sourceType: col.name, sourceId: String(doc._id) });
            AiFlag.create({
              type: 'injection',
              detail: col.toText(doc).slice(0, 300),
              sourceType: 'ingest_tracer',
            }).catch(() => {});
          }
          // Always clear any embedding left from a previous run first — a
          // record that used to have real data (or used to exist) but no
          // longer qualifies below must not leave a stale chunk behind.
          await EmbeddingDocument.deleteMany({ source_type: col.name, source_id: doc._id });
          // AlumniEmployment.find() returns one record per alumnus even
          // before they've ever touched the Employment Details form — those
          // rows are all identical boilerplate ("Status: Not Yet Updated.
          // Company: N/A. Job: ."). Embedding hundreds of byte-identical
          // placeholder chunks let them dominate $vectorSearch's top-K for
          // almost any employment/job question (they score deceptively high
          // on generic employment vocabulary), crowding out real answers —
          // see the "Not Yet Updated" placeholder in computeProfileCompleteness
          // (alumniController.js) for the same "not real data" definition.
          const isPlaceholderEmployment = col.name === 'employment' && doc.employment_status === 'Not Yet Updated';
          if (!text.trim() || isPlaceholderEmployment) continue;
          const embedding = await getEmbedding(text);
          await EmbeddingDocument.create({ source_type: col.name, source_id: doc._id, content: text, embedding, chunk_index: 0 });
        }
        // Garbage-collect orphans: the loop above only ever deletes-then-
        // recreates embeddings for source_ids that still exist in col.docs.
        // A record that was deleted (or replaced under a new _id) outright
        // — not merely edited — leaves its old embedding behind forever,
        // since no current doc's _id will ever again match it. Sweep any
        // embedding of this source_type whose source_id isn't in the
        // current live set.
        const liveIds = col.docs.map(d => d._id);
        await EmbeddingDocument.deleteMany({ source_type: col.name, source_id: { $nin: liveIds } });
      }
      console.log('[AI] Re-embed complete.');
      answerCache.bumpDataVersion();
    } catch (err) {
      console.error('[AI] Re-embed failed:', err.message);
    }
  });
};

// ─── GET /api/ai/flags ────────────────────────────────────────────────────────
// Admin-reviewable queue for injection detections, RAG fabrication checks,
// and questions AC couldn't actually answer — see models/AiFlag.js.
const getFlags = async (req, res) => {
  try {
    const filter = {};
    if (req.query.reviewed !== undefined) filter.reviewed = req.query.reviewed === 'true';
    if (req.query.type) filter.type = req.query.type;
    const flags = await AiFlag.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('source', 'firstName lastName')
      .populate('reviewedBy', 'firstName lastName');
    // Counts-by-type on the SAME response (not a separate endpoint) — always
    // scoped to unreviewed regardless of the `type` filter above, so the
    // frontend can show "3 injection · 1 fabrication · 42 unanswered" as a
    // stable overview even while a specific type is being viewed.
    const counts = await AiFlag.aggregate([
      { $match: { reviewed: false } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    res.json({ flags, counts: Object.fromEntries(counts.map(c => [c._id, c.count])) });
  } catch (err) {
    console.error('aiController.getFlags error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ─── PATCH /api/ai/flags/:id ──────────────────────────────────────────────────
// Optional { note } in the body — a free-text explanation of what was wrong
// (or that this was a false positive), saved as adminNote alongside marking
// the flag reviewed. Trimmed and length-capped defensively (this is
// free-typed admin input stored back into the DB, not itself narrated by the
// AI, but still worth bounding).
const reviewFlag = async (req, res) => {
  try {
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : undefined;
    const update = { reviewed: true, reviewedBy: req.user.id, reviewedAt: new Date() };
    if (note) update.adminNote = note;
    const flag = await AiFlag.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!flag) return res.status(404).json({ message: 'Flag not found.' });
    res.json({ flag });
  } catch (err) {
    console.error('aiController.reviewFlag error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { chat, reembed, ingestFile, ingestStatus, listSources, deleteSource, getFlags, reviewFlag };
