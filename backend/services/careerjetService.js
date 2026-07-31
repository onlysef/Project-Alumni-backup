const CAREERJET_URL = 'http://public.api.careerjet.net/search';

// Thin wrapper around Careerjet's public search API (docs:
// https://www.careerjet.com/partners/api). Requires a free affiliate ID
// (CAREERJET_AFFID) issued through their partner signup — without it every
// call fails fast so the controller can degrade gracefully instead of the
// page silently hanging.
async function searchJobs({ keywords, location, contracttype, contractperiod, page, pagesize, sort, userIp, userAgent, referrerUrl }) {
  const affid = process.env.CAREERJET_AFFID;
  if (!affid) {
    const err = new Error('Careerjet is not configured (missing CAREERJET_AFFID)');
    err.code = 'CAREERJET_NOT_CONFIGURED';
    throw err;
  }

  const params = new URLSearchParams({
    affid,
    keywords: keywords || '',
    location: location || '',
    locale_code: process.env.CAREERJET_LOCALE || 'en_PH',
    user_ip: userIp || '127.0.0.1',
    user_agent: userAgent || 'Mozilla/5.0',
    url: referrerUrl,
    page: String(page || 1),
    pagesize: String(pagesize || 10),
    sort: sort || 'relevance',
    // Default excerpt is a ~120-char snippet — the "See details" modal
    // needs the (near-)full posting, and card previews are truncated
    // client-side instead, so ask Careerjet for a long fragment once.
    fragment_size: '6000',
  });
  // p=permanent, c=contract, t=temporary, i=training/internship, v=voluntary
  if (contracttype) params.set('contracttype', contracttype);
  // f=full-time, p=part-time
  if (contractperiod) params.set('contractperiod', contractperiod);

  // Careerjet checks the actual Referer header against the declared
  // publisher website, not just the `url` query param — omitting it gives
  // a 403 "Undeclared referrer" even with a valid affid.
  const res = await fetch(`${CAREERJET_URL}?${params.toString()}`, {
    headers: {
      Referer: referrerUrl,
      'User-Agent': userAgent || 'Mozilla/5.0',
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Careerjet request failed (${res.status})`);
  }
  if (data?.type === 'ERROR') {
    throw new Error(data.error || 'Careerjet returned an error');
  }
  return data;
}

module.exports = { searchJobs };
