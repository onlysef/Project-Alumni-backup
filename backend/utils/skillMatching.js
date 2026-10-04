// Shared skill-keyword vocabulary and fuzzy-matching helpers, used by both
// the interactive Job Connect search (alumniController.searchJobs) and the
// background job-alert sweep (services/jobAlertService) to score how well a
// Careerjet posting's title/description lines up with an alumnus's skills.

// Covers the same spread of industries as the Tracer Study form's industry
// list (Information Technology, Education, Virtual Assistance, Customer
// Service, Engineering/Construction, Marketing, Healthcare, Manufacturing,
// Finance, HR, Government, Non-Profit) — alumni from IT-adjacent courses
// often end up in any of these, not just software roles.
const SKILL_BUCKETS = [
  { name: 'Programming', keywords: ['javascript', 'python', 'java', 'c++', 'c#', 'php', 'programming', 'coding', 'typescript', 'ruby', 'swift', 'kotlin', 'software development', 'algorithms', 'data structures', 'cobol', 'mainframe', 'as400', 'rpg', 'golang', 'rust', 'perl', 'bash', 'powershell', 'shell scripting', 'vb.net'] },
  { name: 'Web Development', keywords: ['html', 'css', 'react', 'node', 'vue', 'angular', 'web development', 'frontend', 'backend', 'wordpress', 'next.js', 'tailwind', 'bootstrap', 'rest api', 'laravel', 'django', 'flask', 'spring boot', 'asp.net', 'jquery', 'graphql', 'ruby on rails'] },
  { name: 'Database Management', keywords: ['sql', 'mysql', 'database', 'oracle', 'mongodb', 'postgresql', 'data management', 'firebase', 'nosql', 'sql server', 'redis', 'db2', 'sqlite', 'pl/sql'] },
  { name: 'Cloud & DevOps', keywords: ['aws', 'azure', 'gcp', 'docker', 'kubernetes', 'devops', 'ci/cd', 'terraform', 'jenkins', 'ansible'] },
  { name: 'Networking', keywords: ['networking', 'cisco', 'network', 'router', 'firewall', 'network security', 'lan', 'wan', 'ip addressing', 'network administration'] },
  { name: 'Design', keywords: ['figma', 'design', 'ui', 'ux', 'photoshop', 'adobe', 'wireframe', 'prototyping', 'illustrator', 'canva', 'graphic design', 'video editing'] },
  { name: 'Project Management', keywords: ['project management', 'agile', 'scrum', 'planning', 'scheduling', 'kanban', 'jira', 'trello', 'coordination', 'risk management'] },
  // Same underserved-bucket problem as Education & Training had: the
  // original 9 keywords only matched sentences using those exact nouns
  // ("communication", "teamwork"...), so extremely common self-described
  // soft skills ("I can work under pressure", "I'm a fast learner", "I have
  // good time management") extracted nothing at all.
  { name: 'Communication & Soft Skills', keywords: ['communication', 'presentation', 'writing', 'leadership', 'teamwork', 'collaboration', 'public speaking', 'negotiation', 'interpersonal skills', 'problem solving', 'critical thinking', 'decision making', 'time management', 'attention to detail', 'adaptability', 'adaptable', 'flexibility', 'flexible', 'work ethic', 'hardworking', 'hard working', 'multitasking', 'multitask', 'patience', 'patient', 'initiative', 'creativity', 'creative', 'positive attitude', 'work under pressure', 'conflict resolution', 'emotional intelligence', 'willingness to learn', 'fast learner', 'resourcefulness', 'resourceful', 'reliability', 'reliable', 'self motivation'] },
  { name: 'Customer Service & Support', keywords: ['customer service', 'technical support', 'call center', 'chat support', 'email support', 'crm', 'zendesk', 'helpdesk', 'client relations', 'complaint handling', 'customer support'] },
  { name: 'Virtual Assistance', keywords: ['virtual assistant', 'remote work', 'scheduling', 'email management', 'calendar management', 'data entry', 'transcription', 'social media management', 'administrative support'] },
  { name: 'Healthcare', keywords: ['patient care', 'nursing', 'clinical', 'medical assistant', 'first aid', 'cpr', 'pharmacy', 'healthcare', 'medical billing', 'emr', 'vital signs'] },
  { name: 'Manufacturing & Engineering', keywords: ['quality control', 'production', 'autocad', 'cad', 'assembly', 'lean manufacturing', 'six sigma', 'machining', 'inventory management', 'process improvement', 'quality assurance'] },
  { name: 'Finance & Accounting', keywords: ['accounting', 'accountant', 'bookkeeping', 'bookkeeper', 'quickbooks', 'payroll', 'taxation', 'tax preparation', 'auditing', 'audit', 'financial analysis', 'budgeting', 'reconciliation', 'accounts payable', 'accounts receivable', 'cost accounting'] },
  { name: 'Marketing & Sales', keywords: ['digital marketing', 'social media marketing', 'seo', 'content creation', 'sales', 'branding', 'copywriting', 'market research', 'advertising', 'lead generation'] },
  { name: 'Administrative & Office', keywords: ['clerical', 'office administration', 'filing', 'records management', 'ms office', 'excel', 'word', 'powerpoint', 'documentation', 'data entry'] },
  { name: 'Human Resources', keywords: ['recruitment', 'employee relations', 'onboarding', 'hr policies', 'talent acquisition', 'performance management', 'compensation', 'training and development'] },
  // Deliberately deeper than most other buckets: "teaching"/"lesson
  // planning"/"classroom management" alone missed almost every realistic
  // teacher self-description ("I teach elementary students", "I'm a
  // guidance counselor", "student assessment", "lesson plans") since none
  // of those phrasings are literally the word "teaching". Covers the actual
  // vocabulary Philippine K-12/DepEd teacher-alumni use to describe their
  // own work, not just the single generic term.
  { name: 'Education & Training', keywords: ['teaching', 'teacher', 'educator', 'instructor', 'professor', 'tutor', 'tutoring', 'lesson planning', 'lesson plan', 'lesson plans', 'curriculum development', 'curriculum planning', 'classroom management', 'classroom instruction', 'classroom discipline', 'student assessment', 'educational assessment', 'grading', 'academic advising', 'differentiated instruction', 'teaching strategies', 'instructional materials', 'module writing', 'learning modules', 'remedial teaching', 'special education', 'values education', 'guidance counseling', 'guidance counselor', 'student counseling', 'career guidance', 'training', 'mentoring', 'facilitation'] },
  { name: 'Construction & Trades', keywords: ['construction', 'carpentry', 'welding', 'electrical work', 'plumbing', 'site supervision', 'blueprint reading', 'safety compliance'] },
];

