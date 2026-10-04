const xlsx    = require('xlsx');
const mammoth = require('mammoth');
const _pdfParseModule = require('pdf-parse');
const pdfParse = typeof _pdfParseModule === 'function' ? _pdfParseModule : _pdfParseModule.default;

// ─── Column name normalizer ────────────────────────────────────────────────────
// Excel headers may have varying casing/spacing; normalize to a known key set.
const ROSTER_COLUMNS = {
  'student id':    'student_id',
  'studentid':     'student_id',
  'last name':     'last_name',
  'lastname':      'last_name',
  'first name':    'first_name',
  'firstname':     'first_name',
  'middle name':   'middle_name',
  'middlename':    'middle_name',
  'sex':           'sex',
  'gender':        'sex',
  'date graduated':'date_graduated',
  'dategraduated': 'date_graduated',
  'program':       'program',
  'course':        'program',
  'column1':       'specialization',
  'specialization':'specialization',
  'year granted':  'year_granted',
  'yeargranted':   'year_granted',
  'date of birth': 'date_of_birth',
  'dateofbirth':   'date_of_birth',
};

const TRACER_COLUMNS = {
  // Name
  'name':                       'full_name',
  'full name':                  'full_name',
  'fullname':                   'full_name',
  'respondent':                 'full_name',
  'respondent name':            'full_name',
  'full name ':                 'full_name', // trailing space variant

  // Contact
  'contact number':             'contact',
  'contact':                    'contact',
  'mobile':                     'contact',
  'phone':                      'contact',
  'mobile number':              'contact',
  'email address':              'email',
  'email':                      'email',

  // Demographics
  'gender':                     'sex',
  'sex':                        'sex',

  // Program / Course
  'what is/are the program/s you completed at tsu-ccs?': 'program',
  'program':                    'program',
  'course':                     'program',

  // Graduation year
  'what is the year of your graduation?': 'date_graduated',
  'year of graduation':         'date_graduated',
  'year graduated':             'date_graduated',
  'date graduated':             'date_graduated',

  // Employment (Google Form question style)
  'are you presently employed?':                        'employment_status',
  'present employment status':                          'employment_status',
  'current employment status':                          'employment_status',
  'employment status':                                  'employment_status',
  'presently employed':                                 'employment_status',

  'what is your present employment status?':            'employment_type',
  'type of employment':                                 'employment_type',
  'employment type':                                    'employment_type',
  'nature of work':                                     'employment_type',

  'what is the title/name of your present occupation? (ex. front-end developer, software engineer)': 'job_title',
  'what is the title/name of your present occupation?': 'job_title',
  'job title':                  'job_title',
  'position':                   'job_title',
  'designation':                'job_title',
  'occupation':                 'job_title',

  'what is the primary field or industry of the company where you are currently employed?': 'industry',
  'industry':                   'industry',
  'industry field':             'industry',
  'sector':                     'industry',

  'where is your current place of work?':               'work_location',
  'work location':              'work_location',
  'place of work':              'work_location',
  'city':                       'work_location',

  'is your current job related to the field of study of your degree?': 'relevance',
  'relevance to course':        'relevance',
  'job relevance':              'relevance',
  'related to course':          'relevance',
  'job related to course':      'relevance',

  'how long have you been in your current job?':        'job_duration',
  'years in current job':                               'job_duration',

  'if not currently employed or never been employed, please indicate the reason for not being employed yet (you may select more than one option):': 'reason_unemployed',
  'reason for not being employed':                      'reason_unemployed',

  // Salary
  'monthly salary':             'salary',
  'salary':                     'salary',
  'income':                     'salary',
  'monthly income':             'salary',

  // Board exam
  'have you taken any professional examination? (e.g. prc board examination and civil service examination)': 'board_exam',
  'professional exam':          'board_exam',
  'board exam':                 'board_exam',
  'licensure exam':             'board_exam',
  'took professional exam':     'board_exam',
  'what professional examination did you take? please do not abbreviate.': 'board_exam_name',

  // Further studies
  'have you pursued any further education after graduating?':           'further_studies',
  'further studies':            'further_studies',
  'graduate studies':           'further_studies',
  'pursued further studies':    'further_studies',
  'if yes, please specify the type of education you have pursued.':    'further_studies_details',

  // Trainings
  'have you pursued any trainings after graduating?':                  'trainings',
  'pursued trainings':                                                 'trainings',
  'if yes, please specify the type of training you pursued.':          'trainings_details',

  // Promotion / Accomplishments
  'have you been promoted in your current job?':                       'promoted',
  'promoted':                                                          'promoted',
  'have you achieved any significant accomplishments in your current job?': 'accomplishments',
  'have you received any professional certifications since graduation?': 'certifications',

  // Competency self-ratings (Likert / text scale)
  'technical skills':                'comp_technical',
  'communication skills':            'comp_communication',
  'communication':                   'comp_communication',
  'problem-solving skills':          'comp_problem_solving',
  'problem solving skills':          'comp_problem_solving',
  'problem solving':                 'comp_problem_solving',
  'project management':              'comp_project_management',
  'teamwork and collaboration':      'comp_teamwork',
  'teamwork':                        'comp_teamwork',
  'adaptability':                    'comp_adaptability',
  'work-life balance':               'comp_work_life_balance',
  'work life balance':               'comp_work_life_balance',
  'critical thinking skills':        'comp_critical_thinking',
  'critical thinking':               'comp_critical_thinking',
};

