const Graduate = require('../models/Graduate');

// ─── Intent Detection ─────────────────────────────────────────────────────────

const TOPIC_PATTERNS = {
  industry:        /\bindustr/i,
  work_type:       /\b(government|private|sector|work type|type of (employment|work)|employment type)\b/i,
  job_relevance:   /\b(related|relevance|relevant to (course|study|program))\b/i,
  further_studies: /\b(further studies?|graduate studies?|masters?|phd|post.?grad|further education)\b/i,
  licensure:       /\b(licens|board exam|professional exam|prc)\b/i,
  competencies:    /\b(competenc|skill rating|self.?assess|performance|technical skill|communication skill)\b/i,
  work_location:   /\b(local|abroad|work location|place of work|overseas)\b/i,
  by_program:      /\b(by program|by course|per program|per course|each program|program breakdown)\b/i,
  by_year:         /\b(by (batch|year|graduation)|per (batch|year)|each (batch|year)|year breakdown|batch breakdown)\b/i,
};

function detectTopic(question) {
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (pattern.test(question)) return topic;
  }
  return 'employment';
}

function extractFilters(question) {
  const filters = {};

  // Program name: "BSCS graduates", "BSIT students", etc.
  const courseMatch = question.match(/\b(BS[A-Z]{1,8}|B\.?S\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?|Bachelor(?:\s+of\s+[A-Za-z]+)+)\b/i);
  if (courseMatch) filters.program = courseMatch[1].trim();

  // Graduation year: "batch 2023", "2023 graduates"
  const yearMatch = question.match(/\b(20[12]\d)\b/);
  if (yearMatch) filters.yearGraduated = parseInt(yearMatch[1]);

  return filters;
}

function buildMatch(filters) {
  const match = {};
  if (filters.program)       match.program       = { $regex: filters.program, $options: 'i' };
  if (filters.yearGraduated) match.yearGraduated = filters.yearGraduated;
  return match;
}