// Keyword list entries are lowercase match patterns, not display-ready
// labels (e.g. "sql", "c++", "next.js") — this maps the ones that don't
// title-case cleanly to how they're actually written.
const SKILL_LABEL_OVERRIDES = {
  javascript: 'JavaScript', typescript: 'TypeScript', 'c++': 'C++', 'c#': 'C#', php: 'PHP',
  html: 'HTML', css: 'CSS', node: 'Node.js', vue: 'Vue.js', wordpress: 'WordPress', 'next.js': 'Next.js', 'rest api': 'REST API',
  sql: 'SQL', mysql: 'MySQL', mongodb: 'MongoDB', postgresql: 'PostgreSQL', nosql: 'NoSQL',
  lan: 'LAN', wan: 'WAN', 'ip addressing': 'IP Addressing',
  ui: 'UI', ux: 'UX', jira: 'JIRA', crm: 'CRM', cpr: 'CPR', emr: 'EMR',
  autocad: 'AutoCAD', cad: 'CAD', quickbooks: 'QuickBooks', seo: 'SEO', 'ms office': 'MS Office',
  cobol: 'COBOL', as400: 'AS400', rpg: 'RPG',
  'vb.net': 'VB.NET', powershell: 'PowerShell',
  'asp.net': 'ASP.NET', jquery: 'jQuery', graphql: 'GraphQL', 'ruby on rails': 'Ruby on Rails',
  'sql server': 'SQL Server', db2: 'DB2', sqlite: 'SQLite', 'pl/sql': 'PL/SQL',
  aws: 'AWS', gcp: 'GCP', devops: 'DevOps', 'ci/cd': 'CI/CD',
  adaptable: 'Adaptability', flexible: 'Flexibility', 'hard working': 'Hardworking',
  patient: 'Patience', creative: 'Creativity', resourceful: 'Resourcefulness', reliable: 'Reliability', multitask: 'Multitasking',
};