const SUMMARY_COLUMNS = {
  'year':                    'year',
  'number of graduated':     'graduated',
  'numberofgraduated':       'graduated',
  'total number of traced':  'traced',
  'totalnumberoftraced':     'traced',
  'number of gradutes not':  'not_traced',
  'number of graduates not': 'not_traced',
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().trim();
}

/**
 * Detect whether an Excel sheet is a graduate roster, tracer study, or summary.
 */
function detectSheetType(headers) {
  const normalized = headers.map(normalizeHeader);
  const hasRoster  = normalized.some(h => ROSTER_COLUMNS[h] === 'last_name' || ROSTER_COLUMNS[h] === 'student_id');
  const hasSummary = normalized.some(h => SUMMARY_COLUMNS[h] === 'graduated' || SUMMARY_COLUMNS[h] === 'traced');
  const hasTracer  = normalized.some(h => TRACER_COLUMNS[h] === 'employment_status' || TRACER_COLUMNS[h] === 'company' || TRACER_COLUMNS[h] === 'job_title');
  if (hasSummary) return 'summary';
  if (hasTracer)  return 'tracer';
  if (hasRoster)  return 'roster';
  return 'unknown';
}

/**
 * Convert a raw Excel row object (keyed by original header) into a normalized object.
 */
function normalizeRow(rawRow, columnMap) {
  const out = {};
  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normalized = normalizeHeader(rawKey);
    const mapped     = columnMap[normalized];
    if (mapped) out[mapped] = value;
  }
  return out;
}

/**
 * Build a plain-text sentence for a roster row (one graduate).
 */
function rosterRowToText(row, year) {
  const name  = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ');
  const parts = [`Graduate: ${name}`];
  if (row.student_id)    parts.push(`Student ID: ${row.student_id}`);
  if (row.program)       parts.push(`Program: ${row.program}`);
  if (row.specialization && row.specialization !== row.program) {
    parts.push(`Specialization: ${row.specialization}`);
  }
  if (row.date_graduated) parts.push(`Date Graduated: ${row.date_graduated}`);
  else if (year)          parts.push(`Graduation Year: ${year}`);
  if (row.sex)            parts.push(`Sex: ${row.sex}`);
  return parts.join('. ') + '.';
}

/**
 * Build a plain-text sentence for a tracer study row (one respondent).
 */
