const multer        = require('multer');
const crypto        = require('crypto');
const { HfInference } = require('@huggingface/inference');
const EmbeddingDocument = require('../models/EmbeddingDocument');
const ImportedFile  = require('../models/ImportedFile');
const Graduate      = require('../models/Graduate');
const { generateAnswer }  = require('../services/ragService');
const { getEmbedding }    = require('../services/embeddingService');
const { parseFile }       = require('../utils/fileParser');
const { matchesFileSignature } = require('../utils/fileSignature');
const logger               = require('../utils/logger');
const answerCache          = require('../services/answerCache');

const hf = new HfInference(process.env.HF_API_KEY);
const CHAT_MODEL = process.env.HF_CHAT_MODEL || 'meta-llama/Llama-3.2-3B-Instruct';

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

  // Set up Server-Sent Events stream
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  try {
    // College coordinators only ever see their own college's tracer study
    // data — admins see everything. See utils/collegeScope.js for why.
    const college = req.user?.role === 'coordinator' ? req.user.college : null;

    const { sources, type, suggestions, chart } = await generateAnswer(
      question,
      history,
      { college },
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
    res.write(`data: ${JSON.stringify({ done: true, sources, type, suggestions, chart })}\n\n`);
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
            const { text, metadata } = chunks[i];
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

// ─── POST /api/ai/suggestions ────────────────────────────────────────────────
const suggestions = async (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) return res.json({ suggestions: [] });

  try {
    const completion = await hf.chatCompletion({
      model: CHAT_MODEL,
      provider: process.env.HF_PROVIDER || 'featherless-ai',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant for a university alumni portal. Generate exactly 3 short follow-up questions (max 10 words each) based on the conversation. Return ONLY a JSON array of strings, no explanation.',
        },
        { role: 'user', content: `Question: ${question}\nAnswer: ${answer.slice(0, 500)}\n\nGenerate 3 follow-up questions as a JSON array:` },
      ],
      max_tokens: 150,
    });

    const raw = completion.choices[0]?.message?.content || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    const parsed = match ? JSON.parse(match[0]) : [];
    res.json({ suggestions: parsed.slice(0, 3) });
  } catch (err) {
    console.error('suggestions error:', err.message);
    res.json({ suggestions: [] });
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
          return `Employment for ${name}${u?.course ? ' (' + u.course + ')' : ''}. Status: ${d.employment_status || ''}. Company: ${d.company_name || ''}. Job: ${d.job_title || ''}.`;
        }},
        { name: 'user', docs: alumniUsers.filter(u => u.role === 'alumni'), toText: d => `Alumni: ${d.firstName} ${d.lastName}. Course: ${d.course || ''}. Year: ${d.graduationYear || ''}.` },
      ];

      for (const col of collections) {
        for (const doc of col.docs) {
          const text = col.toText(doc);
          if (!text.trim()) continue;
          await EmbeddingDocument.deleteMany({ source_type: col.name, source_id: doc._id });
          const embedding = await getEmbedding(text);
          await EmbeddingDocument.create({ source_type: col.name, source_id: doc._id, content: text, embedding, chunk_index: 0 });
        }
      }
      console.log('[AI] Re-embed complete.');
      answerCache.bumpDataVersion();
    } catch (err) {
      console.error('[AI] Re-embed failed:', err.message);
    }
  });
};

module.exports = { chat, suggestions, reembed, ingestFile, ingestStatus, listSources, deleteSource };