// The Employment Details "+ Add skill" field (frontend SkillsEditor.jsx)
// used to accept any text with at least one letter, with no check that it's
// an actual skill — caught live: alumni entered "Roblox", "Y8", "codm" and
// they were saved and displayed as skills. Not an attempt at a general "is
// this a real skill" classifier (impossible to enumerate every legitimate
// niche skill someone could genuinely have, and SKILL_BUCKETS above is
// deliberately NOT exhaustive) — a curated denylist of the most common
// non-skill entries someone might type instead: video games/gaming
// platforms (near-zero chance any of these is ever a legitimate
// professional skill), bare entertainment/social apps (a real skill mention
// uses an actual skill phrase already covered by SKILL_BUCKETS above —
// "Social Media Marketing", "Content Creation", "Video Editing" — so typing
// just the app name by itself is never the real skill, only a shortcut to
// one), and common placeholder/joke text. Mirrored in frontend/src/utils/
// skillClassification.js for the client-side check — keep both in sync.
const NON_SKILL_KEYWORDS = [
  // Video games / gaming platforms
  'roblox', 'y8', 'minecraft', 'fortnite', 'valorant', 'mobile legends', 'mobile legends bang bang', 'mlbb',
  'codm', 'call of duty', 'call of duty mobile', 'free fire', 'pubg', 'pubg mobile', 'among us',
  'genshin impact', 'honkai star rail', 'honkai impact', 'dota', 'dota 2', 'league of legends', 'wild rift',
  'arena of valor', 'aov', 'grand theft auto', 'gta', 'clash of clans', 'clash royale', 'brawl stars',
  'brawlhalla', 'stumble guys', 'candy crush', 'subway surfers', 'temple run', 'pokemon go', '8 ball pool',
  'apex legends', 'overwatch', 'counter strike', 'csgo', 'cs2', 'tekken', 'street fighter', 'fifa', 'efootball',
  'sky children of light', 'video games', 'video game', 'gaming', 'playstation', 'xbox', 'nintendo switch',
  // Bare entertainment/social apps (the real skill is a phrase like "Social
  // Media Marketing"/"Content Creation"/"Video Editing", already covered
  // above — the app name alone isn't a skill by itself)
  'netflix', 'youtube', 'tiktok', 'spotify', 'discord', 'snapchat', 'pinterest', 'whatsapp', 'telegram', 'messenger',
  // Placeholder/joke entries
  'none', 'n a', 'nothing', 'idk', 'wala', 'basta', 'test', 'testing', 'asdf', 'qwerty', 'lol', 'lmao', 'haha', 'charot', 'ewan',
];

const skillLabel = (keyword) => SKILL_LABEL_OVERRIDES[keyword] || keyword.replace(/\b\w/g, (c) => c.toUpperCase());

// Flat, deduplicated keyword vocabulary drawn from SKILL_BUCKETS (already
// spans IT, healthcare, finance, HR, education, trades, etc.) — used by
// Job Connect to figure out which real skills a Careerjet posting is
// actually asking for, since Careerjet itself returns free-text
// descriptions with no structured skill tags.
const ALL_SKILL_KEYWORDS = [...new Set(SKILL_BUCKETS.flatMap((b) => b.keywords))];