function tracerRowToText(row, year) {
  const name = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ')
    || row.full_name
    || 'Unknown Graduate';
  const parts = [`Tracer study respondent: ${name}`];
  if (row.student_id)            parts.push(`Student ID: ${row.student_id}`);
  if (row.contact)               parts.push(`Contact Number: ${row.contact}`);
  if (row.email)                 parts.push(`Email: ${row.email}`);
  if (row.sex)                   parts.push(`Gender: ${row.sex}`);
  if (row.program)               parts.push(`Program: ${row.program}`);
  if (row.date_graduated)        parts.push(`Year of Graduation: ${row.date_graduated}`);
  else if (year)                 parts.push(`Graduation Year: ${year}`);
  if (row.employment_status)     parts.push(`Presently Employed: ${row.employment_status}`);
  if (row.employment_type)       parts.push(`Employment Type: ${row.employment_type}`);
  if (row.company)               parts.push(`Company/Employer: ${row.company}`);
  if (row.job_title)             parts.push(`Job Title: ${row.job_title}`);
  if (row.industry)              parts.push(`Industry: ${row.industry}`);
  if (row.work_location)         parts.push(`Work Location: ${row.work_location}`);
  if (row.salary)                parts.push(`Monthly Salary: ${row.salary}`);
  if (row.relevance)             parts.push(`Job Related to Course: ${row.relevance}`);
  if (row.job_duration)          parts.push(`Years in Current Job: ${row.job_duration}`);
  if (row.reason_unemployed)     parts.push(`Reason Not Employed: ${row.reason_unemployed}`);
  // Multi-select live-submission reasons (distinct from the free-text/bulk-
  // import reason_unemployed above) — see Graduate.js's own comment on
  // reasonsNotEmployed for why this exists.
  if (Array.isArray(row.reasons_not_employed) && row.reasons_not_employed.length) {
    parts.push(`Reasons Not Employed: ${row.reasons_not_employed.join(', ')}`);
  }
  if (row.board_exam)            parts.push(`Took Professional Exam: ${row.board_exam}`);
  if (row.board_exam_name)       parts.push(`Exam Taken: ${row.board_exam_name}`);
  if (row.further_studies)       parts.push(`Pursued Further Studies: ${row.further_studies}`);
  if (row.further_studies_details) parts.push(`Further Studies Details: ${row.further_studies_details}`);
  if (row.trainings)             parts.push(`Pursued Trainings: ${row.trainings}`);
  if (row.training_type)         parts.push(`Training Type: ${row.training_type}`);
  if (row.promoted)              parts.push(`Promoted: ${row.promoted}`);
  if (row.accomplishments)       parts.push(`Significant Accomplishment: ${row.accomplishments}`);
  if (row.certifications)        parts.push(`Professional Certifications: ${row.certifications}`);
  return parts.join('. ') + '.';
}

/**
 * Build a plain-text sentence for a tracer summary row.
 */
function summaryRowToText(row) {
  if (!row.year || !row.graduated) return null;
  return `In ${row.year}, TSU-CCS had ${row.graduated} graduates. ` +
         `Of these, ${row.traced || 0} were reached through the tracer study and ` +
         `${row.not_traced || (row.graduated - (row.traced || 0))} were not traced.`;
}

// ─── Excel / CSV parser ───────────────────────────────────────────────────────
/**
 * Parse an Excel or CSV buffer.
 * Returns: { chunks: [{text, metadata}], sheet_type, row_count }
 */
// Column map used for Graduate record extraction on ALL sheet types
const TRACER_COLUMN_MAP = { ...ROSTER_COLUMNS, ...TRACER_COLUMNS };

