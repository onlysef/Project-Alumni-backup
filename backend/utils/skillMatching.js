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
  { name: 'Programming', keywords: ['javascript', 'python', 'java', 'c++', 'c#', 'php', 'programming', 'coding', 'typescript', 'ruby', 'swift', 'kotlin', 'software development', 'algorithms', 'data structures'] },
  { name: 'Web Development', keywords: ['html', 'css', 'react', 'node', 'vue', 'angular', 'web development', 'frontend', 'backend', 'wordpress', 'next.js', 'tailwind', 'bootstrap', 'rest api', 'laravel'] },
  { name: 'Database Management', keywords: ['sql', 'mysql', 'database', 'oracle', 'mongodb', 'postgresql', 'data management', 'firebase', 'nosql'] },
  { name: 'Networking', keywords: ['networking', 'cisco', 'network', 'router', 'firewall', 'network security', 'lan', 'wan', 'ip addressing', 'network administration'] },
  { name: 'Design', keywords: ['figma', 'design', 'ui', 'ux', 'photoshop', 'adobe', 'wireframe', 'prototyping', 'illustrator', 'canva', 'graphic design', 'video editing'] },
  { name: 'Project Management', keywords: ['project management', 'agile', 'scrum', 'planning', 'scheduling', 'kanban', 'jira', 'trello', 'coordination', 'risk management'] },
  { name: 'Communication', keywords: ['communication', 'presentation', 'writing', 'leadership', 'teamwork', 'collaboration', 'public speaking', 'negotiation', 'interpersonal skills'] },
  { name: 'Customer Service & Support', keywords: ['customer service', 'technical support', 'call center', 'chat support', 'email support', 'crm', 'zendesk', 'helpdesk', 'client relations', 'complaint handling', 'customer support'] },
  { name: 'Virtual Assistance', keywords: ['virtual assistant', 'remote work', 'scheduling', 'email management', 'calendar management', 'data entry', 'transcription', 'social media management', 'administrative support'] },
  { name: 'Healthcare', keywords: ['patient care', 'nursing', 'clinical', 'medical assistant', 'first aid', 'cpr', 'pharmacy', 'healthcare', 'medical billing', 'emr', 'vital signs'] },
  { name: 'Manufacturing & Engineering', keywords: ['quality control', 'production', 'autocad', 'cad', 'assembly', 'lean manufacturing', 'six sigma', 'machining', 'inventory management', 'process improvement', 'quality assurance'] },
  { name: 'Finance & Accounting', keywords: ['accounting', 'bookkeeping', 'quickbooks', 'payroll', 'taxation', 'auditing', 'financial analysis', 'budgeting', 'reconciliation', 'accounts payable', 'accounts receivable'] },
  { name: 'Marketing & Sales', keywords: ['digital marketing', 'social media marketing', 'seo', 'content creation', 'sales', 'branding', 'copywriting', 'market research', 'advertising', 'lead generation'] },
  { name: 'Administrative & Office', keywords: ['clerical', 'office administration', 'filing', 'records management', 'ms office', 'excel', 'word', 'powerpoint', 'documentation', 'data entry'] },
  { name: 'Human Resources', keywords: ['recruitment', 'employee relations', 'onboarding', 'hr policies', 'talent acquisition', 'performance management', 'compensation', 'training and development'] },
  { name: 'Education & Training', keywords: ['teaching', 'lesson planning', 'tutoring', 'curriculum development', 'classroom management', 'training', 'mentoring', 'facilitation'] },
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
};

const skillLabel = (keyword) => SKILL_LABEL_OVERRIDES[keyword] || keyword.replace(/\b\w/g, (c) => c.toUpperCase());

// Flat, deduplicated keyword vocabulary drawn from SKILL_BUCKETS (already
// spans IT, healthcare, finance, HR, education, trades, etc.) — used by
// Job Connect to figure out which real skills a Careerjet posting is
// actually asking for, since Careerjet itself returns free-text
// descriptions with no structured skill tags.
const ALL_SKILL_KEYWORDS = [...new Set(SKILL_BUCKETS.flatMap((b) => b.keywords))];

const normalizeSkillText = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function textContainsSkill(userSkillsText, skill) {
  const norm = normalizeSkillText(skill);
  // Symbol-heavy keywords like "C++" or "C#" strip down to a bare "c" once
  // punctuation is removed, which then matches almost any text — too short
  // to be a meaningful signal, so skip them rather than false-positive.
  if (norm.length < 2) return false;
  return normalizeSkillText(userSkillsText).includes(norm);
}

module.exports = { SKILL_BUCKETS, SKILL_LABEL_OVERRIDES, skillLabel, ALL_SKILL_KEYWORDS, normalizeSkillText, textContainsSkill };
