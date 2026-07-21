const Graduate = require('../models/Graduate');
const User = require('../models/User');
const { runWithCollegeScope } = require('../utils/collegeScope');

// ─── Intent Detection ─────────────────────────────────────────────────────────

const TOPIC_PATTERNS = {
  // "names? of" used to match bare, with zero requirement that the question
  // have anything to do with alumni — "What is the NAME OF the earthlike
  // planet..." matched it directly and returned an unrelated 50-alumni
  // roster. Now requires "alumni/graduates/respondents" within a few words
  // after "name(s) of." The `.*alumni`/`alumni.*name`-style alternatives
  // are bounded to `.{0,30}` for the same reason (unbounded `.*` risks
  // matching "name" and "alumni" anywhere in a long, unrelated sentence).
  names:           /\b(who are|who (did|do|does|didn'?t|don'?t|doesn'?t|have|has|haven'?t|hasn'?t|were|was|weren'?t|wasn'?t|passed|failed|took|pursued|works?|worked)|names?\s+of\s+(?:the\s+)?(?:\w+\s+){0,3}(?:alumni|graduates?|respondents?)|list.{0,20}(names?|alumni|graduates?)|show.{0,20}(names?|alumni|graduates?)|which alumni|which graduates?|name.{0,30}alumni|alumni.{0,30}name|graduates?.{0,30}name|name.{0,30}graduates?)\b/i,
  count:           /\b(how many (?:\w+\s+){0,4}(alumni|records?|graduates?|respondents?|people)|how many (passed|failed|took|pursued|work\w*|did)|total (alumni|records?|graduates?|respondents?)|number of (alumni|records?|graduates?|respondents?)|how many are there|how many alumni are)\b/i,
  // "percentage of (?:\w+\s+){0,3}(graduates?|alumni)" — was bare-adjacent
  // only ("percentage of graduates"), so an informal, prefix-less phrasing
  // like "percentage of BSIT graduates" (a program name sitting between "of"
  // and "graduates") matched NOTHING here, fell through detectTopic() with
  // no topic at all, and got swallowed whole by the bare-industry-noun-
  // phrase heuristic near the end of query() — which then searched the
  // industry field for the literal string "percentage of BSIT graduates",
  // found nothing, and surfaced the generic "I don't have enough data"
  // refusal for a question this app can answer perfectly well.
  rate:            /\b(what\s+(percentage|percent|rate)|how\s+many\s+percent|employment\s+rate|percentage\s+of\s+(?:\w+\s+){0,3}(graduates?|alumni)|found\s+a\s+job|got\s+a\s+job)\b/i,
  overview:        /\b(tracer survey activity|tracer study activity|overview|summary|overall|general (data|info|result|stat)|show.*tracer|tracer.*result|employment\s+breakdown|employment\s+data|employment\s+statistic)\b/i,
  industry:        /\bindustr/i,
  work_type:       /\b(government|private|sector|work type|type of (employment|work)|employment type)\b/i,
  job_relevance:   /\b(related|relevance|relevant\s+to\s+(?:the(?:ir)?\s+)?(?:course|study|program|degree|field)|align(?:s|ed|ment)?\s+(?:with|to)\b.{0,20}\b(?:course|study|studied|program|degree|field))\b/i,
  further_studies: /\b(further studies?|graduate studies?|masters?|phd|post.?grad|further education)\b/i,
  licensure:       /\blicens\w*\b|\b(board\s+exam|professional\s+exam|prc)\b|\b(tak\w*|pass\w*|fail\w*).{0,20}\bexam\b/i,
  competencies:    /\b(competenc\w*|skill\s+ratings?|self.?assess|performance|technical\s+skills?|communication\s+skills?|problem.?solving|critical\s+thinking|teamwork|adaptability|project\s+management)\b/i,
  work_location:   /\b(local(?:ly)?|abroad|work location|place of work|overseas)\b/i,
  by_program:      /\b(by program|by course|per program|per course|each program|program breakdown)\b/i,
  by_year:         /\b(by (batch|year|graduation)|per (batch|year)|each (batch|year)|year breakdown|batch breakdown)\b/i,
  gender:          /\b(gender|\bmale\b|\bfemale\b|\bmen\b|\bwomen\b)\b/i,
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

// Words that justify falling back to the general employment breakdown when no
// specific topic pattern matched. Without this gate, ANY unmatched statistical
// question (e.g. "what skills do graduates use?", "average salary?") would
// silently return the employment Yes/No breakdown — a confident answer to the
// wrong question, which is worse than admitting no data is available.
const EMPLOYMENT_SIGNAL = /employ|\bjob|\bwork|\bstatus\b|\boccupation\b|\bposition\b/i;

function detectTopic(question) {
  question = normalizeQuestion(question);
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (pattern.test(question)) return topic;
  }
  return EMPLOYMENT_SIGNAL.test(question) ? 'employment' : null;
}

// A negation word appearing shortly before a phrase — "not self-employed",
// "who doesn't work in IT", "not employed locally" — means the question
// wants that phrase EXCLUDED, not matched positively. Proximity-limited (same
// clause, ~25 chars) and checks every negation occurrence in the question
// (not just the first) so a negation attached to one filter in a compound
// question ("aren't self-employed but working in IT") doesn't leak onto an
// unrelated filter mentioned later in the same sentence.
function isNegatedBeforeIndex(question, targetIndex, maxGap = 25) {
  if (targetIndex === null || targetIndex === undefined) return false;
  const negRe = /\b(not|n't|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t)\b/gi;
  let m;
  while ((m = negRe.exec(question))) {
    if (m.index < targetIndex && (targetIndex - m.index) <= maxGap) return true;
  }
  return false;
}

function isNegatedBefore(question, phraseSource, maxGap = 25) {
  const phraseMatch = new RegExp(phraseSource, 'i').exec(question);
  if (!phraseMatch) return false;
  return isNegatedBeforeIndex(question, phraseMatch.index, maxGap);
}

function extractFilters(question) {
  question = normalizeQuestion(question);
  const filters = {};

  // Combined program+track shorthand: "BSIT-TSM", "BSIT/WMA", "BSIT NA".
  // Must run BEFORE the generic BS-prefix match below, which stops at the
  // hyphen/slash and would otherwise truncate this to plain "BSIT" — silently
  // dropping the track and matching the whole Information Technology program
  // instead of the specific specialization asked about. filters.program is
  // used as a MongoDB regex, so "X.*Y" requires both substrings present in
  // order, matching the real stored format ("...Information Technology -
  // Specialized in Technical Service Management").
  const TRACK_MAP = { TSM: 'Technical Service Management', WMA: 'Web and Mobile Application', NA: 'Network Administration' };
  const trackMatch = question.match(/\bBS[- ]?IT\s*[-\/]\s*(TSM|WMA|NA)\b/i);
  if (trackMatch) {
    const track = TRACK_MAP[trackMatch[1].toUpperCase()];
    filters.program = `Information Technology.*${track}`;
    // filterLabel() prefers this for display so the answer reads naturally
    // instead of showing the raw ".*" regex used for matching.
    filters.programLabel = `Information Technology - ${track}`;
  }

  // Program name: "BSCS graduates", "BSIT students", etc.
  const courseMatch = !filters.program && question.match(/\b(BS[A-Z]{1,8}|B\.?S\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?|Bachelor(?:\s+of\s+[A-Za-z]+)+)\b/i);
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

  // "the past/last N years" — a MINIMUM year (inclusive range), not a single
  // exact year. Without this, "over the past three years" was silently
  // dropped entirely (no year-related word this regex recognizes), so a
  // trend question ended up answered with the ALL-TIME aggregate across
  // every batch ever recorded instead of the recent window actually asked
  // about — a materially different, misleading number.
  if (!filters.yearGraduated) {
    const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const pastYearsMatch = question.match(/\b(?:past|last)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/i);
    if (pastYearsMatch) {
      const n = NUMBER_WORDS[pastYearsMatch[1].toLowerCase()] || parseInt(pastYearsMatch[1], 10);
      if (n > 0) filters.yearFrom = new Date().getFullYear() - n + 1;
    }
  }

  // Industry — path 1: explicit "industry/sector/field" keyword
  // Note: no \b after "industr" — "industry"/"industries" don't have boundary after "industr"
  let industryMatchIndex = null;
  if (/\bindustr|\bsector\b|\bfield\b/i.test(question)) {
    const indMatch = question.match(/\b(?:works?\s+in|working\s+in|employed\s+in|in)\s+(?:the\s+)?([a-zA-Z](?:[a-zA-Z ]){1,49}?)(?=\s+(?:industr|sector|field))/i);
    if (indMatch) { filters.industry = indMatch[1].trim(); industryMatchIndex = indMatch.index; }
  }
  // Industry — path 2: verb-based "work(s) in / working in / employed in X" without keyword.
  // The (?<!self[- ])(?<!never\s) guards stop "self-employed in BSIT" / "never
  // employed in BSIT" from matching "employed in X" and misreading a program
  // abbreviation as an industry name — "employed" is a substring of both
  // compound status phrases, so without this guard the regex fired on them too.
  if (!filters.industry) {
    const verbMatch = question.match(/\b(?:works?\s+in|working\s+in|(?<!self[- ])(?<!never\s)employed\s+in)\s+(?:the\s+)?([a-zA-Z][a-zA-Z ]{1,49}?)(?=[?,!.]|$)/i);
    if (verbMatch) {
      const candidate = verbMatch[1].trim();
      // "working in A FIELD RELATED TO their degree" — no punctuation
      // appears until the end of the sentence, so the lazy capture above
      // expands all the way past "field" into the entire rest of the
      // clause, mistaking a job-relevance idiom ("field" = field of study,
      // not industry) for an industry name. Reject any candidate matching
      // this idiom outright — it belongs to the jobRelated filter below,
      // not here.
      const isJobRelevancePhrase = /\brelated\s+to\s+(?:their|his|her|its)?\s*(course|degree|program|study|studies|field)\b/i.test(candidate);
      if (!isJobRelevancePhrase && !/^(the|a|an|this|that|those|our|their|its|any|all|database|system|table|records?|fields?)$/i.test(candidate)) {
        filters.industry = candidate;
        industryMatchIndex = verbMatch.index;
      }
    }
  }
  // "who does NOT work in IT" / "not working in the government sector" — the
  // industry was matched correctly above, but as a POSITIVE filter; if a
  // negation word sits right before the verb phrase that introduced it, the
  // question actually wants everyone EXCLUDING that industry.
  if (filters.industry && isNegatedBeforeIndex(question, industryMatchIndex)) {
    filters.excludeIndustry = filters.industry;
    delete filters.industry;
  }

  // Job title: "working as a software engineer", "employed as a nurse",
  // "alumni that are software engineers" — was completely unsupported
  // before, so any question naming a specific job title silently answered
  // with the ALL-alumni total instead, ignoring the title entirely. Trailing
  // plural "s" is made optional in the match regex (not stripped from the
  // display text) so "software engineers" still matches a stored singular
  // "Software Engineer" record.
  //
  // A bare "who are the X?" / "who works as an X?" fallback was added below
  // — the shorter, more natural way to ask this ("Who are the software
  // engineers?", "Who works as a software engineer?") used to fall through
  // with NO job title extracted at all, silently returning the entire
  // unfiltered 50-alumni roster: a confident wrong answer, not just an
  // incomplete one. It's tried LAST (after the more specific "that are/is X"
  // form) so a compound sentence like "who are the alumni that are X" still
  // captures the correct (shorter) span from the "that are" branch instead
  // of the bare "who are" branch grabbing the whole rest of the sentence.
  const jobTitleMatch = question.match(/\b(?:working|works?|employed)\s+as\s+(?:an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i)
    || question.match(/\bthat\s+(?:are|is)\s+(?:an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i)
    || question.match(/\bwho\s+(?:are|is)\s+(?:the\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i);
  if (jobTitleMatch) {
    const candidate = jobTitleMatch[1].trim();
    // Excludes words already handled by their own dedicated filters — "that
    // are employed"/"that are self-employed"/"that are male" are status/
    // gender questions, not job-title lookups, and would otherwise get
    // double (and wrongly) interpreted as a literal job title of "employed."
    const isGenericWord = /^(the|a|an|this|that|those|our|their|its|any|all|employed|unemployed|self[- ]?employed|never\s+employed|male|female|men|women|working|local|abroad|related|graduates?|alumni|respondents?)$/i.test(candidate);
    // The bare "who are/is X" fallback captures the WHOLE rest of the
    // sentence (no "that are"/"working as" anchor to stop it early), so a
    // question like "who are the male alumni from BSIT" would otherwise
    // capture "male alumni from bsit" wholesale as a literal (unmatchable)
    // job title, silently overriding the gender/program filters that
    // extractFilters() correctly sets elsewhere for the same words. Reject
    // any candidate that CONTAINS one of those already-claimed qualifier
    // words, not just an exact match — this guard only applies to the
    // multi-word-prone bare fallback; the two narrower, explicitly-anchored
    // forms above keep their original exact-match check untouched.
    const containsClaimedWord = /\b(employed|unemployed|self[- ]?employed|male|female|men|women|working|local(?:ly)?|abroad|overseas|related|relevant|graduates?|alumni|respondents?|program|course|batch|year)\b/i.test(candidate);
    if (!isGenericWord && !containsClaimedWord) {
      filters.jobTitle = candidate;
      filters.jobTitleRegex = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/i, 's?');
    }
  }

  // Employment status — only set for a single-status question ("how many are
  // unemployed?"). A compound question mentioning multiple statuses ("statistics
  // of employed and unemployed") must leave this unset so queryEmployment()
  // returns the full breakdown instead of silently narrowing to whichever
  // status this if/else-if chain happened to check first, dropping the rest
  // of the question. \bemployed\b does NOT match inside "unemployed" (no word
  // boundary between "un" and "employed"), but DOES match inside "self-employed"
  // and "never employed" (hyphen/space creates a boundary) — counted (not just
  // boolean-excluded) so a question like "employed including self employed",
  // which has BOTH a standalone "employed" AND a separate "self employed",
  // still detects the standalone one instead of discarding it entirely.
  const neverEmployedCount = (question.match(/\bnever\s*employed\b/gi) || []).length;
  const selfEmployedCount  = (question.match(/\bself[- ]?employed\b/gi) || []).length;
  const allEmployedCount   = (question.match(/\bemployed\b/gi) || []).length;
  const hasNeverEmployed = neverEmployedCount > 0;
  const hasSelfEmployed  = selfEmployedCount > 0;
  // Natural paraphrases of "unemployed" that never use the literal word at
  // all ("still looking for work") were silently invisible to status
  // detection — the question fell through with no employmentStatus filter
  // set, so "graduates from batch 2022 still looking for work" answered
  // with the TOTAL batch headcount instead of the unemployed count, while
  // the literal "unemployed" phrasing of the exact same question answered
  // correctly — two answers for one question, disagreeing by 9x.
  const hasUnemployed    = /\bunemployed\b|\b(looking for (a )?(job|work)|job.?hunt(ing)?|seeking (a )?(job|employment|work)|searching for (a )?(job|work)|out of (a )?work|jobless|without (a )?job|haven'?t found (a )?job|(never|didn'?t|hasn'?t|hadn'?t)\s+(got|get|found|landed|secured)\s+(a\s+)?job|no job yet)\b/i.test(question);
  // Natural paraphrases of "employed" ("found/got/landed a job") were the
  // mirror-image gap of the unemployed-paraphrase fix above: these were only
  // ever used to pick the 'rate' TOPIC_PATTERNS bucket, never to actually set
  // an employmentStatus filter — so "How many alumni got a job in IT?" fell
  // straight through to queryCount() with NO status filter at all, silently
  // answering with the raw IT-program headcount (149) as if it had answered
  // the employment question. The negative lookahead-style check right after
  // excludes "haven't/hasn't/never/didn't found/got a job" (already correctly
  // handled as UNemployed above) so the two signals can't both fire and
  // produce a nonsensical two-status compound for a single-status question.
  const employedPhrase = /\b(?:found|got|get|landed|secured)\s+(?:a\s+)?job\b/i.test(question)
    && !/\b(?:haven'?t|hasn'?t|hadn'?t|never|didn'?t|doesn'?t|not)\s+(?:\w+\s+){0,2}(?:found|got|get|landed|secured)\b/i.test(question);
  const hasPlainEmployed = (allEmployedCount - selfEmployedCount - neverEmployedCount) > 0 || employedPhrase;

  // "employed locally/abroad" is a location descriptor ("works locally"), not
  // an independent status claim on top of the location. Treating "employed"
  // here as its own separate status filter is harmless for a positive
  // question (both filters point the same way), but for a negated one ("NOT
  // employed locally") it wrongly produces the AND of two negations —
  // "status != Yes AND location != local" — a far stricter, near-empty
  // intersection than the intended "doesn't work locally."
  let plainEmployedIsLocationPhrase = false;
  if (hasPlainEmployed) {
    const plainMatch = /(?<!self[- ])(?<!never\s)\bemployed\b/i.exec(question);
    if (plainMatch && /\blocal(?:ly)?\b|\babroad\b|\boverseas\b/i.test(question.slice(plainMatch.index, plainMatch.index + 30))) {
      plainEmployedIsLocationPhrase = true;
    }
  }

  const matchedStatuses = [];
  if (hasNeverEmployed) matchedStatuses.push('Never Employed');
  if (hasSelfEmployed)  matchedStatuses.push('Self-Employed');
  if (hasUnemployed)    matchedStatuses.push('No');
  if (hasPlainEmployed && !plainEmployedIsLocationPhrase) matchedStatuses.push('Yes');

  // Status-specific negation: "how many are NOT self-employed?" asks for the
  // complement of that one status (everyone else), not the status itself.
  // Only meaningful for a single matched status — a compound mention already
  // has its own explicit list via employmentStatuses below, and negating one
  // of several named statuses at once is an edge case not worth the ambiguity.
  const STATUS_PHRASE = {
    'Never Employed': 'never\\s*employed',
    'Self-Employed':  'self[- ]?employed',
    'No':             'unemployed',
    'Yes':            '(?<!self[- ])(?<!never\\s)employed',
  };

  if (matchedStatuses.length === 1) {
    const status = matchedStatuses[0];
    if (isNegatedBefore(question, STATUS_PHRASE[status])) {
      filters.excludeEmploymentStatus = status;
    } else {
      filters.employmentStatus = status;
    }
  } else if (matchedStatuses.length > 1) {
    // Compound question ("employed and unemployed") — record exactly which
    // statuses were asked about so queryEmployment() can show only those
    // rows, not every status that exists in the data. Also doubles as the
    // marker that stops the bare-noun-phrase industry guesser below from
    // mistaking the whole question for a literal industry name just because
    // employmentStatus ended up unset here.
    filters.employmentStatuses = matchedStatuses;
  }

  // Gender filter — \bmale\b never matches inside "female" (no word boundary
  // before "male" there), so check order doesn't matter, but female is checked
  // first for clarity anyway.
  if (/\bfemale\b|\bwomen\b/i.test(question))      filters.gender = 'Female';
  else if (/\bmale\b|\bmen\b/i.test(question))     filters.gender = 'Male';

  // Exclude self-employed modifier
  if (/\b(don'?t|do\s+not|exclude|not\s+includ|without).{0,25}self[- ]?employ/i.test(question)) {
    filters.excludeSelfEmployed = true;
  }

  // Work location filter — only set for a single-sided question ("who works
  // abroad?"). A compound comparison ("locally vs. abroad") must leave this
  // unset so queryWorkLocation() returns the full local+abroad breakdown
  // instead of silently answering only the "local" half (this used to always
  // match "local" first via if/else-if, dropping "abroad" from the answer).
  // "local(?:ly)?" — NOT "locally?", which requires a double-L ("locall"/"locally")
  // and silently never matches bare "local" since `?` only applies to the "y".
  // "outside the Philippines" / "within the Philippines" — this app is
  // Philippines-specific (TSU), so a literal country name is at least as
  // common a phrasing as the generic "country" noun, which the original
  // pattern required verbatim and silently missed entirely.
  const hasLocalSignal  = /\blocal(?:ly)?\b|\bwithin.{0,20}(country|philippines)\b|\bhome\s+country\b/i.test(question);
  const hasAbroadSignal = /\babroad\b|\boverseas\b|\boutside.{0,20}(country|philippines)\b/i.test(question);
  if (hasLocalSignal && !hasAbroadSignal) {
    filters.workLocation = 'local';
  } else if (hasAbroadSignal && !hasLocalSignal) {
    filters.workLocation = 'abroad';
  }
  // "who is NOT employed locally?" / "not working abroad" — the workLocation
  // field only has two real values (Local/Abroad), so negating one is
  // equivalent to matching "not this value" rather than flipping to the
  // other, which stays correct even if a third value gets added later.
  if (filters.workLocation) {
    const phrase = filters.workLocation === 'local' ? 'local(?:ly)?' : 'abroad|overseas';
    if (isNegatedBefore(question, phrase)) filters.negateWorkLocation = true;
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

  // Job relevance filter — requires "job/jobs" or "field" (a common synonym
  // in "field related to their degree/course") to avoid extracting from
  // generic overview questions ("Is the work relevant to their degree?"
  // should NOT set this; "jobs/field related to course" should).
  if (/\b(jobs?|field).{0,40}(related|relevant)\b/i.test(question) ||
      /\b(related|relevant).{0,20}(jobs?|field)\b/i.test(question) ||
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

  // Board / licensure exam filter — negation must bind to the RIGHT verb.
  // "did not pass" means failed (or at least not-passed), NOT "never took
  // the exam" — a single generic "did not/didn't/never" check used to
  // collapse both into tookExam='no', silently mislabeling "did not pass the
  // board exam" as "never took it." Check take/pass/fail negation separately.
  if (/\blicens\w*\b|\b(board\s+exam|professional\s+exam|prc|tak\w*.{0,20}\bexam\b|pass\w*.{0,20}\bexam\b|fail\w*.{0,20}\bexam\b)\b/i.test(question)) {
    const notTook = /\b(?:did\s*not|didn'?t|never|not)\s+(?:\w+\s+){0,1}(?:tak|attend|sit)/i.test(question);
    const notPass = /\b(?:did\s*not|didn'?t|not)\s+(?:\w+\s+){0,1}pass/i.test(question);
    const notFail = /\b(?:did\s*not|didn'?t|not)\s+(?:\w+\s+){0,1}fail/i.test(question);
    if (notTook)                            filters.tookExam = 'no';
    else if (notPass)                       filters.tookExam = 'failed';
    else if (notFail)                       filters.tookExam = 'passed';
    else if (/\bpass\w*\b/i.test(question)) filters.tookExam = 'passed';
    else if (/\bfail\w*\b/i.test(question)) filters.tookExam = 'failed';
    else                                    filters.tookExam = 'yes';
  }

  return filters;
}

function filterLabel(filters) {
  const parts = [];
  if (filters.programLabel)  parts.push(filters.programLabel);
  else if (filters.program)  parts.push(filters.program);
  if (filters.yearGraduated) parts.push(`Batch ${filters.yearGraduated}`);
  else if (filters.yearFrom) parts.push(`${filters.yearFrom} onward`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

// Prefix like "female " / "male " for a sentence's grammatical subject —
// mirrors queryCount()'s established convention. Applied individually (not
// folded into filterLabel()) so it doesn't risk double-mentioning gender in
// queryCount()/queryNames(), which already handle it themselves.
function genderPrefix(filters) {
  return filters.gender ? `${filters.gender.toLowerCase()} ` : '';
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
  // Was missing: filters.gender was extracted by extractFilters() but never
  // applied anywhere except queryGender() itself — every other function
  // (queryCount, queryEmployment, queryIndustry, etc.) silently ignored a
  // "male"/"female" qualifier and answered for everyone instead, with no
  // indication anything was dropped. Adding it here as a stable pre-filter
  // fixes every function that uses stablePipeline() in one place.
  if (filters.gender)        match.gender        = { $regex: `^${filters.gender}$`, $options: 'i' };
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

  // If the question named specific statuses ("employed and unemployed"),
  // only show those rows — answer exactly what was asked, not every status
  // that happens to exist in the data.
  const displayRows = filters.employmentStatuses
    ? rows.filter(r => filters.employmentStatuses.some(s => new RegExp(`^${s}$`, 'i').test(r._id)))
    : rows;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `Based on the tracer study data${lbl}, there are **${total}** ${gPrefix}respondents.\n\n`;
  out += `**Employment Breakdown:**\n`;
  displayRows.forEach(r => { out += `- ${r._id}: **${r.count}** (${pct(r.count, total)})\n`; });

  // The "overall employment rate" synthesizes beyond just the requested
  // statuses (it folds Self-Employed into "employed"), so only show it for
  // the full, unfiltered breakdown.
  if (!filters.employmentStatuses) {
    out += `\n**Overall employment rate: ${pct(employed, total)}** (${employed} out of ${total}, including self-employed)`;
  } else if (filters.employmentStatuses.includes('Yes') && filters.employmentStatuses.includes('Self-Employed')) {
    // A question that explicitly pairs "employed" with "self-employed"
    // ("employed together with self-employed") is asking for one combined
    // count, not two separate rows to add up by hand — self-employed is
    // conceptually a form of being employed (same as the unfiltered
    // "Overall employment rate" above already treats it).
    out += `\n**Combined (employed + self-employed): ${employed}** (${pct(employed, total)})`;
  }
  return out;
}

async function queryIndustry(filters) {
  const pipeline = [
    ...stablePipeline(filters),
    { $match: { industry: { $nin: [null, ''] } } },
  ];
  if (filters.industry) pipeline.push({ $match: { industry: { $regex: filters.industry, $options: 'i' } } });
  else if (filters.excludeIndustry) pipeline.push({ $match: { industry: { $not: { $regex: filters.excludeIndustry, $options: 'i' } } } });

  // Every other filter extractFilters() may have picked up alongside the
  // industry question ("what industries do SELF-EMPLOYED alumni work in?",
  // "...alumni working ABROAD?") was previously silently dropped here — this
  // function only ever applied filters.industry/excludeIndustry, so
  // "self-employed", "employed", and unfiltered all returned the exact same
  // top-10 list. Mirrors the same postDedup-style filters queryCount()/
  // queryNames() already apply.
  if (filters.employmentStatus) pipeline.push({ $match: { employmentStatus: { $regex: `^${filters.employmentStatus}`, $options: 'i' } } });
  if (filters.excludeEmploymentStatus) {
    pipeline.push({ $match: { employmentStatus: { $nin: [null, ''], $not: { $regex: `^${filters.excludeEmploymentStatus}`, $options: 'i' } } } });
  }
  if (filters.workLocation) {
    pipeline.push({ $match: { workLocation: filters.negateWorkLocation
      ? { $nin: [null, ''], $not: { $regex: filters.workLocation, $options: 'i' } }
      : { $regex: filters.workLocation, $options: 'i' } } });
  }
  if (filters.jobTitleRegex) pipeline.push({ $match: { jobTitle: { $regex: filters.jobTitleRegex, $options: 'i' } } });

  pipeline.push(
    { $group: { _id: '$industry', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  );
  if (!filters.industry && !filters.excludeIndustry && !filters.showAllIndustries) pipeline.push({ $limit: 10 });

  const rows = await Graduate.aggregate(pipeline);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  // "status" reads as an adjective before "alumni"/"graduates" ("self-employed
  // alumni"), so it's built and applied separately from the "working X/NOT
  // in Y" clauses that follow the noun.
  const statusAdj = filters.employmentStatus === 'Yes'                   ? 'employed '
                   : filters.employmentStatus === 'No'                    ? 'unemployed '
                   : filters.employmentStatus === 'Self-Employed'         ? 'self-employed '
                   : filters.employmentStatus === 'Never Employed'        ? '"never employed" '
                   : filters.excludeEmploymentStatus === 'Yes'            ? 'not-employed '
                   : filters.excludeEmploymentStatus === 'No'             ? 'not-unemployed '
                   : filters.excludeEmploymentStatus === 'Self-Employed'  ? 'not-self-employed '
                   : filters.excludeEmploymentStatus === 'Never Employed' ? 'not-"never employed" '
                   : '';
  const locLabel = filters.workLocation
    ? (filters.negateWorkLocation ? ` NOT working ${filters.workLocation}` : ` working ${filters.workLocation}`)
    : '';
  const subject = `${gPrefix}${statusAdj}alumni`;
  const subjectCap = subject.charAt(0).toUpperCase() + subject.slice(1);

  if (filters.industry) {
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**${subjectCap} working in ${filters.industry} industry${locLabel}${lbl}:**\n\n`;
    out += `Total: **${total}** graduate${total !== 1 ? 's' : ''}\n`;
    if (rows.length > 1) {
      out += `\nBreakdown:\n`;
      rows.forEach((r, i) => { out += `${i + 1}. **${r._id}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
    }
    return out;
  }

  if (filters.excludeIndustry) {
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**${subjectCap} NOT working in ${filters.excludeIndustry} industry${locLabel}${lbl}:**\n\n`;
    out += `Total: **${total}** graduate${total !== 1 ? 's' : ''}\n`;
    return out;
  }

  let out = `**Top industries where ${gPrefix}${statusAdj}graduates${locLabel}${lbl} are working:**\n\n`;
  rows.forEach((r, i) => { out += `${i + 1}. **${r._id}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
  return out;
}

async function queryGender(filters) {
  // Deliberately not using stablePipeline(filters) — gender is the dimension
  // being measured here, so pre-filtering by it (as stablePipeline now does
  // for every other function) would make every group collapse to just the
  // one gender asked about, breaking the "X% of Y total" denominator (it
  // would always show 100%). Only program/year make sense as pre-filters here.
  const stableMatch = {};
  if (filters.program)       stableMatch.program       = { $regex: filters.program, $options: 'i' };
  if (filters.yearGraduated) stableMatch.yearGraduated = filters.yearGraduated;

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { gender: { $nin: [null, ''] } } },
    { $addFields: { _trimmed: { $trim: { input: '$gender' } } } },
    { $addFields: { _key: { $toLower: '$_trimmed' } } },
    // Count each exact casing variant first ("Male" vs "MAle"), sorted so the
    // most common casing comes first within each group...
    { $group: { _id: { key: '$_key', variant: '$_trimmed' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    // ...then merge variants sharing the same normalized key, using $first to
    // pick the majority-casing spelling as the display label (not just
    // uppercasing everything, which would mangle "LGBTQIA+" into "Lgbtqia+").
    { $group: { _id: '$_id.key', count: { $sum: '$count' }, display: { $first: '$_id.variant' } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const lbl = filterLabel(filters);

  // Specific gender asked ("how many male?") → direct single count, not the
  // full breakdown, matching how queryCount() answers a specific-status ask.
  if (filters.gender) {
    const match = rows.find(r => r._id === filters.gender.toLowerCase());
    const count = match?.count ?? 0;
    return `There are **${count}** ${filters.gender.toLowerCase()} graduate${count !== 1 ? 's' : ''} in the tracer study database${lbl} (${pct(count, total)} of ${total} respondents with gender recorded).`;
  }

  let out = `**Gender breakdown${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r.display}**: ${r.count} (${pct(r.count, total)})\n`; });
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
  const gPrefix = genderPrefix(filters);
  let out = `**Employment type breakdown${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
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
  const gPrefix = genderPrefix(filters);
  let out = `> **Note:** The tracer study data does not have a dedicated government/private sector column. `;
  out += `The employment type breakdown below is the closest available data${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}.\n\n`;
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
  const gPrefix = genderPrefix(filters);
  let out = `**Job relevance to course of study${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  out += `\n${pct(yes, total)} of ${gPrefix}graduates work in a field related to their course.`;
  return out;
}

// Answers "which program leads to the most job-aligned graduates?" — computed
// directly from MongoDB (job-related rate per program), never estimated by
// the LLM. Programs with fewer than 3 respondents are excluded so a single
// lucky/unlucky record can't swing the "highest" result.
async function queryJobAlignmentByProgram(filters) {
  const stableMatch = {};
  if (filters.yearGraduated) stableMatch.yearGraduated = filters.yearGraduated;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${filters.gender}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, jobRelated: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    {
      $group: {
        _id:     '$_prog',
        total:   { $sum: 1 },
        related: { $sum: { $cond: [{ $regexMatch: { input: '$jobRelated', regex: /^yes/i } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => ({ ...r, rate: r.total > 0 ? r.related / r.total : 0 }))
    .sort((a, b) => b.rate - a.rate);
  const top = ranked[0];

  let out = `**Job alignment to field of study, by program:**\n\n`;
  ranked.forEach(r => { out += `- **${r._id}**: ${r.related}/${r.total} job-related (${pct(r.related, r.total)})\n`; });
  out += `\n**${top._id}** has the highest rate of graduates whose job aligns with what they studied, at **${pct(top.related, top.total)}**.`;
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
  const gPrefix = genderPrefix(filters);
  let out = `**Professional/licensure exam statistics${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  out += `- Took a professional exam: **${tookAny}** (${pct(tookAny, total)})\n`;
  out += `  - Passed: **${passed}**\n`;
  out += `  - Failed: **${failed}**\n`;
  out += `- Did not take: **${notTook}** (${pct(notTook, total)})\n`;
  out += `\nOut of **${total}** ${gPrefix}respondents.`;
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
  const gPrefix = genderPrefix(filters);
  let out = `**Further education after graduation${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  out += `- Pursued further education: **${pursued}** (${pct(pursued, total)})\n`;
  out += `- Did not pursue: **${notPursued}** (${pct(notPursued, total)})\n`;
  out += `\nOut of **${total}** ${gPrefix}respondents.`;
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
  const gPrefix = genderPrefix(filters);

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
    let out = `**${label} self-ratings${lbl} (${total} ${gPrefix}respondents):**\n\n`;
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

  let out = `**Most common competency self-ratings${lbl} (${r.count} ${gPrefix}respondents):**\n\n`;
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
    locMatch.workLocation = filters.negateWorkLocation
      ? { $not: { $regex: filters.workLocation, $options: 'i' } }
      : { $regex: filters.workLocation, $options: 'i' };
  }

  // Also count the STABLE cohort alone (program/year/gender, workLocation
  // recorded at all) so a zero result for the specific abroad/local filter
  // can be told apart from "this cohort has no work-location data at all" —
  // e.g. Batch 2023 genuinely has 43 people with a recorded work location
  // but 0 working abroad, which is a real, confident answer; without this
  // distinction the query returned null for that real "0" the same way it
  // would for a cohort with no data whatsoever, sending it to RAG instead.
  const [rows, stableRows] = await Promise.all([
    Graduate.aggregate([
      ...stablePipeline(filters),
      { $match: locMatch },
      { $group: { _id: '$workLocation', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Graduate.aggregate([
      ...stablePipeline(filters),
      { $match: { workLocation: { $nin: [null, ''] } } },
      { $count: 'total' },
    ]),
  ]);
  const stableTotal = stableRows[0]?.total ?? 0;
  if (stableTotal === 0) return null;

  const total = rows.reduce((s, r) => s + r.count, 0);
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  if (filters.workLocation) {
    const label = filters.workLocation === 'local' ? 'locally (within the Philippines)'
                : filters.workLocation === 'abroad' ? 'abroad / overseas'
                : filters.workLocation;
    const verb = filters.negateWorkLocation ? 'NOT working' : 'working';
    return `There are **${total}** ${gPrefix}graduate${total !== 1 ? 's' : ''} ${verb} **${label}**${lbl}.`;
  }
  if (!rows.length) return null;
  let out = `**Work location of ${gPrefix}graduates${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  return out;
}

async function queryByProgram(filters) {
  const stableMatch = {};
  if (filters.yearGraduated) stableMatch.yearGraduated = filters.yearGraduated;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${filters.gender}$`, $options: 'i' };

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
  const gPrefix = genderPrefix(filters);
  let out = `**${gPrefix ? `${gPrefix.charAt(0).toUpperCase() + gPrefix.slice(1)}respondents` : 'Respondents'} by program${lbl}:**\n\n`;
  rows.forEach(r => {
    const emp = r.employed + r.selfEmp;
    out += `- **${r._id}**: ${r.total} respondents, ${emp} employed (${pct(emp, r.total)})\n`;
  });
  return out;
}

// Answers "which course/program has the highest employment rate?" — same
// underlying data as queryByProgram(), computed directly from MongoDB, but
// sorted by rate and calling out the top program instead of just listing all.
// Programs with fewer than 3 respondents are excluded so a single
// lucky/unlucky record can't swing the "highest" result.
async function queryEmploymentRateByProgram(filters) {
  const stableMatch = {};
  if (filters.yearGraduated) stableMatch.yearGraduated = filters.yearGraduated;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${filters.gender}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
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
    { $match: { total: { $gte: 3 } } },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => { const emp = r.employed + r.selfEmp; return { ...r, emp, rate: r.total > 0 ? emp / r.total : 0 }; })
    .sort((a, b) => b.rate - a.rate);
  const top = ranked[0];

  let out = `**Employment rate by program:**\n\n`;
  ranked.forEach(r => { out += `- **${r._id}**: ${r.emp}/${r.total} employed (${pct(r.emp, r.total)})\n`; });
  out += `\n**${top._id}** has the highest employment rate at **${pct(top.emp, top.total)}** (${top.emp} out of ${top.total}, including self-employed).`;
  return out;
}

// Answers "which course produces the most unemployed graduates?" / "which
// program has the lowest unemployment rate?" — queryEmploymentRateByProgram()
// only ever ranks by highest EMPLOYMENT rate with no way to ask about
// unemployment or "lowest" instead, so a question like this used to route
// there anyway and silently answer with the wrong metric (which program is
// most employed, not which one produces the most unemployed graduates).
// Program-grouped twin of queryYearRateExtreme() — same rate-based ranking,
// just by program instead of batch year, for the same reason: a raw
// headcount of unemployed people is misleading without normalizing by each
// program's total respondents, so "most unemployed" is answered as "highest
// unemployment rate," consistent with how the equivalent by-year question
// is handled.
async function queryProgramRateExtreme(filters, direction, metric) {
  const stableMatch = {};
  if (filters.yearGraduated) stableMatch.yearGraduated = filters.yearGraduated;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${filters.gender}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
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
    { $match: { total: { $gte: 3 } } },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const withRate = rows.map(r => {
    const emp    = r.employed + r.selfEmp;
    const notEmp = r.total - emp;
    const rate   = metric === 'unemployment' ? notEmp / r.total : emp / r.total;
    return { ...r, emp, notEmp, rate };
  });
  const ranked = [...withRate].sort((a, b) => direction === 'highest' ? b.rate - a.rate : a.rate - b.rate);
  const top = ranked[0];
  const label = metric === 'unemployment' ? 'Unemployment' : 'Employment';
  const lbl = filterLabel(filters);

  let out = `**${label} rate by program${lbl}:**\n\n`;
  withRate.forEach(r => {
    const shown = metric === 'unemployment' ? r.notEmp : r.emp;
    out += `- **${r._id}**: ${pct(shown, r.total)} (${shown}/${r.total})\n`;
  });
  const topShown = metric === 'unemployment' ? top.notEmp : top.emp;
  out += `\n**${top._id}** had the ${direction} ${metric} rate, at **${pct(topShown, top.total)}** (${topShown} out of ${top.total}).`;
  return out;
}

// Answers "which program has the most alumni working abroad/locally?" — a
// per-program HEADCOUNT for one specific work location, not the generic
// employment rate. Without this, "which program" superlative questions
// always routed to queryEmploymentRateByProgram() regardless of what was
// actually asked, silently discarding an already-extracted workLocation
// filter and answering a completely different question. Programs with fewer
// than 3 respondents are excluded so a single record can't swing "the most."
async function queryWorkLocationByProgram(filters, location) {
  const stableMatch = {};
  if (filters.yearGraduated) stableMatch.yearGraduated = filters.yearGraduated;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${filters.gender}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, workLocation: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    {
      $group: {
        _id:     '$_prog',
        total:   { $sum: 1 },
        matched: { $sum: { $cond: [{ $regexMatch: { input: '$workLocation', regex: new RegExp(location, 'i') } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { matched: -1 } },
  ]);
  if (!rows.length) return null;

  const label = location === 'abroad' ? 'working abroad' : 'working locally';
  const top = rows[0];

  let out = `**Alumni ${label}, by program:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.matched}/${r.total} ${label} (${pct(r.matched, r.total)})\n`; });
  out += `\n**${top._id}** has the most alumni ${label}, with **${top.matched}**.`;
  return out;
}

async function queryByYear(filters) {
  // Group BY year — only pre-filter by program/gender/yearFrom (stable), not
  // a single exact year (that would collapse the grouping to one row).
  const stableMatch = {};
  if (filters.program)  stableMatch.program       = { $regex: filters.program, $options: 'i' };
  if (filters.gender)   stableMatch.gender         = { $regex: `^${filters.gender}$`, $options: 'i' };
  if (filters.yearFrom) stableMatch.yearGraduated  = { $gte: filters.yearFrom };

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
  const gPrefix = genderPrefix(filters);
  let out = `**${gPrefix ? `${gPrefix.charAt(0).toUpperCase() + gPrefix.slice(1)}employment` : 'Employment'} by graduation year${lbl}:**\n\n`;
  rows.forEach(r => {
    const emp = r.employed + r.selfEmp;
    out += `- **Batch ${r._id}**: ${emp}/${r.total} employed (${pct(emp, r.total)})\n`;
  });
  return out;
}

// Answers "which batch/year had the most/fewest graduates?" — raw headcount
// per year, computed directly from MongoDB. Unlike the rate-ranking function
// below, no minimum-sample threshold applies here: a year with few graduates
// is itself a real, meaningful answer to a headcount question, not noise.
async function queryYearWithMostGraduates(filters, direction) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${filters.gender}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null } } },
    { $group: { _id: '$yearGraduated', total: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = [...rows].sort((a, b) => direction === 'highest' ? b.total - a.total : a.total - b.total);
  const top = ranked[0];
  const lbl = filterLabel(filters);

  let out = `**Graduates by batch year${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **Batch ${r._id}**: ${r.total} graduate${r.total !== 1 ? 's' : ''}\n`; });
  out += `\n**Batch ${top._id}** had the ${direction === 'highest' ? 'most' : 'fewest'} graduates, with **${top.total}**.`;
  return out;
}

// Answers "which year had the highest/lowest employment/unemployment rate?"
// — same per-year grouping shape as queryByYear(), computed directly from
// MongoDB, but ranked by rate and calling out the extreme year instead of
// just listing all of them. Years with fewer than 3 respondents are excluded
// so a single lucky/unlucky record can't swing the "highest/lowest" result —
// same threshold used by queryEmploymentRateByProgram() for the same reason.
async function queryYearRateExtreme(filters, direction, metric) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${filters.gender}$`, $options: 'i' };

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
    { $match: { total: { $gte: 3 } } },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const withRate = rows.map(r => {
    const emp    = r.employed + r.selfEmp;
    const notEmp = r.total - emp;
    const rate   = metric === 'unemployment' ? notEmp / r.total : emp / r.total;
    return { ...r, emp, notEmp, rate };
  });
  const ranked = [...withRate].sort((a, b) => direction === 'highest' ? b.rate - a.rate : a.rate - b.rate);
  const top = ranked[0];
  const label = metric === 'unemployment' ? 'Unemployment' : 'Employment';
  const lbl = filterLabel(filters);

  let out = `**${label} rate by batch year${lbl}:**\n\n`;
  withRate.forEach(r => {
    const shown = metric === 'unemployment' ? r.notEmp : r.emp;
    out += `- **Batch ${r._id}**: ${pct(shown, r.total)} (${shown}/${r.total})\n`;
  });
  const topShown = metric === 'unemployment' ? top.notEmp : top.emp;
  out += `\n**Batch ${top._id}** had the ${direction} ${metric} rate, at **${pct(topShown, top.total)}** (${topShown} out of ${top.total}).`;
  return out;
}

// Answers "which batch has the highest/lowest job-course relevance rate?" —
// same shape as queryJobAlignmentByProgram() but grouped by yearGraduated
// instead of program, and parameterized by direction so it can also answer
// "lowest" (queryJobAlignmentByProgram() only ever surfaces the highest).
// Years with fewer than 3 respondents are excluded for the same small-sample
// reason used everywhere else in this file.
async function queryYearJobAlignment(filters, direction) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${filters.gender}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null }, jobRelated: { $nin: [null, ''] } } },
    {
      $group: {
        _id:     '$yearGraduated',
        total:   { $sum: 1 },
        related: { $sum: { $cond: [{ $regexMatch: { input: '$jobRelated', regex: /^yes/i } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => ({ ...r, rate: r.total > 0 ? r.related / r.total : 0 }))
    .sort((a, b) => direction === 'highest' ? b.rate - a.rate : a.rate - b.rate);
  const top = ranked[0];
  const lbl = filterLabel(filters);

  let out = `**Job-course relevance rate by batch year${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **Batch ${r._id}**: ${r.related}/${r.total} job-related (${pct(r.related, r.total)})\n`; });
  out += `\n**Batch ${top._id}** had the ${direction} job-course relevance rate, at **${pct(top.related, top.total)}** (${top.related} out of ${top.total}).`;
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

// Recognizes a question asking about ONE specific named individual ("Where
// is Bryan Canlapan currently working?") rather than a statistic — a proper
// noun doesn't match any TOPIC_PATTERNS keyword, so without this these
// questions silently fell through to the generic 'employment' default and
// answered with the OVERALL 254-respondent breakdown, completely unrelated
// to the person actually asked about.
const PERSON_LOOKUP_PATTERNS = [
  /\bwhere\s+is\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+(?:currently\s+)?working\b/i,
  /\bwhat\s+(?:is|does)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})(?:'s)?\s+(?:job|occupation|position|current\s+job|current\s+role|working\s+as|company|employer)\b/i,
  /\bis\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+(?:currently\s+)?employed\b/i,
  /\bwhat\s+company\s+does\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+work\s+(?:for|at)\b/i,
  /\bwho\s+is\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+working\s+(?:for|with|at)\b/i,
];

// "Is there an alumni/alumnus named vincent?" / "Do you have a graduate
// called Vincent?" — a completely different question shape from the
// patterns above (existence-check, not a job-detail request), and one where
// real users commonly type the name in lowercase. The patterns above rely
// on capitalization to tell a name apart from an ordinary word elsewhere in
// the sentence, then re-extract case-sensitively for that exact reason —
// but the trigger word "named"/"called" here is unambiguous on its own, so
// this intentionally skips that capitalization requirement. Without this,
// "is there alumni named vincent" matched the 'names' TOPIC_PATTERNS
// ("alumni" ... "name" — "named" contains "name" as a prefix) with no name
// filter ever extracted, silently dumping the entire unfiltered 50-alumni
// roster as if it had answered the question.
const NAMED_LOOKUP_PATTERN = /\b(?:alumni|alumnus|alumna|graduates?)\s+(?:named|called)\s+([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4})(?=[?,!.]|$)/i;

// "what dani manlapig status" (casual, ungrammatical, lowercase — no "is",
// no possessive) / "what is Dani Manlapig's status" — none of the
// PERSON_LOOKUP_PATTERNS below list "status" as a trigger keyword, and all
// of them require capitalization to identify a name. Real users routinely
// type a name in lowercase and skip "is"/apostrophe-s entirely, so this
// deliberately skips the capitalization requirement, the same tradeoff
// NAMED_LOOKUP_PATTERN above already makes — "status" preceded by a genuine
// 2-4 word span is a strong enough signal on its own. Without this, a
// question about one specific (possibly nonexistent) person fell through to
// the generic 'status' keyword match and silently answered with the
// unrelated, unfiltered 254-respondent employment breakdown instead of
// attempting a person lookup (or admitting no record was found). A leading
// pronoun/determiner is excluded so ordinary aggregate questions ("what is
// the employment status") aren't misread as a person lookup.
//
// The exclusion has to apply to EVERY word position, not just the first —
// "what is Bryan Canlapan employment status" has a descriptor word
// ("employment") sitting directly between the name and "status" with no
// delimiter, so a plain greedy word-repetition swallowed it straight into
// the captured name ("Bryan Canlapan Employment"), which then broke the
// Graduate token-match AND fed a still-partly-correct-looking name into the
// RAG hallucination guard downstream (ragService.js), letting a bogus
// "employment"-only token match slip through. Known descriptor words
// between the name and "status" are matched separately (and can repeat —
// "current employment status") instead of being eligible for capture.
const STATUS_EXCLUDE_WORDS = 'the|a|an|this|that|each|every|overall|current|general|my|our|your|his|her|its|their|employment|job|marital|civil|account|graduates?|alumni|alumnus|alumna|is|does|do|are|was|were|status';
const STATUS_NAME_WORD = String.raw`(?!(?:${STATUS_EXCLUDE_WORDS})\b)[a-zA-Z][a-zA-Z.'-]*`;
const STATUS_LOOKUP_PATTERN = new RegExp(
  String.raw`\bwhat\s+(?:is\s+|does\s+)?(${STATUS_NAME_WORD}(?:\s+${STATUS_NAME_WORD}){1,3})(?:'s)?\s+(?:(?:employment|job|marital|civil|account|current)\s+)*status\b`,
  'i'
);

function extractPersonName(question) {
  const namedMatch = question.match(NAMED_LOOKUP_PATTERN);
  if (namedMatch) return namedMatch[1].trim();

  const statusMatch = question.match(STATUS_LOOKUP_PATTERN);
  if (statusMatch) return statusMatch[1].replace(/'s$/i, '').trim();

  for (const pat of PERSON_LOOKUP_PATTERNS) {
    const m = question.match(pat);
    if (m) {
      // The outer match is case-INsensitive (/i, needed for trigger words
      // like "where is"/"currently"), which also makes [A-Z] match lowercase
      // letters — so a trailing filler word ("currently", "still") leaks
      // into the captured group too. Re-extract just the capitalized-word
      // span, this time WITHOUT /i, so the name correctly stops at the
      // first lowercase-starting word.
      const nameMatch = m[1].match(/[A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*)*/);
      // Apostrophe is a valid mid-name character (O'Brien), but a trailing
      // possessive "'s" ("Canlapan's job") is grammar, not part of the name
      // — the name-token character class can't tell the difference, so it
      // must be stripped after the fact or "Canlapan's" never matches the
      // stored "Canlapan" at all.
      if (nameMatch) return nameMatch[0].replace(/'s$/i, '').trim();
    }
  }
  return null;
}

// Names in this dataset appear in inconsistent formats ("Bryan Canlapan" vs
// "Canlapan, Bryan T.") — matching requires every name TOKEN to appear
// somewhere in the stored name, regardless of order, rather than an exact
// substring match that would miss reordered/comma-separated variants.
async function queryPersonLookup(name) {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const tokenPatterns = tokens.map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  const rows = await Graduate.aggregate([
    { $match: { name: { $nin: [null, ''] } } },
    ...DEDUP,
  ]);
  const match = rows.find(r => tokenPatterns.every(re => re.test(r.name)));
  if (!match) return null;

  const displayName = toTitleCase(cleanText(match.name));
  const parts = [];
  // Some ingested rows have corrupted jobTitle values (stray braces/symbols
  // from a bad Excel import) — a real-looking title needs to be mostly
  // letters/spaces/punctuation, not just any non-empty string.
  const isPlausibleTitle = match.jobTitle && /^[A-Za-z][A-Za-z\s.,'/&()-]{2,80}$/.test(match.jobTitle.trim());
  if (isPlausibleTitle) parts.push(`works as **${toTitleCase(cleanText(match.jobTitle))}**`);
  if (match.industry) parts.push(`in the **${match.industry}** industry`);
  if (match.workLocation) {
    const loc = /local/i.test(match.workLocation) ? 'locally (within the Philippines)'
              : /abroad/i.test(match.workLocation) ? 'abroad / overseas'
              : match.workLocation;
    parts.push(`working **${loc}**`);
  }
  if (parts.length) {
    // If the title was filtered out (or never recorded), the sentence needs
    // its own verb up front — otherwise it reads as a dangling fragment
    // ("Name in the X industry...") with no "works"/"is employed" at all.
    const verb = isPlausibleTitle ? '' : 'is employed ';
    return `**${displayName}** ${verb}${parts.join(', ')}.`;
  }

  const status = match.employmentStatus ? match.employmentStatus.toLowerCase() : null;
  if (status) return `**${displayName}**'s recorded employment status is **${status}**, but no specific job title or industry is on file.`;
  return `**${displayName}** is on record, but no employment details (job title, industry, location) are available.`;
}

async function queryNames(filters) {
  const pipeline = [
    ...stablePipeline(filters),
    { $match: { name: { $nin: [null, ''] } } },
  ];

  // Apply variable filters after dedup
  if (filters.jobTitleRegex)    pipeline.push({ $match: { jobTitle: { $regex: filters.jobTitleRegex, $options: 'i' } } });
  if (filters.industry)         pipeline.push({ $match: { industry:         { $regex: filters.industry, $options: 'i' } } });
  if (filters.excludeIndustry) {
    pipeline.push({ $match: { industry: { $nin: [null, ''], $not: { $regex: filters.excludeIndustry, $options: 'i' } } } });
  }
  if (filters.employmentStatus) pipeline.push({ $match: { employmentStatus: { $regex: `^${filters.employmentStatus}`, $options: 'i' } } });
  if (filters.excludeEmploymentStatus) {
    pipeline.push({ $match: { employmentStatus: { $nin: [null, ''], $not: { $regex: `^${filters.excludeEmploymentStatus}`, $options: 'i' } } } });
  }
  if (filters.workLocation) {
    pipeline.push({ $match: { workLocation: filters.negateWorkLocation
      ? { $nin: [null, ''], $not: { $regex: filters.workLocation, $options: 'i' } }
      : { $regex: filters.workLocation, $options: 'i' } } });
  }
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
    if (filters.program) return `No alumni records found for **${filters.programLabel || filters.program}** in the tracer study database. Please check the program name or abbreviation.`;
    return null;
  }

  const label = [
    filters.jobTitle          && `working as ${filters.jobTitle}`,
    filters.industry          && `in ${filters.industry}`,
    filters.excludeIndustry   && `NOT in ${filters.excludeIndustry}`,
    filters.program           && `from ${filters.programLabel || filters.program}`,
    filters.yearGraduated     && `Batch ${filters.yearGraduated}`,
    filters.gender            && filters.gender.toLowerCase(),
    filters.employmentStatus  && (filters.employmentStatus === 'Yes' ? 'employed' : filters.employmentStatus === 'No' ? 'unemployed' : filters.employmentStatus.toLowerCase()),
    filters.excludeEmploymentStatus && `who are NOT ${filters.excludeEmploymentStatus === 'Yes' ? 'employed' : filters.excludeEmploymentStatus === 'No' ? 'unemployed' : filters.excludeEmploymentStatus.toLowerCase()}`,
    filters.workLocation      && (filters.negateWorkLocation ? `NOT working ${filters.workLocation}` : `working ${filters.workLocation}`),
    filters.furtherEducation  && (filters.furtherEducation === 'Yes' ? 'who pursued further education' : 'who did not pursue further education'),
    filters.tookExam          && (filters.tookExam === 'passed' ? 'who passed a board/licensure exam'
                                : filters.tookExam === 'failed' ? 'who failed a board/licensure exam'
                                : filters.tookExam === 'yes'    ? 'who took a board/licensure exam'
                                :                                 'who did not take a board/licensure exam'),
  ].filter(Boolean).join(', ');

  const showJob = !!(filters.jobTitle || filters.industry || filters.excludeIndustry || filters.employmentStatus || filters.excludeEmploymentStatus);

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
  const gPrefix = genderPrefix(filters);
  return `**${pct(matched, total)}** of ${gPrefix}graduates ${label}${lbl} (${matched} out of ${total}).`;
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
  const gPrefix = genderPrefix(filters);
  const verb   = resultType === 'passed' ? 'passed' : 'failed';
  return `**${pct(result, took)}** of ${gPrefix}exam takers ${verb} the board/licensure exam${lbl} (${result} out of ${took} who took the exam).`;
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
  const gPrefix = genderPrefix(filters);
  const breakdown = filters.excludeSelfEmployed
    ? `${formal} formally employed, self-employed not counted`
    : `${employed} — ${formal} formally employed + ${selfEmp} self-employed`;
  return `The employment rate of ${gPrefix}graduates${lbl} is **${pct(employed, total)}** (${breakdown} out of ${total} respondents).`;
}

async function queryCount(filters) {
  const stable = stablePipeline(filters);

  // Variable filters applied after dedup
  const postDedup = {};
  if (filters.employmentStatus) postDedup.employmentStatus = { $regex: `^${filters.employmentStatus}`, $options: 'i' };
  // $not/$regex never matches a null/missing field, which would otherwise
  // make "not self-employed" silently include people with no status
  // recorded at all — $nin excludes those explicitly so the count only
  // reflects people who reported a status other than the excluded one.
  if (filters.excludeEmploymentStatus) {
    postDedup.employmentStatus = {
      $nin: [null, ''],
      $not: { $regex: `^${filters.excludeEmploymentStatus}`, $options: 'i' },
    };
  }
  if (filters.jobTitleRegex)    postDedup.jobTitle         = { $regex: filters.jobTitleRegex, $options: 'i' };
  if (filters.industry)         postDedup.industry         = { $regex: filters.industry, $options: 'i' };
  if (filters.excludeIndustry) {
    postDedup.industry = {
      $nin: [null, ''],
      $not: { $regex: filters.excludeIndustry, $options: 'i' },
    };
  }
  if (filters.furtherEducation === 'No') {
    postDedup.$or = [
      { furtherEducation: { $in: [null, ''] } },
      { furtherEducation: { $regex: '^No', $options: 'i' } },
    ];
  } else if (filters.furtherEducation) {
    postDedup.furtherEducation = { $regex: `^${filters.furtherEducation}`, $options: 'i' };
  }
  if (filters.workLocation) {
    postDedup.workLocation = filters.negateWorkLocation
      ? { $nin: [null, ''], $not: { $regex: filters.workLocation, $options: 'i' } }
      : { $regex: filters.workLocation, $options: 'i' };
  }
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

  const pipeline = [...stable];
  if (Object.keys(postDedup).length) pipeline.push({ $match: postDedup });
  pipeline.push({ $count: 'total' });

  // Also count the STABLE cohort alone (program/year/gender, no
  // employmentStatus/industry/etc.) so a zero result can be told apart from
  // two very different situations: "this batch/program has data but none of
  // it matches the extra filter" (a real, confident answer worth stating) vs
  // "this batch/program has no data in the system at all" (e.g. batch 2026,
  // which hasn't graduated yet) — the latter should defer to RAG so the LLM
  // can explain the absence in its own words instead of the aggregation
  // layer asserting a specific "0 employed" breakdown for a cohort it has
  // zero information about.
  const [rows, stableRows] = await Promise.all([
    Graduate.aggregate(pipeline),
    Graduate.aggregate([...stable, { $count: 'total' }]),
  ]);
  const total       = rows[0]?.total ?? 0;
  const stableTotal = stableRows[0]?.total ?? 0;

  const lbl = filterLabel(filters);

  if (stableTotal === 0) return null;

  const significantKeys = Object.keys(filters).filter(k => k !== 'programLabel');
  if (total === 0) {
    if (significantKeys.length === 0) return null;
    if (significantKeys.length === 1 && filters.program) {
      return `No records found for **${filters.programLabel || filters.program}** in the tracer study database. Please check the program name or abbreviation.`;
    }
  }
  const statusLabel = filters.employmentStatus === 'Yes'            ? 'employed'
                    : filters.employmentStatus === 'No'             ? 'unemployed'
                    : filters.employmentStatus === 'Self-Employed'  ? 'self-employed'
                    : filters.employmentStatus === 'Never Employed' ? 'never employed'
                    : filters.excludeEmploymentStatus === 'Yes'            ? 'not employed'
                    : filters.excludeEmploymentStatus === 'No'             ? 'not unemployed'
                    : filters.excludeEmploymentStatus === 'Self-Employed'  ? 'not self-employed'
                    : filters.excludeEmploymentStatus === 'Never Employed' ? 'not "never employed"'
                    : null;
  const industryLabel  = filters.industry       ? ` in ${filters.industry}`
                       : filters.excludeIndustry ? ` NOT in ${filters.excludeIndustry}`
                       : '';
  const jobTitleLabel  = filters.jobTitle ? ` working as ${filters.jobTitle}` : '';
  const locationLabel  = filters.workLocation
    ? (filters.negateWorkLocation ? ` NOT working ${filters.workLocation}` : ` working ${filters.workLocation}`)
    : '';
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
  // Was missing before: the query already filters by furtherEducation (see
  // postDedup above), but the label never said so — the count was correct,
  // but the sentence made it look like an unfiltered total.
  const eduLabel        = filters.furtherEducation === 'Yes' ? ' who pursued further education'
                       : filters.furtherEducation === 'No'  ? ' who did not pursue further education'
                       : '';
  // Was missing before: filters.gender is applied to the query (via
  // stablePipeline) but never shown in the sentence, so a gender-filtered
  // count read identically to an unfiltered one — making the two answers
  // look inconsistent even when both were correct.
  const genderLabel = filters.gender ? `${filters.gender.toLowerCase()} ` : '';
  const desc = statusLabel
    ? `${genderLabel}**${statusLabel}** alumni${jobTitleLabel}${industryLabel}${locationLabel}${examLabel}${jobRelLabel}${eduLabel}`
    : `${genderLabel}graduate${total !== 1 ? 's' : ''}${jobTitleLabel}${industryLabel}${locationLabel}${examLabel}${jobRelLabel}${eduLabel}`;
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
  // Denominator matches queryEmployment()/queryRate()'s own denominator (only
  // respondents with a non-null employmentStatus) — using the all-respondents
  // `total` here instead would silently disagree with those functions whenever
  // some records have no employmentStatus recorded.
  const empTotal = empRows.reduce((s, r) => s + r.count, 0);
  const formal   = empRows.filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
  const selfEmp  = empRows.filter(r => /^self.?employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
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
  // Denominator matches queryWorkLocation()'s own denominator (only
  // respondents with a non-null workLocation).
  const locTotal = locRows.reduce((s, r) => s + r.count, 0);

  const eduRows = await Graduate.aggregate([
    ...base,
    { $match: { furtherEducation: { $nin: [null, ''] } } },
    { $group: { _id: '$furtherEducation', count: { $sum: 1 } } },
  ]);
  const pursuedEdu = eduRows.filter(r => YES_RE.test(r._id)).reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Tracer Study Overview${lbl} — ${total} ${gPrefix}respondents**\n\n`;

  out += `**Employment Status:**\n`;
  empRows.forEach(r => { out += `- ${r._id}: **${r.count}** (${pct(r.count, empTotal)})\n`; });
  out += `→ Overall employment rate: **${pct(employed, empTotal)}** (including self-employed)\n\n`;

  if (indRows.length) {
    out += `**Top Industries:**\n`;
    indRows.forEach((r, i) => { out += `${i + 1}. ${r._id} — ${r.count}\n`; });
    out += '\n';
  }

  if (locRows.length) {
    out += `**Work Location:**\n`;
    locRows.forEach(r => { out += `- ${r._id}: ${r.count} (${pct(r.count, locTotal)})\n`; });
    out += '\n';
  }

  // Denominator matches queryFurtherStudies()'s own denominator (ALL
  // respondents in this cohort — a missing answer is treated as "did not
  // pursue," not excluded from the count). Using `eduTotal` (only-answered)
  // here instead used to make this line disagree with a direct "how many
  // pursued further studies?" question asked about the exact same cohort.
  out += `**Further Education:** ${pursuedEdu} pursued further studies (${pct(pursuedEdu, total)})`;
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function hasData() {
  const count = await Graduate.countDocuments();
  return count > 0;
}

async function queryInner(question) {
  if (!(await hasData())) return null;

  // "Who are the PROMINENT/notable/outstanding graduates?" matches the 'names'
  // topic pattern ("who are") and would otherwise return a plain alphabetical
  // roster of every graduate in the program, silently discarding the actual
  // qualifier — the Graduate schema has no "prominent" flag to filter on, so
  // this is a RAG question (achievement profiles), not an aggregation one.
  // Bail out here so the caller (ragService) falls through to vector search.
  if (/\b(prominent|notable|outstanding|distinguished|renowned|top[- ]?performing|most successful)\b/i.test(question)) {
    return null;
  }

  // Non-tracer PORTAL features — job postings, announcements, events, staff
  // directory, appointments, partnerships, office hours, profile/account
  // activity. Each of these used to have its own live-collection query
  // handler (removed — the AC assistant is scoped to tracer study data
  // only, not portal-wide). Several of these keywords ("how many job
  // openings", "how many appointments") still satisfy the generic
  // "how many X" STATISTICAL_PATTERNS trigger with no other filter set,
  // which — without an explicit bail-out — fell through to the unrelated
  // employment-rate/count default and confidently narrated the wrong metric
  // (e.g. "174 job openings, representing an employment rate of 68.5%",
  // where 174 is actually the EMPLOYED-alumni count). Answered directly and
  // explicitly here instead, each with a pointer to the right admin page.
  const OUT_OF_SCOPE_TOPICS = [
    { test: /\bjob\s+(openings?|listings?|vacancies|opportunities|postings?)\b|\bavailable\s+(jobs?|positions?|roles?)\b/i,
      hint: 'Check the Employment Details or Job Board pages for open job postings.' },
    { test: /\bannouncements?\b/i, exclude: /\bemployment\b/i,
      hint: 'Check the Post Announcements page.' },
    { test: /\b(updat|edit|chang|modif)\w*\s+(their|his|her|its|my|your)?\s*(profile|account|info|information|details|record)\b|\b(profile|account)\s+(updat|edit|chang)\w*\b/i,
      hint: 'Check the Manage Accounts page for account activity.' },
    { test: /\bstaff\b/i,
      hint: 'Check the Appointments page\'s Staff Management section.' },
    { test: /\bappointments?\b/i, exclude: /\bstaff\b/i,
      hint: 'Check the Appointments page.' },
    { test: /\bevents?\b|\battend(ed|ance)?\b.{0,20}\bevent/i,
      hint: 'Check the Events page.' },
    { test: /\bpartnerships?\b|\bpartner\s+compan(y|ies)\b/i,
      hint: 'Check the Partnerships page.' },
    { test: /\boffice\s+(status|hours|open|closed|schedule)\b|\bis\s+the\s+office\s+(open|closed)\b/i,
      hint: 'Check the Appointments page\'s office settings.' },
  ];
  for (const t of OUT_OF_SCOPE_TOPICS) {
    if (t.test.test(question) && !(t.exclude && t.exclude.test(question))) {
      return {
        text: `That's not part of the Graduate Tracer Study data — I can only answer questions about tracer study records (employment status, industries, board exam results, competencies, program breakdowns, etc.). ${t.hint}`,
        direct: true, topic: 'out_of_scope', filters: {},
      };
    }
  }

  // "Where is Bryan Canlapan currently working?" — a lookup for ONE named
  // person, structurally different from every other question this file
  // answers (all of which aggregate across many respondents). Checked before
  // topic detection since a proper name doesn't match any TOPIC_PATTERNS
  // keyword and would otherwise fall through to a generic aggregate that has
  // nothing to do with the person asked about. If no matching person is
  // found, fall through to null (RAG) rather than assert person not found —
  // vector search may still have relevant unstructured mentions.
  const personName = extractPersonName(question);
  if (personName) {
    const text = await queryPersonLookup(personName);
    if (text) return { text, direct: true, topic: 'person_lookup', filters: {} };
    return null;
  }

  let topic     = detectTopic(question);
  const filters = extractFilters(question);

  // Detect government/private SECTOR questions (no dedicated field in data)
  const isSectorQuestion = /\b(government|private)\s*sector\b|\bsector\b.{0,20}\b(government|private)\b/i.test(question);

  // "Which program has the highest job alignment?" — bare "job alignment"
  // doesn't satisfy TOPIC_PATTERNS.job_relevance (which requires
  // "align...with/to...course/study/etc" specifically), so this question's
  // topic falls through to the generic 'employment'/'rate' default — where
  // the "which program" branches used to route unconditionally to
  // queryEmploymentRateByProgram(), silently answering with the WRONG
  // metric (employment rate instead of job-course alignment rate).
  const isJobAlignmentQuestion = /\b(job.?course|job.?related|job.?relevance|job.?align\w*|related\s+to\s+(?:their|his|her|its)?\s*(course|degree|program|study))\b/i.test(question);

  // "Which course produces the most unemployed graduates?" — filters.employmentStatus
  // is already correctly extracted as 'No' by this point, but the "which
  // program/course" dispatch branches used to route unconditionally to
  // queryEmploymentRateByProgram() (always highest EMPLOYMENT rate, no
  // "unemployed"/"lowest" option at all), silently answering the opposite
  // metric from what was asked.
  // filters.employmentStatus alone misses "unemployment rate" (a noun
  // phrase) — only the adjective "unemployed" sets that filter, so a direct
  // substring check is needed too (matches "unemployed" AND "unemployment"
  // alike), same approach already used by the equivalent by-year bypass.
  const wantsUnemploymentByProgram = filters.employmentStatus === 'No' || /\bunemploy/i.test(question);
  const programSuperlativeDirection = /\b(most|highest)\b/i.test(question) ? 'highest' : 'lowest';

  // "How many alumni work locally vs. abroad?" — a COMPOUND location
  // comparison deliberately leaves filters.workLocation unset (see
  // extractFilters()) so queryWorkLocation() returns the full local+abroad
  // breakdown instead of just one side. But "how many alumni" also matches
  // the 'count' TOPIC_PATTERN, which is checked before 'work_location' and
  // wins topic detection outright — so the 'count'/'rate' dispatch branches
  // below need their own explicit check for this case, or they silently
  // fall through to a generic, location-blind answer (this exact phrase is
  // also one of the system's own suggested follow-up questions for the
  // work_location topic, so the bug was one click away from every user).
  const isCompoundLocationQuestion = !filters.workLocation && TOPIC_PATTERNS.work_location.test(question);

  // "What is the employment trend for BSIT graduates over the past three
  // years?" / "Is employment improving or declining for BSCS graduates?" —
  // both imply a BY-YEAR breakdown showing DIRECTION OF CHANGE, not one
  // aggregate snapshot. "improving/declining" is just as much a trend
  // question as literal "trend" wording, but a single aggregate overview
  // (queryOverview()) can't answer either — it has no year-over-year shape
  // at all, so it silently presented one static snapshot as if it answered
  // whether things are getting better or worse, which it structurally
  // cannot do.
  if (/\btrend\b|\byear[\s-]over[\s-]year\b|\bover\s+time\b|\b(improv|declin|increas|decreas|grow(?:ing|th)?|worsen|drop(?:ping|ped)?)\w*\b/i.test(question) || filters.yearFrom) {
    const text = await queryByYear(filters);
    if (text) return { text, direct: true, topic: 'by_year', filters };
  }

  // "Which batch year had the most graduates?" / "Which year had the
  // highest unemployment rate?" / "Which batch has the highest unemployment
  // rate?" — superlative ranking BY YEAR. "batch" and "year" are used
  // interchangeably in this domain (both tie to yearGraduated) — the pattern
  // must match EITHER word alone, not just "year" with "batch" as an
  // optional prefix, or "which batch has..." (no "year" at all) falls
  // through this bypass entirely. None of the TOPIC_PATTERNS entries capture
  // this shape (by_year only matches literal "by year"/"per year" phrasing),
  // so without this bypass these questions either fell through to RAG
  // entirely (no "employ" keyword to trigger the default 'employment'
  // fallback) or, worse, silently answered with queryEmployment()'s single
  // overall Yes/No breakdown — a confident answer that completely ignores
  // the "which batch/year" ranking that was actually asked.
  if (/\bwhich\s+(batch|year)\b/i.test(question) && /\b(most|highest|fewest|least|lowest)\b/i.test(question)) {
    const direction = /\b(most|highest)\b/i.test(question) ? 'highest' : 'lowest';
    // "Which batch has the lowest job-course relevance rate?" — mentions
    // neither "employ" nor "unemploy", so without this check it silently
    // fell through to the plain graduate-headcount ranking instead, a
    // totally different metric than the one actually asked about.
    const text = isJobAlignmentQuestion
      ? await queryYearJobAlignment(filters, direction)
      : /\bunemploy/i.test(question)
      ? await queryYearRateExtreme(filters, direction, 'unemployment')
      : /\bemploy/i.test(question)
      ? await queryYearRateExtreme(filters, direction, 'employment')
      : await queryYearWithMostGraduates(filters, direction);
    if (text) return { text, direct: true, topic: 'by_year', filters };
  }

  // A bare program mention — "BSIT", "BSIT graduates", "IT graduates" —
  // already has filters.program correctly set by extractFilters() above, but
  // with no topic-specific keyword anywhere else in the question,
  // detectTopic() found nothing and topic stayed null. Without this check,
  // that fell straight into the bare-industry-noun-phrase heuristic just
  // below, which (having no idea a program was already identified) treated
  // the WHOLE phrase — literally including the word "graduates" — as an
  // INDUSTRY name to search for, always matched zero rows, and silently
  // deferred to a RAG refusal for what is actually the single most natural
  // way to ask "how many graduates does this program have." Checked BEFORE
  // the industry heuristic so a recognized program short-circuits it
  // entirely rather than the two guesses fighting over the same phrase.
  if (topic === null && filters.program &&
      !filters.industry && !filters.excludeIndustry && !filters.employmentStatus && !filters.excludeEmploymentStatus
      && !filters.workLocation && !filters.furtherEducation && !filters.employmentStatuses && !filters.jobTitle) {
    topic = 'count';
  }

  // If the question looks like a bare noun phrase (no WH-words, no verbs — e.g.
  // "Engineering", "IT"), treat it as an industry name to look up. This applies
  // whether detectTopic() found an employment signal or no topic at all, since a
  // bare term is its own distinct signal for "look this up as an industry."
  // Excludes a question that already resolved to a recognized program (see
  // above) — that phrase's "industry" candidate would just be the program
  // name plus filler words like "graduates," which never matches anything.
  if ((topic === 'employment' || topic === null) && !filters.program &&
      !filters.industry && !filters.excludeIndustry && !filters.employmentStatus && !filters.excludeEmploymentStatus
      && !filters.furtherEducation && !filters.employmentStatuses) {
    if (!/\b(how|what|who|which|when|where|why|is|are|do|does|show|list|give|tell|would|could|should|can|have|has|explain|describe|summarize|summarise|discuss|elaborate|outline)\b/i.test(question)) {
      const candidate = question.trim().replace(/[?!.,]+$/, '').trim();
      if (candidate.length > 2 && candidate.length < 60) {
        filters.industry = candidate;
        topic = 'employment';
      }
    }
  }

  // No specific topic matched and this isn't a bare industry lookup — decline
  // rather than silently answering with an unrelated employment breakdown.
  // The caller (ragService) falls through to RAG / vector search from here.
  if (topic === null) return null;

  const fn = {
    names:           () => queryNames(filters),
    count:           () => isSectorQuestion ? querySector(filters) : filters.employmentStatuses ? queryEmployment(filters) : (filters.workLocation || isCompoundLocationQuestion) ? queryWorkLocation(filters) : (filters.industry || filters.excludeIndustry) ? queryIndustry(filters) : queryCount(filters),
    rate:            () => isCompoundLocationQuestion
      ? queryWorkLocation(filters)
      : /\b(which|what)\s+(program|course|degree)\b/i.test(question)
      ? (isJobAlignmentQuestion ? queryJobAlignmentByProgram(filters)
        : wantsUnemploymentByProgram ? queryProgramRateExtreme(filters, programSuperlativeDirection, 'unemployment')
        : filters.workLocation ? queryWorkLocationByProgram(filters, filters.workLocation)
        : queryEmploymentRateByProgram(filters))
      : filters.tookExam === 'passed'
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
      // Was missing entirely: filters.workLocation IS correctly extracted for
      // "what percentage work abroad/locally" questions, but with no branch
      // checking for it here, execution fell all the way through to the
      // generic queryRate() (overall employment rate) — silently dropping
      // the location filter and answering a different question.
      : filters.workLocation
      ? querySimpleRate(filters, { workLocation: { $regex: filters.workLocation, $options: 'i' } }, `work ${filters.workLocation === 'local' ? 'locally' : filters.workLocation}`)
      // Same gap as workLocation above: filters.industry IS correctly
      // extracted for "what percentage work in the IT industry" questions,
      // but with no branch here, execution fell through to the generic
      // queryRate() (overall employment rate) — silently dropping the
      // industry filter and answering a completely different question.
      : filters.industry
      ? querySimpleRate(filters, { industry: { $regex: filters.industry, $options: 'i' } }, `work in ${filters.industry}`)
      : filters.excludeIndustry
      ? querySimpleRate(filters, { industry: { $nin: [null, ''], $not: { $regex: filters.excludeIndustry, $options: 'i' } } }, `do NOT work in ${filters.excludeIndustry}`)
      : queryRate(filters),
    overview:        () => /\bby\s+(program|course)\b/i.test(question) ? queryByProgram(filters)
      : /\bby\s+(batch|year|graduation)\b/i.test(question) ? queryByYear(filters)
      : /\bemployment\s+(breakdown|data|statistic)/i.test(question) ? queryEmployment(filters)
      : queryOverview(filters),
    industry:        async () => {
      const text = await queryIndustry(filters);
      // "Which industry employs the most alumni?" — queryIndustry()'s
      // no-filter branch already sorts industries by count descending, so
      // the top line IS the answer; without this the response was just a
      // ranked list with no sentence directly naming the "most" industry,
      // leaving the actual question technically unanswered in words.
      if (text && !filters.industry && !filters.excludeIndustry && /\b(most|highest)\b/i.test(question)) {
        const firstLine = text.split('\n').find(l => /^\d+\.\s+\*\*/.test(l));
        const m = firstLine && firstLine.match(/\*\*(.+?)\*\*\s+—\s+(\d+)/);
        if (m) return `${text}\n\n**${m[1]}** employs the most alumni, with **${m[2]}** graduates.`;
      }
      return text;
    },
    work_type:       () => isSectorQuestion ? querySector(filters) : queryWorkType(filters),
    job_relevance:   () => /\bwhich\s+(program|course|degree)\b/i.test(question) ? queryJobAlignmentByProgram(filters)
      : filters.jobRelated ? queryCount(filters) : queryJobRelevance(filters),
    further_studies: () => /\bwho\b/i.test(question) ? queryNames(filters) : queryFurtherStudies(filters),
    licensure:       () => /\bwho\b/i.test(question) ? queryNames(filters) : filters.tookExam ? queryCount(filters) : queryLicensure(filters),
    competencies:    () => queryCompetencies(filters),
    work_location:   () => /\b(which|what)\s+(program|course|degree)\b/i.test(question)
      ? queryWorkLocationByProgram(filters, filters.workLocation || 'abroad')
      : /\bwho\b/i.test(question) ? queryNames(filters) : queryWorkLocation(filters),
    by_program:      () => queryByProgram(filters),
    by_year:         () => queryByYear(filters),
    gender:          () => {
      // "how many female are self-employed?" — gender matches the 'gender'
      // topic first and would otherwise win routing outright, silently
      // dropping the employmentStatus/industry/etc. filter that
      // extractFilters() DID correctly extract alongside it. queryCount()
      // already combines gender + every other filter correctly (and labels
      // them together), so defer to it whenever another specific filter is
      // also present; queryGender() stays the default for gender-only asks.
      const hasOtherFilter = filters.employmentStatus || filters.employmentStatuses || filters.excludeEmploymentStatus
        || filters.industry || filters.excludeIndustry || filters.furtherEducation || filters.tookExam
        || filters.jobRelated || filters.workLocation;
      if (filters.employmentStatuses) return queryEmployment(filters);
      return hasOtherFilter ? queryCount(filters) : queryGender(filters);
    },
    employment:      () => {
      // "employed including self-employed" / "employed and self-employed" —
      // this combo already has an established combined meaning everywhere
      // else in the app (getDonutStats, the dashboard tile, queryRate's own
      // "including self-employed" line), so answer with that single combined
      // total instead of the generic two-row breakdown other compound
      // questions get.
      const isCombinedEmployedQuery = filters.employmentStatuses?.length === 2
        && filters.employmentStatuses.includes('Yes')
        && filters.employmentStatuses.includes('Self-Employed');
      if (/\b(which|what)\s+(program|course|degree)\b/i.test(question)) {
        if (isJobAlignmentQuestion) return queryJobAlignmentByProgram(filters);
        if (wantsUnemploymentByProgram) return queryProgramRateExtreme(filters, programSuperlativeDirection, 'unemployment');
        return filters.workLocation
          ? queryWorkLocationByProgram(filters, filters.workLocation)
          : queryEmploymentRateByProgram(filters);
      }
      if (isCombinedEmployedQuery) return queryRate(filters);
      if (filters.industry || filters.excludeIndustry) return queryIndustry(filters);
      if (filters.employmentStatus || filters.excludeEmploymentStatus) return queryCount(filters);
      return queryEmployment(filters);
    },
  }[topic] ?? (() => queryEmployment(filters));

  const text = await fn();
  return text ? { text, direct: true, topic, filters } : null;
}

// A college coordinator must only ever see their own college's tracer study
// data through the AC assistant — but Graduate has no `college` field (only
// free-text `program`), so the restriction is enforced by resolving the
// coordinator's college to the set of alumni emails belonging to it (via
// User.college, the same source of truth EmploymentView already scopes by)
// and running the entire query through that scope — see
// utils/collegeScope.js for why AsyncLocalStorage instead of threading a
// filter through every one of the ~40 functions above individually.
async function query(question, options = {}) {
  const { college } = options;
  if (!college) return queryInner(question);

  const alumni = await User.find({ role: 'alumni', college }).select('email').lean();
  const emails = alumni.map(u => (u.email || '').toLowerCase()).filter(Boolean);
  return runWithCollegeScope(emails, () => queryInner(question));
}

// ─── Follow-up suggestions ──────────────────────────────────────────────────
// Built directly from the same topics query() actually dispatches to above —
// not a separately-maintained list — so a suggestion can never point at a
// topic the aggregation layer doesn't support. Program filter (if any) is
// carried over so suggestions drill into the same cohort just answered.
const RELATED_TOPICS = {
  employment:      ['industry', 'by_program', 'by_year'],
  count:           ['rate', 'industry', 'by_program'],
  rate:            ['industry', 'by_program', 'competencies'],
  overview:        ['industry', 'licensure', 'further_studies'],
  industry:        ['rate', 'work_location', 'by_program'],
  work_type:       ['rate', 'industry', 'work_location'],
  job_relevance:   ['rate', 'industry', 'by_program'],
  further_studies: ['rate', 'licensure', 'industry'],
  licensure:       ['rate', 'further_studies', 'by_program'],
  competencies:    ['rate', 'by_program', 'industry'],
  work_location:   ['industry', 'rate', 'by_program'],
  by_program:      ['rate', 'industry', 'by_year'],
  by_year:         ['rate', 'industry', 'by_program'],
  names:           ['rate', 'industry', 'by_program'],
  gender:          ['rate', 'by_program', 'industry'],
};

const FOLLOWUP_QUESTION = {
  rate:            (pw) => `What is the employment rate of ${pw}alumni?`,
  industry:        (pw) => `What industries do ${pw}alumni work in?`,
  by_program:      ()   => `Show employment breakdown by program`,
  by_year:         (pw) => `Show ${pw}employment by graduation year`,
  work_location:   (pw) => `How many ${pw}alumni work locally vs. abroad?`,
  licensure:       (pw) => `How many ${pw}alumni passed the board exam?`,
  further_studies: (pw) => `How many ${pw}alumni pursued further studies?`,
  competencies:    (pw) => `How do ${pw}alumni rate their technical skills?`,
  count:           (pw) => `How many ${pw}alumni are there?`,
  employment:      (pw) => `What is the employment breakdown of ${pw}alumni?`,
  work_type:       (pw) => `What is the employment type breakdown of ${pw}alumni?`,
  job_relevance:   (pw) => `How many ${pw}alumni have jobs related to their course?`,
  names:           (pw) => `Who are the employed ${pw}alumni?`,
  gender:          (pw) => `What is the gender breakdown of ${pw}alumni?`,
};

function suggestFollowUps(topic, filters = {}) {
  const progWord = filters.program ? `${filters.programLabel || filters.program} ` : '';
  const related   = (RELATED_TOPICS[topic] || ['rate', 'industry', 'by_program'])
    .filter(t => t !== topic && FOLLOWUP_QUESTION[t]);
  return related.slice(0, 3).map(t => FOLLOWUP_QUESTION[t](progWord));
}

module.exports = { query, hasData, suggestFollowUps, extractPersonName };
