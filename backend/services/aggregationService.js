const Graduate = require('../models/Graduate');

// ─── Intent Detection ─────────────────────────────────────────────────────────

const TOPIC_PATTERNS = {
  names:           /\b(who are|who (did|do|does|didn'?t|don'?t|doesn'?t|have|has|haven'?t|hasn'?t|were|was|weren'?t|wasn'?t|passed|failed|took|pursued|works?|worked)|names? of|list.{0,20}names?|show.{0,20}names?|which alumni|which graduates?|name.*alumni|alumni.*name|graduates?.*name|name.*graduates?)\b/i,
  count:           /\b(how many (?:\w+\s+){0,4}(alumni|records?|graduates?|respondents?|people)|how many (passed|failed|took|pursued|work\w*|did)|total (alumni|records?|graduates?|respondents?)|number of (alumni|records?|graduates?|respondents?)|how many are there|how many alumni are)\b/i,
  rate:            /\b(what\s+(percentage|percent|rate)|how\s+many\s+percent|employment\s+rate|percentage\s+of\s+(graduates?|alumni)|found\s+a\s+job|got\s+a\s+job)\b/i,
  overview:        /\b(tracer survey activity|tracer study activity|overview|summary|overall|general (data|info|result|stat)|show.*tracer|tracer.*result|employment\s+breakdown|employment\s+data|employment\s+statistic)\b/i,
  industry:        /\bindustr/i,
  work_type:       /\b(government|private|sector|work type|type of (employment|work)|employment type)\b/i,
  job_relevance:   /\b(related|relevance|relevant\s+to\s+(?:the(?:ir)?\s+)?(?:course|study|program|degree|field))\b/i,
  further_studies: /\b(further studies?|graduate studies?|masters?|phd|post.?grad|further education)\b/i,
  licensure:       /\blicens\w*\b|\b(board\s+exam|professional\s+exam|prc)\b|\b(tak\w*|pass\w*|fail\w*).{0,20}\bexam\b/i,
  competencies:    /\b(competenc\w*|skill\s+ratings?|self.?assess|performance|technical\s+skills?|communication\s+skills?|problem.?solving|critical\s+thinking|teamwork|adaptability|project\s+management)\b/i,
  work_location:   /\b(local(?:ly)?|abroad|work location|place of work|overseas)\b/i,
  by_program:      /\b(by program|by course|per program|per course|each program|program breakdown)\b/i,
  by_year:         /\b(by (batch|year|graduation)|per (batch|year)|each (batch|year)|year breakdown|batch breakdown)\b/i,
};

function normalizeQuestion(q) {
  return q
    .replace(/never\s*employed/gi,    'never employed')
    .replace(/self\s*employed/gi,     'self-employed')
    .replace(/further\s*education/gi, 'further education')
    .replace(/further\s*studi/gi,     'further studi')
    .replace(/work\s*location/gi,     'work location')
    .replace(/board\s*exam/gi,        'board exam')
    .replace(/job\s*relat/gi,         'job relat')
    .replace(/by\s*program/gi,        'by program')
    .replace(/by\s*year/gi,           'by year')
    .replace(/by\s*batch/gi,          'by batch');
}

function detectTopic(question) {
  question = normalizeQuestion(question);
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (pattern.test(question)) return topic;
  }
  return 'employment';
}

function extractFilters(question) {
  question = normalizeQuestion(question);
  const filters = {};

  // Program name: "BSCS graduates", "BSIT students", etc.
  const courseMatch = question.match(/\b(BS[A-Z]{1,8}|B\.?S\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?|Bachelor(?:\s+of\s+[A-Za-z]+)+)\b/i);
  if (courseMatch) {
    filters.program = courseMatch[1].trim();
    // Expand BS-prefixed abbreviations to keywords matching full DB program names
    const ABBR = {
      BSCS:  'Computer Science',
      BSIT:  'Information Technology',
      BSIS:  'Information Systems',
      BSIM:  'Information Management',
      BSBA:  'Business Administration',
      BSECE: 'Electronics',
      BSCE:  'Civil Engineering',
      BSEE:  'Electrical Engineering',
      BSME:  'Mechanical Engineering',
      BSED:  'Education',
      BSN:   'Nursing',
      BSACCT:'Accountancy',
    };
    const expanded = ABBR[filters.program.toUpperCase()];
    if (expanded) filters.program = expanded;
  }

  // Specialization abbreviations (not BS-prefixed) — checked only if program not yet set
  if (!filters.program) {
    const SPEC_ABBR = [
      [/\bTSM\b/i,                              'Technical Service Management'],
      [/\bWMA\b/i,                              'Web and Mobile Application'],
      [/\bNet(?:work)?\s*Admin\w*\b/i,          'Network Administration'],
      [/\bNA\b/,                                'Network Administration'],   // case-sensitive: avoids Filipino "na"
      [/\bBusiness\s*Analytics?\b/i,            'Business Analytics'],
      [/\bIS\b/,                                'Information Systems'],      // case-sensitive: avoids "is"
      [/\bIT\b/,                                'Information Technology'],   // case-sensitive: avoids "it"
      [/\bCS\b/,                                'Computer Science'],         // case-sensitive: avoids "cs"
      [/\bIM\b/,                                'Information Management'],   // case-sensitive: avoids "im"
    ];
    for (const [pat, expansion] of SPEC_ABBR) {
      if (pat.test(question)) { filters.program = expansion; break; }
    }
  }

  // Graduation year: "batch 2001", "2023 graduates", etc. — covers 1990–2039
  const yearMatch = question.match(/\b((?:199\d|20[0-3]\d))\b/);
  if (yearMatch) filters.yearGraduated = parseInt(yearMatch[1]);

  // Industry — path 1: explicit "industry/sector/field" keyword
  // Note: no \b after "industr" — "industry"/"industries" don't have boundary after "industr"
  if (/\bindustr|\bsector\b|\bfield\b/i.test(question)) {
    const indMatch = question.match(/\b(?:works?\s+in|working\s+in|employed\s+in|in)\s+(?:the\s+)?([a-zA-Z](?:[a-zA-Z ]){1,49}?)(?=\s+(?:industr|sector|field))/i);
    if (indMatch) filters.industry = indMatch[1].trim();
  }
  // Industry — path 2: verb-based "work(s) in / working in / employed in X" without keyword
  if (!filters.industry) {
    const verbMatch = question.match(/\b(?:works?\s+in|working\s+in|employed\s+in)\s+(?:the\s+)?([a-zA-Z][a-zA-Z ]{1,49}?)(?=[?,!.]|$)/i);
    if (verbMatch) {
      const candidate = verbMatch[1].trim();
      if (!/^(the|a|an|this|that|those|our|their|its|any|all|database|system|table|records?|fields?)$/i.test(candidate)) {
        filters.industry = candidate;
      }
    }
  }

  // Employment status — most-specific first to avoid substring conflicts
  if (/\bnever\s*employed\b/i.test(question))        filters.employmentStatus = 'Never Employed';
  else if (/\bself[- ]?employed\b/i.test(question))  filters.employmentStatus = 'Self-Employed';
  else if (/\bunemployed\b/i.test(question))         filters.employmentStatus = 'No';
  else if (/\bemployed\b/i.test(question))           filters.employmentStatus = 'Yes';

  // Exclude self-employed modifier
  if (/\b(don'?t|do\s+not|exclude|not\s+includ|without).{0,25}self[- ]?employ/i.test(question)) {
    filters.excludeSelfEmployed = true;
  }

  // Work location filter
  if (/\blocally?\b|\bwithin.{0,15}country\b|\bhome\s+country\b/i.test(question)) {
    filters.workLocation = 'local';
  } else if (/\babroad\b|\boverseas\b|\boutside.{0,15}country\b/i.test(question)) {
    filters.workLocation = 'abroad';
  }

  // Show all industries flag
  if (/\ball\s+industr/i.test(question) || (/\bshow\s+all\b/i.test(question) && /industr/i.test(question))) {
    filters.showAllIndustries = true;
  }

  // Further education filter — check negation FIRST, use \w* to match full verb ("pursue/pursued")
  if (/\b(did\s+not\s+pursu\w*|not\s+pursu\w*|never\s+pursu\w*|no\s+further)\b/i.test(question)) {
    filters.furtherEducation = 'No';
  } else if (/\b(pursu\w*\s+further|further\s+(education|studi)|graduate\s+studi|masters?|phd|post.?grad)\b/i.test(question)) {
    filters.furtherEducation = 'Yes';
  }

  // Job relevance filter — requires "job/jobs" to avoid extracting from overview questions
  // ("Is the work relevant to their degree?" should NOT set this; "jobs related to course" should)
  if (/\bjobs?.{0,40}(related|relevant)\b/i.test(question) ||
      /\b(related|relevant).{0,20}jobs?\b/i.test(question) ||
      /\b(directly|somewhat)\s+(related|relevant)\b/i.test(question)) {
    if (/\bdirectly\b/i.test(question))                                      filters.jobRelated = 'directly';
    else if (/\bsomewhat\b/i.test(question))                                 filters.jobRelated = 'somewhat';
    else if (/\b(not|no|un|aren'?t|don'?t|doesn'?t)\b/i.test(question))    filters.jobRelated = 'no';
    else                                                                      filters.jobRelated = 'yes';
  }

  // Specific competency filter
  const COMP_MAP = [
    [/\btechnical\s+skills?\b/i,        'technicalSkills'],
    [/\bproblem.?solving\b/i,           'problemSolving'],
    [/\bproject\s+management\b/i,       'projectManagement'],
    [/\bcritical\s+thinking\b/i,        'criticalThinking'],
    [/\bwork.?life\s+balance\b/i,       'workLifeBalance'],
    [/\bteamwork\b/i,                   'teamwork'],
    [/\badaptability\b/i,               'adaptability'],
    [/\bcommunication\s+skills?\b|\bcommunication\b/i, 'communication'],
  ];
  for (const [pat, key] of COMP_MAP) {
    if (pat.test(question)) { filters.competency = key; break; }
  }

  // Board / licensure exam filter — order matters: check negation first, then pass/fail, then generic
  if (/\blicens\w*\b|\b(board\s+exam|professional\s+exam|prc|tak\w*.{0,20}\bexam\b|pass\w*.{0,20}\bexam\b|fail\w*.{0,20}\bexam\b)\b/i.test(question)) {
    if (/\b(did\s+not|didn'?t|never|not\s+tak\w*)\b/i.test(question)) filters.tookExam = 'no';
    else if (/\bpass\w*\b/i.test(question))                             filters.tookExam = 'passed';
    else if (/\bfail\w*\b/i.test(question))                             filters.tookExam = 'failed';
    else                                                                 filters.tookExam = 'yes';
  }

  return filters;
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

// Maps tookExam filter value → MongoDB match condition
function tookExamMatch(val) {
  if (val === 'passed') return { tookExam: { $regex: 'passed', $options: 'i' } };
  if (val === 'failed') return { tookExam: { $regex: 'failed', $options: 'i' } };
  if (val === 'yes')    return { tookExam: { $regex: '^yes',   $options: 'i' } };
  if (val === 'no')     return { tookExam: { $regex: '^no',    $options: 'i' } };
  return {};
}

// Deduplicate per person — email if available, else name, else MongoDB _id.
// Sort newest-first so $first picks the most recently ingested record.
const DEDUP = [
  { $sort: { createdAt: -1 } },
  { $group: {
    _id: { $toLower: { $trim: { input: {
      $cond: {
        if:   { $and: [{ $ne: ['$email', null] }, { $ne: ['$email', ''] }] },
        then: '$email',
        else: { $ifNull: ['$name', { $toString: '$_id' }] },
      },
    }}}},
    doc: { $first: '$$ROOT' },
  }},
  { $replaceRoot: { newRoot: '$doc' } },
];

// Returns a pipeline prefix: filter by stable fields (program, year) then DEDUP.
// Variable fields (employmentStatus, industry, etc.) must be applied AFTER this
// so deduplication uses each person's newest record value.
function stablePipeline(filters) {
  const match = {};
  if (filters.program)       match.program       = { $regex: filters.program, $options: 'i' };
  if (filters.yearGraduated) match.yearGraduated = filters.yearGraduated;
  return [{ $match: match }, ...DEDUP];
}

// ─── Query Functions ──────────────────────────────────────────────────────────

async function queryEmployment(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _status: { $trim: { input: '$employmentStatus' } } } },
    { $group: { _id: '$_status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return null;

  const formal   = rows.filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id))
                       .reduce((s, r) => s + r.count, 0);
  const selfEmp  = rows.filter(r => /^self.?employed$/i.test(r._id))
                       .reduce((s, r) => s + r.count, 0);
  const employed = formal + selfEmp;

  const lbl = filterLabel(filters);
  let out = `Based on the tracer study data${lbl}, there are **${total}** respondents.\n\n`;
  out += `**Employment Breakdown:**\n`;
  rows.forEach(r => { out += `- ${r._id}: **${r.count}** (${pct(r.count, total)})\n`; });
  out += `\n**Overall employment rate: ${pct(employed, total)}** (${employed} out of ${total}, including self-employed)`;
  return out;
}

async function queryIndustry(filters) {
  const pipeline = [
    ...stablePipeline(filters),
    { $match: { industry: { $nin: [null, ''] } } },
  ];
  if (filters.industry) pipeline.push({ $match: { industry: { $regex: filters.industry, $options: 'i' } } });
  pipeline.push(
    { $group: { _id: '$industry', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  );
  if (!filters.industry && !filters.showAllIndustries) pipeline.push({ $limit: 10 });

  const rows = await Graduate.aggregate(pipeline);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);

  if (filters.industry) {
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**Alumni working in ${filters.industry} industry${lbl ? ` (${lbl})` : ''}:**\n\n`;
    out += `Total: **${total}** graduate${total !== 1 ? 's' : ''}\n`;
    if (rows.length > 1) {
      out += `\nBreakdown:\n`;
      rows.forEach((r, i) => { out += `${i + 1}. **${r._id}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
    }
    return out;
  }

  let out = `**Top industries where graduates${lbl} are working:**\n\n`;
  rows.forEach((r, i) => { out += `${i + 1}. **${r._id}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
  return out;
}

async function queryWorkType(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentType: { $nin: [null, ''] } } },
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

async function querySector(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentType: { $nin: [null, ''] } } },
    { $group: { _id: '$employmentType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `> **Note:** The tracer study data does not have a dedicated government/private sector column. `;
  out += `The employment type breakdown below is the closest available data${lbl}.\n\n`;
  out += `**Employment Type Breakdown:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  out += `\n_For accurate sector data, the survey would need a dedicated "employer type" (government/private) question._`;
  return out;
}

async function queryJobRelevance(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { jobRelated: { $nin: [null, ''] } } },
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
  const base = stablePipeline(filters);
  const [totalRows, passedRows, failedRows] = await Promise.all([
    Graduate.aggregate([...base, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: { tookExam: { $regex: 'passed', $options: 'i' } } }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: { tookExam: { $regex: 'failed', $options: 'i' } } }, { $count: 'total' }]),
  ]);
  const total  = totalRows[0]?.total  ?? 0;
  const passed = passedRows[0]?.total ?? 0;
  const failed = failedRows[0]?.total ?? 0;
  const tookAny = passed + failed;
  const notTook = total - tookAny;
  if (total === 0) return null;

  const lbl = filterLabel(filters);
  let out = `**Professional/licensure exam statistics${lbl}:**\n\n`;
  out += `- Took a professional exam: **${tookAny}** (${pct(tookAny, total)})\n`;
  out += `  - Passed: **${passed}**\n`;
  out += `  - Failed: **${failed}**\n`;
  out += `- Did not take: **${notTook}** (${pct(notTook, total)})\n`;
  out += `\nOut of **${total}** respondents.`;
  return out;
}

async function queryFurtherStudies(filters) {
  const base = stablePipeline(filters);

  // Alumni who didn't pursue have null furtherEducation, so count against total
  const [totalRows, pursuedRows] = await Promise.all([
    Graduate.aggregate([...base, { $count: 'total' }]),
    Graduate.aggregate([
      ...base,
      { $match: { furtherEducation: { $regex: '^yes', $options: 'i' } } },
      { $count: 'total' },
    ]),
  ]);

  const total      = totalRows[0]?.total ?? 0;
  const pursued    = pursuedRows[0]?.total ?? 0;
  const notPursued = total - pursued;

  if (total === 0) return null;

  const lbl = filterLabel(filters);
  let out = `**Further education after graduation${lbl}:**\n\n`;
  out += `- Pursued further education: **${pursued}** (${pct(pursued, total)})\n`;
  out += `- Did not pursue: **${notPursued}** (${pct(notPursued, total)})\n`;
  out += `\nOut of **${total}** respondents.`;
  return out;
}

const COMP_LABEL = {
  technicalSkills:   'Technical Skills',
  communication:     'Communication',
  problemSolving:    'Problem Solving',
  projectManagement: 'Project Management',
  teamwork:          'Teamwork',
  adaptability:      'Adaptability',
  workLifeBalance:   'Work-Life Balance',
  criticalThinking:  'Critical Thinking',
};

async function queryCompetencies(filters) {
  const lbl = filterLabel(filters);

  // Single competency asked → show full rating distribution for that skill
  if (filters.competency) {
    const field = `competencies.${filters.competency}`;
    const label = COMP_LABEL[filters.competency] || filters.competency;
    const rows = await Graduate.aggregate([
      ...stablePipeline(filters),
      { $match: { [field]: { $nin: [null, ''] } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    if (!rows.length) return null;
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**${label} self-ratings${lbl} (${total} respondents):**\n\n`;
    rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
    return out;
  }

  // No specific competency → show most common rating for all 8
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { 'competencies.technicalSkills': { $nin: [null, ''] } } },
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
  const locMatch = { workLocation: { $nin: [null, ''] } };
  if (filters.workLocation) {
    locMatch.workLocation = { $regex: filters.workLocation, $options: 'i' };
  }
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: locMatch },
    { $group: { _id: '$workLocation', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  if (filters.workLocation && rows.length > 0) {
    const label = filters.workLocation === 'local' ? 'locally (within the Philippines)'
                : filters.workLocation === 'abroad' ? 'abroad / overseas'
                : filters.workLocation;
    return `There are **${total}** graduate${total !== 1 ? 's' : ''} working **${label}**${lbl}.`;
  }
  let out = `**Work location of graduates${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  return out;
}

async function queryByProgram(filters) {
  const stableMatch = {};
  if (filters.yearGraduated) stableMatch.yearGraduated = filters.yearGraduated;

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    // Some alumni listed multiple programs separated by ";". Take only the first one.
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    {
      $group: {
        _id:      '$_prog',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^yes\b/i } }, 1, 0] } },
        selfEmp:  { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^self.?employed$/i } }, 1, 0] } },
      },
    },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  let out = `**Respondents by program${lbl}:**\n\n`;
  rows.forEach(r => {
    const emp = r.employed + r.selfEmp;
    out += `- **${r._id}**: ${r.total} respondents, ${emp} employed (${pct(emp, r.total)})\n`;
  });
  return out;
}

async function queryByYear(filters) {
  // Group BY year — only pre-filter by program (stable), not year
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null }, employmentStatus: { $nin: [null, ''] } } },
    {
      $group: {
        _id:      '$yearGraduated',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^yes\b/i } }, 1, 0] } },
        selfEmp:  { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^self.?employed$/i } }, 1, 0] } },
      },
    },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  let out = `**Employment by graduation year${lbl}:**\n\n`;
  rows.forEach(r => {
    const emp = r.employed + r.selfEmp;
    out += `- **Batch ${r._id}**: ${emp}/${r.total} employed (${pct(emp, r.total)})\n`;
  });
  return out;
}