// Punctuation/spacing becomes a single space (not deleted outright) so word
// boundaries survive — textContainsSkill below needs them to tell "java"
// the word apart from "java" the first four letters of "javascript".
const normalizeSkillText = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// "c++"/"c#" are the only keywords whose punctuation carries their entire
// meaning — normalizeSkillText strips the symbol, collapsing both down to a
// bare "c" (see the length<2 guards below), which is why they used to be
// skipped outright rather than false-positiving on any text containing a
// standalone "c". Matched here directly against the RAW text instead, with
// the symbol required and real word boundaries either side (lookarounds,
// since "+"/"#" aren't \b word characters) — "c++"/"c#" as literal
// substrings essentially never appear by coincidence, so this carries none
// of the false-positive risk the bare-letter version had.
const SYMBOL_SKILL_PATTERNS = {
  'c++': /(?<![a-z0-9])c\+\+(?![a-z0-9])/i,
  'c#':  /(?<![a-z0-9])c#(?![a-z0-9])/i,
};

// "frontend"/"backend" are umbrella/category words pulled from job posting
// text (part of the Web Development bucket), not real skill names anyone
// actually lists on their own profile — nobody writes "frontend" as a
// skill, they write "React"/"HTML"/"CSS". Literal whole-word matching
// against these two therefore always failed, showing them as "missing"
// even for an alumnus whose listed skills (React, HTML, CSS, PHP, Node.js)
// obviously satisfy them. Satisfied here by checking for ANY of the
// concrete underlying technologies each umbrella term actually covers.
const CATEGORY_ALIASES = {
  frontend: ['html', 'css', 'react', 'vue', 'angular', 'jquery', 'bootstrap', 'tailwind', 'next.js', 'ui', 'ux'],
  backend:  ['node', 'php', 'django', 'flask', 'spring boot', 'asp.net', 'laravel', 'ruby on rails', 'sql', 'mysql', 'mongodb', 'postgresql', 'graphql', 'rest api', 'python', 'java', 'c#'],
};

// Several soft-skill keywords are just different grammatical forms of the
// SAME underlying trait ("creative"/"creativity", "reliable"/"reliability",
// "patient"/"patience", "flexible"/"flexibility", "hardworking"/"hard
// working", "adaptable"/"adaptability", "multitask"/"multitasking",
// "resourceful"/"resourcefulness") — SKILL_LABEL_OVERRIDES already displays
// both forms under one identical-looking chip label, but without this they
// were still matched as two unrelated keywords. A job posting using
// "creative" and an alumnus's profile listing "Creativity" are the same
// skill in different grammar, not two different skills — caught live: the
// exact same "Creativity" chip showed matched on one job card and missing
// on another, purely because of which word form each posting's own
// description text happened to use, with the alumnus's own listed skills
// never having changed at all. Built programmatically (not hand-listed) so
// every current and future label-sharing pair gets this fix automatically.
const SKILL_LABEL_TO_KEYWORDS = {};
for (const kw of ALL_SKILL_KEYWORDS) {
  const label = skillLabel(kw);
  (SKILL_LABEL_TO_KEYWORDS[label] ||= []).push(kw);
}

// Whole-word/whole-phrase matching, not a bare substring search — the
// previous version stripped ALL separators (including spaces) before
// comparing, which fused "HTML, CSS, Java" into one "htmlcssjava" string.
// A bare .includes() against that fused string meant "java" satisfied
// "javascript" (java IS a substring of javascript) and "ui"/"lan" satisfied
// almost any word containing those four letters in sequence ("building",
// "planning", ...) — real false positives that showed alumni as having
// skills they never listed. Tokenizing and requiring a whole token (or, for
// multi-word keywords, a run of adjacent tokens) to equal the keyword fixes
// that, while the `${skillFused}js` check below keeps the one compatibility
// case this app actually relies on: "React.js"/"Node.js"/"Vue.js" (which
// tokenize as ["react","js"] and match on the first token alone) written
// instead as one fused word "ReactJS"/"NodeJS"/"VueJS" with no separator at
// all still counting as the same skill.
function matchesKeywordLiterally(userSkillsText, skill) {
  const skillWords = normalizeSkillText(skill).split(' ').filter(Boolean);
  const skillFused = skillWords.join('');
  // Every other keyword shorter than 2 characters once normalized is too
  // short to be a meaningful signal (would match almost any text) — skipped
  // rather than false-positived on.
  if (skillFused.length < 2) return false;

  const textWords = normalizeSkillText(userSkillsText).split(' ').filter(Boolean);
  for (let i = 0; i < textWords.length; i++) {
    if (textWords[i] === skillFused || textWords[i] === `${skillFused}js`) return true;
    if (skillWords.length > 1 && textWords.slice(i, i + skillWords.length).join('') === skillFused) return true;
  }
  return false;
}