function parseExcel(buffer, fileName) {
  const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  const allChunks = [];
  const allRawRows = []; // normalized rows for Graduate record creation
  let   totalRows = 0;
  let   detectedType = 'unknown';

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows  = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) continue;

    const headers  = Object.keys(rows[0]);
    const type     = detectSheetType(headers);
    if (type === 'unknown') {
      // Fallback: treat each row as a plain text chunk, skip Google Form metadata columns
      const SKIP_COLUMNS = new Set(['id', 'response id', 'responseid', 'start time', 'starttime', 'completion time', 'completiontime', 'last modified time', 'lastmodifiedtime', 'collector id', 'collectorid', 'ip address', 'ipaddress', 'respondent id', 'respondentid', 'name']);
      for (const rawRow of rows) {
        const text = Object.entries(rawRow)
          .filter(([k, v]) => v !== '' && v != null && !SKIP_COLUMNS.has(k.toLowerCase().trim()))
          .map(([k, v]) => `${k}: ${v}`)
          .join('. ');
        if (!text.trim()) continue;
        allChunks.push({
          text,
          metadata: { sheet_name: sheetName, sheet_type: 'raw', year: null, program: '', specialization: '' },
        });
        // Still extract normalized fields for Graduate records
        allRawRows.push({ raw: rawRow, normalized: normalizeRow(rawRow, TRACER_COLUMN_MAP), sheet_name: sheetName });
        totalRows++;
      }
      continue;
    }

    // Use first non-unknown sheet type as overall file type
    if (detectedType === 'unknown') detectedType = type;

    // Infer year from sheet name (e.g. "graduates 2021" → 2021)
    const yearMatch = sheetName.match(/\d{4}/);
    const sheetYear = yearMatch ? parseInt(yearMatch[0]) : null;

    const columnMap = type === 'tracer'
      ? { ...ROSTER_COLUMNS, ...TRACER_COLUMNS }
      : type === 'roster' ? ROSTER_COLUMNS : SUMMARY_COLUMNS;
    // Tracer rows are one per chunk (not batched) — batching 3 respondents
    // into a single newline-joined chunk previously caused a documented live
    // bug (ragService.js's isolatePerson() comment): one alumnus's job title
    // and tenure bled into an answer correctly labeled with a DIFFERENT,
    // similarly-processed alumnus's name. isolatePerson() only mitigates this
    // on the person-lookup path — a general qualitative question ("what
    // challenges do unemployed graduates face") still retrieved the full
    // blended chunk with no isolation. One row per chunk costs more embedding
    // calls at ingest time (a one-time cost, already bounded by
    // EMBED_CONCURRENCY) in exchange for removing that bleed risk from every
    // qualitative question going forward. Roster/summary rows are lower-risk
    // (short structured listings, not free-text per-person narrative) and
    // stay batched.
    const BATCH_SIZE = type === 'tracer' ? 1 : 15;
    let   batchLines = [];

    const flushBatch = () => {
      if (!batchLines.length) return;
      allChunks.push({
        text: batchLines.join('\n'),
        metadata: { sheet_name: sheetName, sheet_type: type, year: sheetYear, program: '', specialization: '' },
      });
      batchLines = [];
    };

    for (const rawRow of rows) {
      const row  = normalizeRow(rawRow, columnMap);
      let   text = null;

      if (type === 'tracer') {
        text = tracerRowToText(row, sheetYear);
      } else if (type === 'roster') {
        text = rosterRowToText(row, sheetYear);
      } else if (type === 'summary') {
        text = summaryRowToText(row);
      }

      if (!text || text.trim() === '.') continue;

      // Collect normalized row for Graduate record creation (tracer/roster only)
      if (type === 'tracer' || type === 'roster') {
        allRawRows.push({ raw: rawRow, normalized: normalizeRow(rawRow, TRACER_COLUMN_MAP), sheet_name: sheetName });
        batchLines.push(text);
        totalRows++;
        if (batchLines.length >= BATCH_SIZE) flushBatch();
      } else {
        allChunks.push({
          text,
          metadata: { sheet_name: sheetName, sheet_type: type, year: row.year || sheetYear, program: '', specialization: '' },
        });
        totalRows++;
      }
    }
    flushBatch();
  }

  return { chunks: allChunks, rawRows: allRawRows, sheet_type: detectedType, row_count: totalRows };
}