const EMOJI_RE = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu;

function cleanText(str) {
  return str ? str.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim() : str;
}

function toTitleCase(str) {
  if (!str) return str;
  return str.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part;
    if (/^[A-Za-zÁÉÍÓÚÑÜ]\.?$/.test(part)) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join('');
}

async function queryNames(filters) {
  const pipeline = [
    ...stablePipeline(filters),
    { $match: { name: { $nin: [null, ''] } } },
  ];

  // Apply variable filters after dedup
  if (filters.industry)         pipeline.push({ $match: { industry:         { $regex: filters.industry, $options: 'i' } } });
  if (filters.employmentStatus) pipeline.push({ $match: { employmentStatus: { $regex: `^${filters.employmentStatus}`, $options: 'i' } } });
  if (filters.furtherEducation === 'No') {
    // Alumni who didn't pursue often have null/empty furtherEducation, not the string "No"
    pipeline.push({ $match: { $or: [
      { furtherEducation: { $in: [null, ''] } },
      { furtherEducation: { $regex: '^No', $options: 'i' } },
    ]}});
  } else if (filters.furtherEducation) {
    pipeline.push({ $match: { furtherEducation: { $regex: `^${filters.furtherEducation}`, $options: 'i' } } });
  }
  if (filters.jobRelated === 'directly') {
    pipeline.push({ $match: { $and: [
      { jobRelated: { $regex: '^yes', $options: 'i' } },
      { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } },
    ]}});
  } else if (filters.jobRelated === 'somewhat') {
    pipeline.push({ $match: { jobRelated: { $regex: 'somewhat', $options: 'i' } } });
  } else if (filters.jobRelated) {
    pipeline.push({ $match: { jobRelated: { $regex: `^${filters.jobRelated}`, $options: 'i' } } });
  }
  if (filters.tookExam) {
    pipeline.push({ $match: tookExamMatch(filters.tookExam) });
  }

  pipeline.push({ $sort: { name: 1 } }, { $limit: 50 });

  const docs = await Graduate.aggregate(pipeline);
  if (!docs.length) {
    if (filters.program) return `No alumni records found for **${filters.program}** in the tracer study database. Please check the program name or abbreviation.`;
    return null;
  }

  const label = [
    filters.industry          && `in ${filters.industry}`,
    filters.program           && `from ${filters.program}`,
    filters.yearGraduated     && `Batch ${filters.yearGraduated}`,
    filters.employmentStatus  && (filters.employmentStatus === 'Yes' ? 'employed' : filters.employmentStatus === 'No' ? 'unemployed' : filters.employmentStatus.toLowerCase()),
    filters.furtherEducation  && (filters.furtherEducation === 'Yes' ? 'who pursued further education' : 'who did not pursue further education'),
    filters.tookExam          && (filters.tookExam === 'passed' ? 'who passed a board/licensure exam'
                                : filters.tookExam === 'failed' ? 'who failed a board/licensure exam'
                                : filters.tookExam === 'yes'    ? 'who took a board/licensure exam'
                                :                                 'who did not take a board/licensure exam'),
  ].filter(Boolean).join(', ');

  const showJob = !!(filters.industry || filters.employmentStatus);

  const suffix = docs.length === 50 ? ` (showing first 50)` : ` (${docs.length} total)`;
  let out = `**Alumni${label ? ` ${label}` : ''}${suffix}:**\n\n`;
  docs.forEach((d, i) => {
    out += `${i + 1}. **${toTitleCase(cleanText(d.name))}**`;
    if (showJob && d.jobTitle) out += ` — ${toTitleCase(cleanText(d.jobTitle))}`;
    out += '\n';
  });
  return out;
}

