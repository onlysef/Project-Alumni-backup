// Reads a *public* Google Form (Anyone with the link can view/respond) and
// converts its questions into our TracerFormConfig { pages: [...] } shape.
//
// Google Forms has no public read API for arbitrary forms — the only way to
// read a form's structure without the owner granting OAuth access is to
// parse the `FB_PUBLIC_LOAD_DATA_` JSON blob Google embeds in the public
// viewform page itself. This is undocumented but stable enough that many
// open-source tools rely on it; verified here against two live forms.
//
// Item shape: [itemId, title, description, type, entries, ...]
//   entries[0] = [entryId, choices|null, ...unused, requiredFlag]
//   choices    = [[label, null, null, null, isOtherOrRequired], ...]
// type 8 = PAGE_BREAK (a real multi-page split in the source form).
// type 6 = TITLE_AND_DESCRIPTION — a plain heading Google renders inline on
// the same page (no actual page break). Tested against a real tracer-study
// form that only used these (no type 8 at all) to organize ~24 questions
// into 5 sections ("Personal Information", "Academic Information", etc.);
// treating type 6 as page-break-equivalent turns each of those sections into
// its own page here, instead of dumping every question onto one long page.

const ALLOWED_HOSTS = ['docs.google.com', 'forms.gle'];

const TYPE_MAP = {
  0: 'text',      // SHORT_ANSWER
  1: 'textarea',  // PARAGRAPH
  2: 'radio',     // MULTIPLE_CHOICE (Google's name for single-select)
  3: 'select',    // DROPDOWN
  4: 'checkbox',  // CHECKBOXES
  9: 'text',      // DATE — no dedicated date question type yet; collect as free text rather than drop it
};

const PAGE_BREAK_TYPES = new Set([8, 6]);

function assertAllowedUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new Error('That doesn\'t look like a valid URL.');
  }
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    throw new Error('Please paste a Google Forms link (docs.google.com/forms/... or forms.gle/...).');
  }
  return parsed.toString();
}

async function fetchFormHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
  } catch {
    throw new Error('Could not reach that link. Check your connection and the URL.');
  }
  if (!res.ok) {
    throw new Error(`Google Forms returned an error (${res.status}). Make sure the form is public and the link is correct.`);
  }
  return res.text();
}

function extractFormData(html) {
  const m = html.match(/var FB_PUBLIC_LOAD_DATA_ = (.*?);<\/script>/s);
  if (!m) {
    throw new Error('Could not read this form. Make sure sharing is set to "Anyone with the link can view" and the URL points to the form itself (not a response/edit link).');
  }
  try {
    return JSON.parse(m[1]);
  } catch {
    throw new Error('Could not parse this form\'s data. Google may have changed its page format.');
  }
}

function mapChoices(choices) {
  return (choices || []).map((c) => (c && c[0]) ? c[0] : 'Other');
}

// Converts the raw FB_PUBLIC_LOAD_DATA_ payload into { title, pages, warnings }
function convertToPages(data) {
  const meta = data[1] || [];
  const formTitle = meta[8] || 'Imported Form';
  const items = meta[1] || [];

  const pages = [];
  const warnings = [];
  let currentTitle = null;
  let currentQuestions = [];
  let started = false;

  function flushPage() {
    if (!started) return;
    pages.push({
      id: 'page_' + (pages.length + 1),
      title: currentTitle || `Page ${pages.length + 1}`,
      questions: currentQuestions,
    });
  }

  items.forEach((item) => {
    const [itemId, title, , type, entries] = item;

    if (PAGE_BREAK_TYPES.has(type)) {
      // Real page break (8) or inline section heading (6) — both start a new
      // page here. Don't flush an empty leading page if this is the very
      // first item in the form.
      if (started || currentQuestions.length > 0) flushPage();
      currentTitle = title || null;
      currentQuestions = [];
      started = true;
      return;
    }

    const mappedType = TYPE_MAP[type];
    if (!mappedType) {
      // Images, linear scales, grids, date/time, etc. — not supported yet.
      warnings.push({ title: title || '(untitled)', type });
      return;
    }

    started = true;
    const entry = (entries && entries[0]) || [];
    const choices = Array.isArray(entry[1]) ? entry[1] : null;
    const required = !!entry[entry.length - 1];

    currentQuestions.push({
      id: 'gf_' + itemId,
      type: mappedType,
      label: title || '',
      options: choices ? mapChoices(choices) : [],
      required,
      order: currentQuestions.length,
    });
  });

  flushPage();

  return { title: formTitle, pages, warnings };
}

async function importGoogleForm(rawUrl) {
  const url = assertAllowedUrl(rawUrl);
  const html = await fetchFormHtml(url);
  const data = extractFormData(html);
  return convertToPages(data);
}

module.exports = { importGoogleForm };
