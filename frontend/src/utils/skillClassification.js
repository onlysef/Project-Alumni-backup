// Mirrors backend/utils/skillMatching.js SKILL_BUCKETS, for display grouping only; keep in sync.

const SOFT_SKILL_KEYWORDS = [
  'communication', 'presentation', 'writing', 'leadership', 'teamwork', 'collaboration',
  'public speaking', 'negotiation', 'interpersonal skills', 'coordination', 'planning',
  'problem solving', 'critical thinking', 'decision making', 'time management', 'attention to detail',
  'adaptability', 'adaptable', 'flexibility', 'flexible', 'work ethic', 'hardworking', 'hard working',
  'multitasking', 'multitask', 'patience', 'patient', 'initiative', 'creativity', 'creative', 'positive attitude', 'work under pressure',
  'conflict resolution', 'emotional intelligence', 'willingness to learn', 'fast learner', 'resourcefulness', 'resourceful',
  'reliability', 'reliable', 'self motivation',
  'customer service', 'client relations', 'complaint handling', 'customer support',
  'administrative support', 'calendar management', 'email management', 'scheduling',
  'employee relations', 'onboarding', 'training and development', 'mentoring', 'facilitation', 'tutoring',
];

const HARD_SKILL_KEYWORDS = [
  'javascript', 'python', 'java', 'c++', 'c#', 'php', 'programming', 'coding', 'typescript', 'ruby', 'swift', 'kotlin', 'software development', 'algorithms', 'data structures', 'cobol', 'mainframe', 'as400', 'rpg', 'golang', 'rust', 'perl', 'bash', 'powershell', 'shell scripting', 'vb.net',
  'html', 'css', 'react', 'node', 'vue', 'angular', 'web development', 'frontend', 'backend', 'wordpress', 'next.js', 'tailwind', 'bootstrap', 'rest api', 'laravel', 'django', 'flask', 'spring boot', 'asp.net', 'jquery', 'graphql', 'ruby on rails',
  'sql', 'mysql', 'database', 'oracle', 'mongodb', 'postgresql', 'data management', 'firebase', 'nosql', 'sql server', 'redis', 'db2', 'sqlite', 'pl/sql',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'devops', 'ci/cd', 'terraform', 'jenkins', 'ansible',
  'networking', 'cisco', 'network', 'router', 'firewall', 'network security', 'lan', 'wan', 'ip addressing', 'network administration',
  'figma', 'design', 'ui', 'ux', 'photoshop', 'adobe', 'wireframe', 'prototyping', 'illustrator', 'canva', 'graphic design', 'video editing',
  'project management', 'agile', 'scrum', 'kanban', 'jira', 'trello', 'risk management',
  'technical support', 'call center', 'chat support', 'email support', 'crm', 'zendesk', 'helpdesk',
  'virtual assistant', 'remote work', 'data entry', 'transcription', 'social media management',
  'patient care', 'nursing', 'clinical', 'medical assistant', 'first aid', 'cpr', 'pharmacy', 'healthcare', 'medical billing', 'emr', 'vital signs',
  'quality control', 'production', 'autocad', 'cad', 'assembly', 'lean manufacturing', 'six sigma', 'machining', 'inventory management', 'process improvement', 'quality assurance',
  'accounting', 'accountant', 'bookkeeping', 'bookkeeper', 'quickbooks', 'payroll', 'taxation', 'tax preparation', 'auditing', 'audit', 'financial analysis', 'budgeting', 'reconciliation', 'accounts payable', 'accounts receivable', 'cost accounting',
  'digital marketing', 'social media marketing', 'seo', 'content creation', 'sales', 'branding', 'copywriting', 'market research', 'advertising', 'lead generation',
  'clerical', 'office administration', 'filing', 'records management', 'ms office', 'excel', 'word', 'powerpoint', 'documentation',
  'recruitment', 'hr policies', 'talent acquisition', 'performance management', 'compensation',
  'teaching', 'teacher', 'educator', 'instructor', 'professor', 'tutor', 'lesson planning', 'lesson plan', 'lesson plans', 'curriculum development', 'curriculum planning', 'classroom management', 'classroom instruction', 'classroom discipline', 'student assessment', 'educational assessment', 'grading', 'academic advising', 'differentiated instruction', 'teaching strategies', 'instructional materials', 'module writing', 'learning modules', 'remedial teaching', 'special education', 'values education', 'guidance counseling', 'guidance counselor', 'student counseling', 'career guidance', 'training',
  'construction', 'carpentry', 'welding', 'electrical work', 'plumbing', 'site supervision', 'blueprint reading', 'safety compliance',
];

const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function wholeWordMatch(text, keyword) {
  const skillWords = normalize(keyword).split(' ').filter(Boolean);
  const skillFused = skillWords.join('');
  if (skillFused.length < 2) return false;
  const textWords = normalize(text).split(' ').filter(Boolean);
  for (let i = 0; i < textWords.length; i++) {
    if (textWords[i] === skillFused || textWords[i] === `${skillFused}js`) return true;
    if (skillWords.length > 1 && textWords.slice(i, i + skillWords.length).join('') === skillFused) return true;
  }
  return false;
}

// Check the longest keywords first across both lists, so "patient care" beats "patient".
const KEYWORD_TYPES = [
  ...SOFT_SKILL_KEYWORDS.map((keyword) => ({ keyword, type: 'soft' })),
  ...HARD_SKILL_KEYWORDS.map((keyword) => ({ keyword, type: 'hard' })),
].sort((a, b) => b.keyword.length - a.keyword.length);

// Exact match for short symbol skills like "C++"/"C#", which wholeWordMatch skips.
const EXACT_SYMBOL_KEYWORDS = { 'c++': 'hard', 'c#': 'hard' };

export function classifySkill(skillText) {
  const exact = EXACT_SYMBOL_KEYWORDS[(skillText || '').trim().toLowerCase()];
  if (exact) return exact;
  for (const { keyword, type } of KEYWORD_TYPES) {
    if (wholeWordMatch(skillText, keyword)) return type;
  }
  return 'other';
}
