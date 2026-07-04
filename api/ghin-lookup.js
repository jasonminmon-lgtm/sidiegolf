// api/ghin-lookup.js — Vercel serverless function
// Same GHIN auth flow, adapted for Vercel's req/res format.
//
// Auth flow:
//   1. POST Firebase installations → get session token
//   2. POST api2.ghin.com/golfer_login.json with session token → get golfer_user_token
//   3. GET  api2.ghin.com/golfers.json?golfer_id=<GHIN>&source=GHINcom (Bearer auth)
//
// Required env vars (Vercel dashboard → Project → Settings → Environment Variables):
//   GHIN_USERNAME  — your ghin.com email or GHIN number
//   GHIN_PASSWORD  — your ghin.com password

const FIREBASE_URL   = 'https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations';
const GOOGLE_API_KEY = 'AIzaSyBxgTOAWxiud0HuaE5tN-5NTlzFnrtyz-I';
const FIREBASE_BODY  = JSON.stringify({
  appId:       '1:884417644529:web:47fb315bc6c70242f72650',
  authVersion: 'FIS_v2',
  fid:         'fg6JfS0U01YmrelthLX9Iz',
  sdkVersion:  'w:0.5.7',
});

const GHIN_BASE       = 'https://api2.ghin.com/api/v1';
const GHIN_LOGIN_URL  = GHIN_BASE + '/golfer_login.json';
const GHIN_SEARCH_URL = GHIN_BASE + '/golfers.json';
const SOURCE          = 'GHINcom';
const UA              = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'User-Agent': UA };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const rawGhin = (req.query.ghin || '').trim();
  if (!/^\d{5,8}$/.test(rawGhin)) {
    return res.status(400).json({ error: 'GHIN number must be 5–8 digits.' });
  }
  // Do NOT zero-pad — the GHIN API parses leading-zero numbers as octal,
  // which throws "golfer_id is not an integer" for any number containing 8 or 9.
  // Send the number exactly as entered.
  const ghinNumber = rawGhin;

  const username = process.env.GHIN_USERNAME;
  const password = process.env.GHIN_PASSWORD;
  if (!username || !password) {
    return res.status(500).json({ error: 'GHIN_USERNAME and GHIN_PASSWORD env vars not set.' });
  }

  // ── Step 1: Firebase session token ───────────────────────────────────────
  let sessionToken;
  try {
    const fbRes = await fetch(FIREBASE_URL, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-goog-api-key': GOOGLE_API_KEY },
      body: FIREBASE_BODY,
    });
    if (!fbRes.ok) throw new Error('HTTP ' + fbRes.status);
    const fbData = await fbRes.json();
    sessionToken = fbData?.authToken?.token;
    if (!sessionToken) throw new Error('no authToken.token in response');
  } catch (err) {
    return res.status(502).json({ error: 'Firebase pre-auth failed: ' + err.message });
  }

  // ── Step 2: GHIN login → golfer_user_token ────────────────────────────────
  let accessToken;
  try {
    const loginRes = await fetch(GHIN_LOGIN_URL, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        token: sessionToken,
        user: { email_or_ghin: username, password },
      }),
    });
    if (!loginRes.ok) throw new Error('HTTP ' + loginRes.status);
    const loginData = await loginRes.json();
    accessToken = loginData?.golfer_user?.golfer_user_token;
    if (!accessToken) throw new Error('no golfer_user_token in response');
  } catch (err) {
    return res.status(502).json({ error: 'GHIN login failed: ' + err.message });
  }

  // ── Step 3: Golfer lookup by GHIN number ─────────────────────────────────
  try {
    const url = GHIN_SEARCH_URL
      + '?source=' + SOURCE
      + '&from_ghin=true'
      + '&per_page=1'
      + '&sorting_criteria=full_name'
      + '&order=asc'
      + '&page=1'
      + '&golfer_id=' + encodeURIComponent(ghinNumber);

    const searchRes = await fetch(url, {
      headers: {
        ...JSON_HEADERS,
        source: SOURCE,
        Authorization: 'Bearer ' + accessToken,
      },
    });

    if (!searchRes.ok) {
      const body = await searchRes.text();
      return res.status(502).json({ error: 'GHIN search failed (HTTP ' + searchRes.status + '): ' + body.slice(0, 200) });
    }

    const data = await searchRes.json();
    const golfers = data.golfers || [];

    if (!golfers.length) {
      return res.status(404).json({ error: 'GHIN number not found.' });
    }

    const g = golfers[0];
    return res.status(200).json({
      handicap_index: g.handicap_index != null ? String(g.handicap_index) : '',
      first_name:     g.first_name || '',
      last_name:      g.last_name  || '',
    });

  } catch (err) {
    return res.status(502).json({ error: 'GHIN lookup error: ' + err.message });
  }
};