async function querySimpleRate(filters, matchStage, label) {
  const base = stablePipeline(filters);
  const [totalRows, matchRows] = await Promise.all([
    Graduate.aggregate([...base, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: matchStage }, { $count: 'total' }]),
  ]);
  const total   = totalRows[0]?.total ?? 0;
  const matched = matchRows[0]?.total ?? 0;
  if (total === 0) return null;
  const lbl = filterLabel(filters);
  return `**${pct(matched, total)}** of graduates ${label}${lbl ? ` (${lbl})` : ''} (${matched} out of ${total}).`;
}

// Percentage of exam-takers who passed or failed (denominator = those who took the exam, not all graduates)
async function queryExamPassRate(filters, resultType) {
  const base = stablePipeline(filters);
  const [tookRows, resultRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: { tookExam: { $regex: '^yes', $options: 'i' } } }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: tookExamMatch(resultType) }, { $count: 'total' }]),
  ]);
  const took   = tookRows[0]?.total ?? 0;
  const result = resultRows[0]?.total ?? 0;
  if (took === 0) return null;
  const lbl    = filterLabel(filters);
  const verb   = resultType === 'passed' ? 'passed' : 'failed';
  return `**${pct(result, took)}** of exam takers ${verb} the board/licensure exam${lbl ? ` (${lbl})` : ''} (${result} out of ${took} who took the exam).`;
}

