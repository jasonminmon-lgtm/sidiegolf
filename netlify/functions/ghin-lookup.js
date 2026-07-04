// ghin-lookup.js — Netlify serverless function
// Reverse-engineered from n8io/ghin open-source library (MIT).
//
// Auth flow:
//   1. POST Firebase installations → get session token
//   2. POST api2.ghin.com/golfer_login.json with session token → get golfer_user_token
//   3. GET  api2.ghin.com/golfers.json?golfer_id=<GHIN>&source=GHINcom (Bearer auth)
//      → returns first_name, last_name, handicap_index in one call
//
// Required Netlify env vars (Netlify dashboard → Site settings → Environment variables):
//   GHIN_USERNAME  — your ghin.com email or GHIN number
//   GHIN_PASSWORD  — your ghin.com password

const FIREBASE_URL     = 'https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations';
const GOOGLE_API_KEY   = 'AIzaSyBxgTOAWxiud0HuaE5tN-5NTlzFnrtyz-I';
const FIREBASE_BODY    = JSON.stringify({
  appId:       '1:884417644529:web:47fb315bc6c70242f72650',
  authVersion: 'FIS_v2',
  fid:         'fg6JfS0U01YmrelthLX9Iz',
  sdkVersion:  'w:0.5.7',
});

const GHIN_BASE      = 'https://api2.ghin.com/api/v1';
const GHIN_LOGIN_URL = GHIN_BASE + '/golfer_login.json';
const GHIN_SEARCH_URL = GHIN_BASE + '/golfers.json';
const SOURCE         = 'GHINcom';
const UA             = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'User-Agent': UA };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const rawGhin = ((event.queryStringParameters || {}).ghin || '').trim();
  if (!/^\d{6,8}$/.test(rawGhin)) {
    return respond(400, { error: 'GHIN number must be 6–8 digits.' });
  }
  // GHIN stores all numbers zero-padded to 7 digits
  const ghinNumber = rawGhin.padStart(7, '0');

  const username = process.env.GHIN_USERNAME;
  const password = process.env.GHIN_PASSWORD;
  if (!username || !password) {
    return respond(500, { error: 'GHIN_USERNAME and GHIN_PASSWORD env vars not set in Netlify.' });
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
    return respond(502, { error: 'Firebase pre-auth failed: ' + err.message });
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
    if (!loginRes.ok) throw new Error('HTTP ' + loginRes.status + ' — check GHIN_USERNAME/GHIN_PASSWORD');
    const loginData = await loginRes.json();
    accessToken = loginData?.golfer_user?.golfer_user_token;
    if (!accessToken) throw new Error('no golfer_user_token in login response');
  } catch (err) {
    return respond(502, { error: 'GHIN login failed: ' + err.message });
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
      return respond(502, { error: 'GHIN search failed (HTTP ' + searchRes.status + '): ' + body.slice(0, 200) });
    }

    const data = await searchRes.json();
    const golfers = data.golfers || [];

    if (!golfers.length) {
      return respond(404, { error: 'GHIN number not found.' });
    }

    const g = golfers[0];
    return respond(200, {
      handicap_index: g.handicap_index != null ? String(g.handicap_index) : '',
      first_name:     g.first_name || '',
      last_name:      g.last_name  || '',
    });

  } catch (err) {
    return respond(502, { error: 'GHIN lookup error: ' + err.message });
  }
};