// ─── DOCX parser ─────────────────────────────────────────────────────────────
const DOCX_SECTION_HEADINGS = [
  'DEMOGRAPHIC PROFILE',
  'GENERAL BACKGROUND',
  'EMPLOYMENT DATA',
  'PERSONAL GROWTH',
  'PROFESSIONAL GROWTH',
];

/**
 * Parse a DOCX buffer.
 * Splits text by section headings and returns one chunk per section.
 * Returns: { chunks: [{text, metadata}], row_count }
 */
async function parseDocx(buffer, fileName) {
  const { value: fullText } = await mammoth.extractRawText({ buffer });

  // Split on known section headings (case-insensitive)
  const headingPattern = new RegExp(
    `(${DOCX_SECTION_HEADINGS.map(h => h.replace(/\s+/g, '\\s+')).join('|')})`,
    'gi'
  );

  const parts   = fullText.split(headingPattern).filter(s => s.trim().length > 0);
  const chunks  = [];
  let   current = { heading: 'INTRODUCTION', body: '' };

  for (const part of parts) {
    const isHeading = DOCX_SECTION_HEADINGS.some(
      h => part.trim().toUpperCase().replace(/\s+/g, ' ') === h
    );
    if (isHeading) {
      if (current.body.trim()) {
        chunks.push({
          text:     `[${current.heading}]\n${current.body.trim()}`,
          metadata: { section: current.heading, file_name: fileName },
        });
      }
      current = { heading: part.trim().toUpperCase(), body: '' };
    } else {
      current.body += part;
    }
  }

  // Push final section
  if (current.body.trim()) {
    chunks.push({
      text:     `[${current.heading}]\n${current.body.trim()}`,
      metadata: { section: current.heading, file_name: fileName },
    });
  }

  return { chunks, row_count: chunks.length };
}

// ─── PDF parser (text-based only) ────────────────────────────────────────────
const PDF_CHUNK_WORDS = 400;
const PDF_OVERLAP     = 40;

/**
 * Parse a text-based PDF buffer using sliding-window chunking.
 * Returns: { chunks: [{text, metadata}], row_count }
 */
async function parsePdf(buffer, fileName) {
  const data  = await pdfParse(buffer);
  const words = data.text.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return { chunks: [], row_count: 0 };
  }

  const chunks = [];
  let   i      = 0;
  let   idx    = 0;

  while (i < words.length) {
    const slice = words.slice(i, i + PDF_CHUNK_WORDS).join(' ');
    chunks.push({
      text:     slice,
      metadata: { chunk_index: idx, file_name: fileName },
    });
    i   += PDF_CHUNK_WORDS - PDF_OVERLAP;
    idx += 1;
  }

  return { chunks, row_count: chunks.length };
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────
/**
 * Detect file type from extension and parse accordingly.
 * @param {Buffer} buffer
 * @param {string} fileName
 * @returns {{ chunks, sheet_type, row_count, file_type }}
 */
async function parseFile(buffer, fileName) {
  const ext = fileName.split('.').pop().toLowerCase();

  if (ext === 'xlsx' || ext === 'xls') {
    const result = parseExcel(buffer, fileName);
    return { ...result, file_type: 'excel' };
  }

  if (ext === 'csv') {
    const result = parseExcel(buffer, fileName);
    return { ...result, file_type: 'csv' };
  }

  if (ext === 'docx') {
    const result = await parseDocx(buffer, fileName);
    return { ...result, file_type: 'docx', sheet_type: 'tracer_results' };
  }

  if (ext === 'pdf') {
    const result = await parsePdf(buffer, fileName);
    return { ...result, file_type: 'pdf', sheet_type: 'accreditation' };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

module.exports = { parseFile, tracerRowToText };