async function queryRate(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _status: { $trim: { input: '$employmentStatus' } } } },
    { $group: { _id: '$_status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;

  const total   = rows.reduce((s, r) => s + r.count, 0);
  const formal  = rows.filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id))
                      .reduce((s, r) => s + r.count, 0);
  const selfEmp = rows.filter(r => /^self.?employed$/i.test(r._id))
                      .reduce((s, r) => s + r.count, 0);
  const employed = filters.excludeSelfEmployed ? formal : formal + selfEmp;

  const lbl = filterLabel(filters);
  const breakdown = filters.excludeSelfEmployed
    ? `${formal} formally employed, self-employed not counted`
    : `${employed} — ${formal} formally employed + ${selfEmp} self-employed`;
  return `The employment rate of graduates${lbl ? ` (${lbl})` : ''} is **${pct(employed, total)}** (${breakdown} out of ${total} respondents).`;
}

async function queryCount(filters) {
  const pipeline = [...stablePipeline(filters)];

  // Variable filters applied after dedup
  const postDedup = {};
  if (filters.employmentStatus) postDedup.employmentStatus = { $regex: `^${filters.employmentStatus}`, $options: 'i' };
  if (filters.industry)         postDedup.industry         = { $regex: filters.industry, $options: 'i' };
  if (filters.furtherEducation === 'No') {
    postDedup.$or = [
      { furtherEducation: { $in: [null, ''] } },
      { furtherEducation: { $regex: '^No', $options: 'i' } },
    ];
  } else if (filters.furtherEducation) {
    postDedup.furtherEducation = { $regex: `^${filters.furtherEducation}`, $options: 'i' };
  }
  if (filters.workLocation)     postDedup.workLocation     = { $regex: filters.workLocation, $options: 'i' };
  if (filters.jobRelated === 'directly') {
    // "Yes, it is directly related" or plain "Yes" — exclude anything with "somewhat"
    postDedup.$and = [
      { jobRelated: { $regex: '^yes', $options: 'i' } },
      { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } },
    ];
  } else if (filters.jobRelated === 'somewhat') {
    // "Somewhat" (File 2) or "Yes, it is somewhat related" (File 1)
    postDedup.jobRelated = { $regex: 'somewhat', $options: 'i' };
  } else if (filters.jobRelated) {
    postDedup.jobRelated = { $regex: `^${filters.jobRelated}`, $options: 'i' };
  }
  if (filters.tookExam) Object.assign(postDedup, tookExamMatch(filters.tookExam));
  if (Object.keys(postDedup).length) pipeline.push({ $match: postDedup });

  pipeline.push({ $count: 'total' });

  const rows = await Graduate.aggregate(pipeline);
  const total = rows[0]?.total ?? 0;
  if (total === 0) {
    if (filters.program) return `No records found for **${filters.program}** in the tracer study database. Please check the program name or abbreviation.`;
    return null;
  }

  const lbl = filterLabel(filters);
  const statusLabel = filters.employmentStatus === 'Yes'            ? 'employed'
                    : filters.employmentStatus === 'No'             ? 'unemployed'
                    : filters.employmentStatus === 'Self-Employed'  ? 'self-employed'
                    : filters.employmentStatus === 'Never Employed' ? 'never employed'
                    : null;
  const industryLabel  = filters.industry     ? ` in ${filters.industry}` : '';
  const locationLabel  = filters.workLocation ? ` working ${filters.workLocation}` : '';
  const examLabel      = filters.tookExam === 'passed' ? ' who passed a board/licensure exam'
                       : filters.tookExam === 'failed' ? ' who failed a board/licensure exam'
                       : filters.tookExam === 'yes'    ? ' who took a board/licensure exam'
                       : filters.tookExam === 'no'     ? ' who did NOT take a board/licensure exam'
                       : '';
  const jobRelLabel    = filters.jobRelated === 'yes'      ? ' with jobs related to their course'
                       : filters.jobRelated === 'directly' ? ' with jobs directly related to their course'
                       : filters.jobRelated === 'no'       ? ' with jobs NOT related to their course'
                       : filters.jobRelated === 'somewhat' ? ' with jobs somewhat related to their course'
                       : '';
  const desc = statusLabel
    ? `**${statusLabel}** alumni${industryLabel}${locationLabel}${examLabel}${jobRelLabel}`
    : `graduate${total !== 1 ? 's' : ''}${industryLabel}${locationLabel}${examLabel}${jobRelLabel}`;
  let out = `There are **${total}** ${desc} in the tracer study database${lbl}.`;

  // For general "related" queries, add directly/somewhat sub-breakdown
  if (filters.jobRelated === 'yes') {
    const base = stablePipeline(filters);
    const [dirRows, somRows] = await Promise.all([
      Graduate.aggregate([...base, { $match: { $and: [
        { jobRelated: { $regex: '^yes', $options: 'i' } },
        { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } },
      ]}}, { $count: 'total' }]),
      Graduate.aggregate([...base, { $match: { jobRelated: { $regex: 'somewhat', $options: 'i' } } }, { $count: 'total' }]),
    ]);
    const directly = dirRows[0]?.total ?? 0;
    const somewhat = somRows[0]?.total ?? 0;
    out += `\n- Directly related: **${directly}**\n- Somewhat related: **${somewhat}**`;
  }

  return out;
}

