# Project Alumni — ATREIA Chatbot: Rules & Lessons Learned

This file documents recurring bug classes found and fixed in the ATREIA AI
chatbot (`backend/services/aggregationService.js` and
`backend/services/ragService.js`). Read this before touching either file —
it exists so the same mistakes aren't repeated. Each rule below was learned
from a real, live-reported bug.

## 1. Regex / pattern matching

- **A separator regex must accept every real-world variant.** `\s+` alone
  misses hyphenated forms ("non-IT-related"); `[-\/]` alone misses spaced
  forms ("BSIT TSM"). Always use `[\s\-\/]+` (or similarly permissive) unless
  you've specifically verified only one separator is ever used.
- **A negation pattern needs the SAME separator tolerance as its positive
  counterpart.** If `"IT jobs"` matches with a space, `"non-IT jobs"` must
  match with a hyphen too — otherwise negated phrasing silently falls
  through to the positive match and answers the opposite of what was asked.
- **A negative-lookahead exclusion list needs every real synonym, not just
  the first one you tested.** `(?!\s+industry\b)` missed `"sector"` and
  `"field"` — both equally common ways to say the same thing in this app's
  own vocabulary elsewhere.
- **Greedy capture groups will swallow adjacent words that "fit" the
  pattern.** `[a-zA-Z'-]*` (allowing an apostrophe) let a name-capture
  greedily eat `"Miranda's job"` as if "job" were part of the name, because
  both interpretations satisfied the rest of the pattern. When two capture
  lengths both lead to a successful match, the regex engine picks the
  GREEDIER one — explicitly exclude words that don't belong (`directly`,
  `somewhat`, the trailing noun itself) from the capture's character class.
- **A heuristic built for one input shape can corrupt a different one.**
  `collapseRepeatedLetters` was designed for casual lowercase elongation
  ("sinooo" → "sino") but also fired on fumbled ALL-CAPS acronyms ("CCCCS" →
  "CS", which happens to be a REAL trigger word) — scope character-class
  heuristics to the specific case they were designed for (lowercase only).
- **Validate the FULL captured value, not just that it loosely resembles the
  expected shape.** `\d{4}` silently failed to match a 5-digit garbled year
  ("20232") and fell through as if no year had been typed at all. Capture
  `\d+` and explicitly validate the whole captured string, so malformed
  input gets an honest "that's not a valid year" instead of silently being
  ignored.
- **A shorthand map hardcoded for ONE program's specializations doesn't
  generalize.** `TRACK_MAP` only ever covered BSIT's three tracks. Build a
  flat, data-driven array (`PROGRAM_SPECIALIZATIONS`) so a new
  program/specialization pair anywhere in the system is a one-line addition,
  not a parallel regex rewrite.

## 2. Topic/intent routing

- **First-match-wins topic detection breaks when two topics share a common
  word.** `TOPIC_PATTERNS.industry` (declared before `.licensure`) hijacked
  "licensure pass rate ... IT **industry**" because it only checked for the
  word "industry" anywhere in the question. When a stronger, more specific
  signal already resolved (e.g. `filters.tookExam`), add an explicit
  override AFTER the initial dispatch that re-routes regardless of which
  topic got guessed first — don't just reorder the whole pattern object and
  hope nothing else collides.
