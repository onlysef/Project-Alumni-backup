const multer        = require('multer');
const { HfInference } = require('@huggingface/inference');
const EmbeddingDocument = require('../models/EmbeddingDocument');
const ImportedFile  = require('../models/ImportedFile');
const Graduate      = require('../models/Graduate');
const { generateAnswer }  = require('../services/ragService');
const { getEmbedding }    = require('../services/embeddingService');
const { parseFile }       = require('../utils/fileParser');
const logger               = require('../utils/logger');

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
    const { sources, type, suggestions } = await generateAnswer(
      question,
      history,
      {},
      (token) => {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    );

    // Final event with sources, classification type, and (when available)
    // backend-computed follow-up suggestions guaranteed answerable by aggregation.
    res.write(`data: ${JSON.stringify({ done: true, sources, type, suggestions })}\n\n`);
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

    // Create an ImportedFile record immediately so the UI can track progress
    const importedFile = await ImportedFile.create({
      file_name:   originalname,
      file_type:   ext === 'xlsx' || ext === 'xls' ? 'excel' : ext,
      status:      'processing',
      imported_by: req.user.id,
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

        // Embed each chunk and save
        let savedCount = 0;
        for (let i = 0; i < chunks.length; i++) {
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
          }
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
      const Announcement       = require('../models/Announcement');
      const Event              = require('../models/Event');
      const Job                = require('../models/Job');
      const Partnership        = require('../models/Partnership');
      const { getEmbedding }   = require('../services/embeddingService');

      const alumniUsers = await User.find().lean();
      const userMap = {};
      for (const u of alumniUsers) userMap[String(u._id)] = u;

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
        { name: 'user', docs: alumniUsers, toText: d => `Alumni: ${d.firstName} ${d.lastName}. Course: ${d.course || ''}. Year: ${d.graduationYear || ''}.` },
        { name: 'announcement', docs: await Announcement.find().lean(),         toText: d => `Announcement: ${d.title}. ${(d.content || '').slice(0, 300)}` },
        { name: 'event',        docs: await Event.find().lean(),                toText: d => `Event: ${d.name || d.title}. ${(d.description || '').slice(0, 200)}` },
        { name: 'job',          docs: await Job.find().lean(),                  toText: d => `Job: ${d.title} at ${d.company || ''}. ${(d.description || '').slice(0, 200)}` },
        { name: 'partnership',  docs: await Partnership.find().lean(),          toText: d => `Partner: ${d.partner || d.name}. ${(d.description || '').slice(0, 200)}` },
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
    } catch (err) {
      console.error('[AI] Re-embed failed:', err.message);
    }
  });
};

module.exports = { chat, suggestions, reembed, ingestFile, ingestStatus, listSources, deleteSource };