async function queryOverview(filters) {
  const base = stablePipeline(filters);

  const countRows = await Graduate.aggregate([...base, { $count: 'total' }]);
  const total = countRows[0]?.total ?? 0;
  if (total === 0) return null;

  const empRows = await Graduate.aggregate([
    ...base,
    { $match: { employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _status: { $trim: { input: '$employmentStatus' } } } },
    { $group: { _id: '$_status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const formal  = empRows.filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
  const selfEmp = empRows.filter(r => /^self.?employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
  const employed = formal + selfEmp;

  const indRows = await Graduate.aggregate([
    ...base,
    { $match: { industry: { $nin: [null, ''] } } },
    { $group: { _id: '$industry', count: { $sum: 1 } } },
    { $sort: { count: -1 } }, { $limit: 3 },
  ]);

  const locRows = await Graduate.aggregate([
    ...base,
    { $match: { workLocation: { $nin: [null, ''] } } },
    { $group: { _id: '$workLocation', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const eduRows = await Graduate.aggregate([
    ...base,
    { $match: { furtherEducation: { $nin: [null, ''] } } },
    { $group: { _id: '$furtherEducation', count: { $sum: 1 } } },
  ]);
  const pursuedEdu = eduRows.filter(r => YES_RE.test(r._id)).reduce((s, r) => s + r.count, 0);
  const eduTotal   = eduRows.reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  let out = `**Tracer Study Overview${lbl} — ${total} respondents**\n\n`;

  out += `**Employment Status:**\n`;
  empRows.forEach(r => { out += `- ${r._id}: **${r.count}** (${pct(r.count, total)})\n`; });
  out += `→ Overall employment rate: **${pct(employed, total)}** (including self-employed)\n\n`;

  if (indRows.length) {
    out += `**Top Industries:**\n`;
    indRows.forEach((r, i) => { out += `${i + 1}. ${r._id} — ${r.count}\n`; });
    out += '\n';
  }

  if (locRows.length) {
    out += `**Work Location:**\n`;
    locRows.forEach(r => { out += `- ${r._id}: ${r.count} (${pct(r.count, total)})\n`; });
    out += '\n';
  }

  out += `**Further Education:** ${pursuedEdu} pursued further studies (${pct(pursuedEdu, eduTotal)})`;
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function hasData() {
  const count = await Graduate.countDocuments();
  return count > 0;
}

async function query(question) {
  if (!(await hasData())) return null;

  // Questions the AI can recognize but cannot yet answer from available data
  if (/\b(job (openings?|listings?|vacancies|opportunities|postings?)|available (jobs?|positions?|roles?))\b/i.test(question)) {
    return {
      text: `The Job Opportunities section is part of this system, but no job listings have been posted yet. Please check back later or contact the university's career services office for available opportunities.`,
      direct: true,
    };
  }

  const topic   = detectTopic(question);
  const filters = extractFilters(question);

  // Detect government/private SECTOR questions (no dedicated field in data)
  const isSectorQuestion = /\b(government|private)\s*sector\b|\bsector\b.{0,20}\b(government|private)\b/i.test(question);

  // If nothing matched (default employment) and the question looks like a bare noun phrase
  // (no WH-words, no verbs), treat the whole question as an industry name to look up.
  if (topic === 'employment' && !filters.industry && !filters.employmentStatus && !filters.furtherEducation) {
    if (!/\b(how|what|who|which|when|where|why|is|are|do|does|show|list|give|tell|would|could|should|can|have|has)\b/i.test(question)) {
      const candidate = question.trim().replace(/[?!.,]+$/, '').trim();
      if (candidate.length > 2 && candidate.length < 60) {
        filters.industry = candidate;
      }
    }
  }

  const fn = {
    names:           () => queryNames(filters),
    count:           () => isSectorQuestion ? querySector(filters) : filters.workLocation ? queryWorkLocation(filters) : filters.industry ? queryIndustry(filters) : queryCount(filters),
    rate:            () => filters.tookExam === 'passed'
      ? queryExamPassRate(filters, 'passed')
      : filters.tookExam === 'failed'
      ? queryExamPassRate(filters, 'failed')
      : filters.tookExam === 'yes'
      ? querySimpleRate(filters, tookExamMatch('yes'), 'took a board/licensure exam')
      : filters.tookExam === 'no'
      ? querySimpleRate(filters, tookExamMatch('no'), 'did NOT take a board/licensure exam')
      : filters.furtherEducation === 'Yes'
      ? querySimpleRate(filters, { furtherEducation: { $regex: '^yes', $options: 'i' } }, 'pursued further education')
      : filters.furtherEducation === 'No'
      ? querySimpleRate(filters, { $or: [{ furtherEducation: { $in: [null, ''] } }, { furtherEducation: { $regex: '^no', $options: 'i' } }] }, 'did not pursue further education')
      : filters.jobRelated
      ? querySimpleRate(filters, { jobRelated: { $regex: '^yes', $options: 'i' } }, 'have jobs related to their course')
      : queryRate(filters),
    overview:        () => /\bby\s+(program|course)\b/i.test(question) ? queryByProgram(filters)
      : /\bby\s+(batch|year|graduation)\b/i.test(question) ? queryByYear(filters)
      : /\bemployment\s+(breakdown|data|statistic)/i.test(question) ? queryEmployment(filters)
      : queryOverview(filters),
    industry:        () => queryIndustry(filters),
    work_type:       () => isSectorQuestion ? querySector(filters) : queryWorkType(filters),
    job_relevance:   () => filters.jobRelated ? queryCount(filters) : queryJobRelevance(filters),
    further_studies: () => /\bwho\b/i.test(question) ? queryNames(filters) : queryFurtherStudies(filters),
    licensure:       () => /\bwho\b/i.test(question) ? queryNames(filters) : filters.tookExam ? queryCount(filters) : queryLicensure(filters),
    competencies:    () => queryCompetencies(filters),
    work_location:   () => queryWorkLocation(filters),
    by_program:      () => queryByProgram(filters),
    by_year:         () => queryByYear(filters),
    employment:      () => filters.industry ? queryIndustry(filters) : filters.employmentStatus ? queryCount(filters) : queryEmployment(filters),
  }[topic] ?? (() => queryEmployment(filters));

  const text = await fn();
  return text ? { text, direct: true } : null;
}

module.exports = { query, hasData };