function filterLabel(filters) {
  const parts = [];
  if (filters.program)       parts.push(filters.program);
  if (filters.yearGraduated) parts.push(`Batch ${filters.yearGraduated}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function pct(n, total) {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—';
}

const YES_RE = /^yes\b/i;

// ─── Query Functions ──────────────────────────────────────────────────────────

async function queryEmployment(filters) {
  const match = buildMatch(filters);
  const rows  = await Graduate.aggregate([
    { $match: { ...match, employmentStatus: { $nin: [null, ''] } } },
    { $group: { _id: '$employmentStatus', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return null;

  const employed = rows
    .filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id))
    .reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `Based on the tracer study data${lbl}, there are **${total}** respondents.\n\n`;
  out += `**Employment Breakdown:**\n`;
  rows.forEach(r => { out += `- ${r._id}: **${r.count}** (${pct(r.count, total)})\n`; });
  out += `\n**Overall employment rate: ${pct(employed, total)}** (${employed} out of ${total})`;
  return out;
}

async function queryIndustry(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, industry: { $nin: [null, ''] } } },
    { $group: { _id: '$industry', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  let out = `**Top industries where graduates${lbl} are working:**\n\n`;
  rows.forEach((r, i) => { out += `${i + 1}. **${r._id}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
  return out;
}

async function queryWorkType(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, employmentType: { $nin: [null, ''] } } },
    { $group: { _id: '$employmentType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `**Employment type breakdown${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  return out;
}

async function queryJobRelevance(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, jobRelated: { $nin: [null, ''] } } },
    { $group: { _id: '$jobRelated', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const yes   = rows.filter(r => /yes/i.test(r._id)).reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `**Job relevance to course of study${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  out += `\n${pct(yes, total)} of graduates work in a field related to their course.`;
  return out;
}

async function queryLicensure(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, tookExam: { $nin: [null, ''] } } },
    { $group: { _id: '$tookExam', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const yes   = rows.filter(r => YES_RE.test(r._id)).reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `**Professional/licensure exam statistics${lbl}:**\n\n`;
  out += `- Took a professional exam: **${yes}** (${pct(yes, total)})\n`;
  out += `- Did not take: **${total - yes}** (${pct(total - yes, total)})\n`;
  out += `\nOut of **${total}** respondents.`;
  return out;
}

async function queryFurtherStudies(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, furtherEducation: { $nin: [null, ''] } } },
    { $group: { _id: '$furtherEducation', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const yes   = rows.filter(r => YES_RE.test(r._id)).reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `**Further education after graduation${lbl}:**\n\n`;
  out += `- Pursued further education: **${yes}** (${pct(yes, total)})\n`;
  out += `- Did not pursue: **${total - yes}** (${pct(total - yes, total)})\n`;
  out += `\nOut of **${total}** respondents.`;
  return out;
}

async function queryCompetencies(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, 'competencies.technicalSkills': { $nin: [null, ''] } } },
    {
      $group: {
        _id:      null,
        technical:  { $push: '$competencies.technicalSkills' },
        comm:       { $push: '$competencies.communication' },
        problem:    { $push: '$competencies.problemSolving' },
        project:    { $push: '$competencies.projectManagement' },
        team:       { $push: '$competencies.teamwork' },
        adapt:      { $push: '$competencies.adaptability' },
        wlb:        { $push: '$competencies.workLifeBalance' },
        critical:   { $push: '$competencies.criticalThinking' },
        count:      { $sum: 1 },
      },
    },
  ]);
  if (!rows.length) return null;

  const r = rows[0];
  const topRating = arr => {
    const freq = {};
    arr.forEach(v => { if (v) freq[v] = (freq[v] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  };

  const lbl = filterLabel(filters);
  let out = `**Most common competency self-ratings${lbl} (${r.count} respondents):**\n\n`;
  out += `- Technical Skills:    **${topRating(r.technical)}**\n`;
  out += `- Communication:       **${topRating(r.comm)}**\n`;
  out += `- Problem Solving:     **${topRating(r.problem)}**\n`;
  out += `- Project Management:  **${topRating(r.project)}**\n`;
  out += `- Teamwork:            **${topRating(r.team)}**\n`;
  out += `- Adaptability:        **${topRating(r.adapt)}**\n`;
  out += `- Work-Life Balance:   **${topRating(r.wlb)}**\n`;
  out += `- Critical Thinking:   **${topRating(r.critical)}**\n`;
  return out;
}

async function queryWorkLocation(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, workLocation: { $nin: [null, ''] } } },
    { $group: { _id: '$workLocation', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `**Work location of graduates${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  return out;
}

async function queryByProgram(filters) {
  const match = buildMatch(filters);
  const rows = await Graduate.aggregate([
    { $match: { ...match, program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    {
      $group: {
        _id:      '$program',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: '$employmentStatus', regex: /^yes\b/i } }, 1, 0] } },
      },
    },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  let out = `**Respondents by program${lbl}:**\n\n`;
  rows.forEach(r => {
    out += `- **${r._id}**: ${r.total} respondents, ${r.employed} employed (${pct(r.employed, r.total)})\n`;
  });
  return out;
}

async function queryByYear(filters) {
  const match = buildMatch(filters);
  if (filters.program) match.program = { $regex: filters.program, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: { ...match, yearGraduated: { $ne: null }, employmentStatus: { $nin: [null, ''] } } },
    {
      $group: {
        _id:      '$yearGraduated',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: '$employmentStatus', regex: /^yes\b/i } }, 1, 0] } },
      },
    },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  let out = `**Employment by graduation year${lbl}:**\n\n`;
  rows.forEach(r => {
    out += `- **Batch ${r._id}**: ${r.employed}/${r.total} employed (${pct(r.employed, r.total)})\n`;
  });
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function hasData() {
  const count = await Graduate.countDocuments();
  return count > 0;
}

async function query(question) {
  if (!(await hasData())) return null;

  const topic   = detectTopic(question);
  const filters = extractFilters(question);

  switch (topic) {
    case 'industry':        return queryIndustry(filters);
    case 'work_type':       return queryWorkType(filters);
    case 'job_relevance':   return queryJobRelevance(filters);
    case 'further_studies': return queryFurtherStudies(filters);
    case 'licensure':       return queryLicensure(filters);
    case 'competencies':    return queryCompetencies(filters);
    case 'work_location':   return queryWorkLocation(filters);
    case 'by_program':      return queryByProgram(filters);
    case 'by_year':         return queryByYear(filters);
    default:                return queryEmployment(filters);
  }
}

module.exports = { query, hasData };