- **A bare continuation (no topic words of its own) inheriting filters from
  conversation context can still get mis-classified by the generic
  fallback.** The null-topic fallback defaults to a NAMES list whenever
  "real" filter content is present — but context-seeded filters (program,
  industry) count as "real" even when the CURRENT turn's own text is just
  "show all the programs" or "make it a graph." Any new "carries no topic
  content of its own" signal (`showAll`, `requestedChartType`, `wantsChart`,
  etc.) must be added to **every** relevant exemption list — and these
  signals must tolerate each other being present together (a single message
  can combine two of them: "show all the programs so I can download the
  graph" is both `showAll` AND `wantsChart` at once).
- **classify() must actually route matching questions to a new deterministic
  capability, or that capability is dead code.** Adding
  `queryUnemploymentReasons()` was useless until `isUnemploymentReasonQuestion()`
  was also added to ragService.js's aggregation-forcing condition —
  `QUALITATIVE_PATTERNS`' bare `\bwhy\b`/`\breason(s)?\b` triggers send an
  unscoped caller straight to RAG, bypassing aggregationService.js entirely.
  Always check whether classify() will actually reach new routing logic,
  especially for admins (no college scope forces anything through).
- **Explicit statistical vocabulary must out-rank a generic "who is/are"
  roster trigger, not lose to it by object declaration order.**
  `TOPIC_PATTERNS.names` (declared before `.rate`) hijacked "Show me the
  **percentage** of Computer Science graduates who **are** currently
  employed full-time and work locally" because its broad `who (is|are) ...
  (working|employed|...)` alternative matched the sentence's own "who are
  ... employed" clause before `.rate`'s unambiguous `percentage of ...
  graduates` alternative ever got a turn — same first-match-wins collision
  as the industry/licensure case above, just with 'names' as the hijacker
  this time. Fixed the same way: an explicit `detectTopic()` override
  (`if (TOPIC_PATTERNS.rate.test(question)) return 'rate';`) checked before
  the main dispatch loop, not a reorder of the whole object. Any topic whose
  own trigger words are unambiguous, explicit terminology (percentage, rate,
  porsyento) is safe to let win outright over a broader structural pattern
  — a genuine names request never uses that vocabulary.
- **An early speculative bypass that fails to resolve must ACTUALLY fall
  through to normal routing, not just claim to in a comment.**
  `extractPersonNames()`'s "who are X and Y" multi-person branch had a
  comment reading "fall through to normal topic detection below" sitting
  directly above `if (!results.some(Boolean)) return null;` — but `return
  null` exits `queryInner()` entirely (the caller treats null as "no
  deterministic answer, try RAG"), it does not continue to "topic detection
  below" within the same function at all. The comment described the
  INTENDED behavior; the code implemented something else. Caught live: "...
  graduates **who are** currently employed full-time **and** work locally"
  matched the "who are" multi-person trigger, split on "and" into two
  phantom name candidates ("currently employed full-time", "work locally"),
  neither resolved to a real person, and the entire answerable question was
  abandoned to a generic RAG refusal. When a guard's comment says "fall
  through," verify the code actually does — wrap the rest of the block in
  `if (<found something real>) { ... }` instead of an early return on the
  inverse condition, so the surrounding function genuinely keeps running
  when the speculative branch turns up nothing.

## 3. Data source consistency

- **Two surfaces reporting on "the same" data will silently diverge if they
  read from different collections.** The Dashboard (TracerStudyResponse)
  and the chatbot (Graduate — a mix of live submissions AND bulk-imported
  historical rows) disagreed by design until `LIVE_SUBMISSION_ONLY` scoped
  the chatbot to the same population. Before trusting a "the numbers don't
  match" complaint is a data problem, check whether both surfaces are even
  querying the same source.
- **A field existing in the source-of-truth collection does not mean every
  consumer can see it.** `TracerStudyResponse.reasonsNotEmployed` was real
  and populated, but never synced to `Graduate` (the chatbot's own data
  source) — the chatbot had no way to answer from it no matter how good the
  routing logic was. When a tracer-form field matters to the chatbot, trace
  it through: schema field → sync function (`syncGraduateAndEmbedding`) →
  RAG embedding text (`tracerRowToText`) → backfill script for existing rows.
- **A cascade-delete added for one lifecycle event (account deletion) can
  miss a sibling event (role change).** `deleteUser` cascaded
  `TracerStudyResponse`/`Graduate` correctly; `updateUser`'s "role changed
  away from alumni" branch cascaded `Graduate` but not
  `TracerStudyResponse` — same data, two different triggers, only one
  covered. When adding a cascade, check every OTHER place the same
  record's lifecycle can end, not just the one you're currently fixing.

## 4. LLM narration reliability

- **Don't rely solely on prompt rules for a small model to reliably preserve
  a specific fact.** Even with an explicit rule forbidding "does not
  specify/mention/provide," the model still produced "does not **ask
  for**" — a variant that technically dodges the rule's exact wording.
  Prompt rules reduce bad output; they don't eliminate it. For any fact that
  MUST survive narration (a specific redirect, a specific number), add a
  deterministic post-narration check and fall back to the raw, verified text
  if the fact didn't survive — this project's own convention is "prefer
  deterministic checks over further prompt-patching."
- **An LLM asked to "rewrite data as prose" may invent a format nobody asked
  for.** Caught live: the model drew its own ASCII-art chart in a markdown
  code block and offered "a more visual representation" — behavior no rule
  previously forbade because it seemed too obviously out of scope to need
  saying. Explicitly forbid specific unwanted behaviors, even ones that seem
  self-evident.
- **Multi-select data narrated by an LLM risks inventing causal
  relationships between co-occurring values.** `reasonsNotEmployed` lets one
  person pick several reasons at once; RAG narration turned "these other
  reasons the SAME people also picked" into "reasons FOR the one reason you
  asked about" — a real but miscategorized relationship. For any
  well-defined, enumerable data shape, build a deterministic query function;
  never let an LLM narrate directly from raw multi-select chunks.
- **A validation guard only checks what you specifically told it to check.**
  `droppedTheAnswer` verified a NUMBER survived narration, but didn't verify
  a specific SENTENCE (the "closest real category" redirect) survived too —
  the number passed, the sentence got reworded anyway, and the check let it
  through. When a fact has sub-parts that each matter independently, check
  each one.

## 5. Suggestion / follow-up chips

- **A new field on a function's return value doesn't automatically survive
  the pipeline.** `queryWorkType()` returning `{text, chart, suggestions}`
  had `suggestions` silently dropped — the central dispatch in
  `queryInner()` only ever destructured `{text, chart, charts, eventTitle}`.
  When adding a new field to any return shape, trace every consumer that
  destructures it, not just the one you're editing.
- **Static clarify text can be matched by exact string equality; dynamically
  generated suggestions need pattern extraction instead.** A fixed clarify
  (`ambiguousKeywords[].clarify`) is matched by `===`; a suggestion built
  per-question ("Would you like to see X instead?") needs a regex that
  extracts the varying part and reconstructs a self-contained question from
  it. Plan for this distinction before building any new "offer a follow-up"
  feature — don't assume every suggestion can be matched the same way.
- **A suggestion only in a UI chip is easy to miss; weave the same offer
  into the answer text itself too**, not just a separate "you might also
  ask" row below it — admins reported not noticing the chip.

## 6. Verification discipline (own this before claiming "fixed")

- **A fresh in-process test proves the CODE works; it does not prove the
  LIVE server is running it.** This session repeatedly found the backend
  serving stale code from an orphaned/duplicate `nodemon` process despite
  looking "recently restarted." Always confirm via a real HTTP call to the
  actual running server — not just a standalone script — before declaring
  something fixed.
- **Check for duplicate dev stacks before trusting any verification.**
  Multiple `nodemon` instances racing for the same port made "it's fixed"
  unreliable — whichever process happened to win the port bind was
  serving requests, and it wasn't always the newest one. Kill down to a
  single clean stack when this is suspected.
- **A test's simulated chat history must match the real client's shape
  exactly**, including quirks like the frontend sending the current user
  message as a duplicate LAST entry in `history`. A test missing that
  duplicate reports `chatHistory[length-2]` as the wrong turn and produces a
  false negative that looks like a real bug.