// Server-side counterpart to the frontend's isNonSkillEntry() (SkillsEditor.jsx
// already blocks these client-side) — the actual enforcement boundary, since
// a direct API call bypasses any client-side check entirely.
function isNonSkillEntry(skillText) {
  return NON_SKILL_KEYWORDS.some((keyword) => matchesKeywordLiterally(skillText, keyword));
}

function textContainsSkill(userSkillsText, skill) {
  const key = (skill || '').trim().toLowerCase();
  const symbolPattern = SYMBOL_SKILL_PATTERNS[key];
  if (symbolPattern) return symbolPattern.test(userSkillsText || '');

  if (CATEGORY_ALIASES[key]) {
    return CATEGORY_ALIASES[key].some((alias) => textContainsSkill(userSkillsText, alias));
  }

  const siblings = SKILL_LABEL_TO_KEYWORDS[skillLabel(key)];
  if (siblings && siblings.length > 1) {
    return siblings.some((sib) => matchesKeywordLiterally(userSkillsText, sib));
  }

  return matchesKeywordLiterally(userSkillsText, key);
}

// Lets the Employment Details skills field accept a free-form sentence
// ("I'm skilled in Python programming and enjoy customer service work")
// instead of forcing alumni to type one chip at a time. Scans the sentence
// for any of the ~250 known keywords using the same whole-word matching
// textContainsSkill relies on elsewhere, then returns the matched keywords
// in their display label form, longest phrase first, so a multi-word match
// like "customer service" isn't also reported as a separate looser hit.
// Deterministic keyword lookup (no LLM call) — reliable and instant, unlike
// asking a small model to freelance an extraction from scratch.
function extractSkillsFromText(text) {
  const found = [];

  // Checked against the raw (un-normalized) text first — see
  // SYMBOL_SKILL_PATTERNS' own comment for why these two can't go through
  // the normalize-then-tokenize path everything else below uses.
  for (const [keyword, pattern] of Object.entries(SYMBOL_SKILL_PATTERNS)) {
    if (pattern.test(text || '')) found.push(skillLabel(keyword));
  }

  // Longest phrase first so "network security" claims its two tokens before
  // the bare "network"/"networking" keywords get a chance to match either one.
  const sorted = [...ALL_SKILL_KEYWORDS].sort((a, b) => b.length - a.length);
  const tokens = normalizeSkillText(text).split(' ').filter(Boolean);
  const consumed = new Array(tokens.length).fill(false);

  for (const keyword of sorted) {
    if (SYMBOL_SKILL_PATTERNS[keyword]) continue; // already handled above
    const skillWords = normalizeSkillText(keyword).split(' ').filter(Boolean);
    const skillFused = skillWords.join('');
    if (skillFused.length < 2) continue;

    for (let i = 0; i < tokens.length; i++) {
      if (consumed[i]) continue;
      let span = 0;
      if (tokens[i] === skillFused || tokens[i] === `${skillFused}js`) {
        span = 1;
      } else if (skillWords.length > 1) {
        const slice = tokens.slice(i, i + skillWords.length);
        if (slice.length === skillWords.length && !slice.some((_, k) => consumed[i + k]) && slice.join('') === skillFused) {
          span = skillWords.length;
        }
      }
      if (span) {
        for (let k = 0; k < span; k++) consumed[i + k] = true;
        found.push(skillLabel(keyword));
        break; // one hit per keyword is enough even if it appears more than once
      }
    }
  }
  return found;
}

module.exports = { SKILL_BUCKETS, SKILL_LABEL_OVERRIDES, skillLabel, ALL_SKILL_KEYWORDS, normalizeSkillText, textContainsSkill, extractSkillsFromText, isNonSkillEntry };
