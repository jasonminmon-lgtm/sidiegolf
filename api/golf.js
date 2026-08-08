// api/golf.js — SidieGolf Golf Course API proxy
// Runs server-side on Vercel: no CORS issues, API key stays off the client,
// and search results are cached on the CDN for 1 hour.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const GOLF_API_KEY = process.env.GOLF_API_KEY || 'VK3W5WLWKMMOWVAJIRKNDSSPPI';
  const GOLF_API_BASE = 'https://api.golfcourseapi.com';

  const { type, search_query, id } = req.query;
  let url;

  if (type === 'search') {
    if (!search_query) { res.status(400).json({ error: 'search_query required' }); return; }
    url = `${GOLF_API_BASE}/v1/search?search_query=${encodeURIComponent(search_query)}`;
  } else if (type === 'course') {
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    url = `${GOLF_API_BASE}/v1/courses/${encodeURIComponent(id)}`;
  } else {
    res.status(400).json({ error: 'type must be "search" or "course"' }); return;
  }

  try {
    const apiRes = await fetch(url, {
      headers: { 'Authorization': `Key ${GOLF_API_KEY}` }
    });
    if (apiRes.status === 401) { res.status(401).json({ error: 'API key was rejected.' }); return; }
    if (apiRes.status === 429) { res.status(429).json({ error: "Today's free request limit (50/day) has been reached." }); return; }
    if (!apiRes.ok) { res.status(apiRes.status).json({ error: `Golf API error (HTTP ${apiRes.status}).` }); return; }
    const data = await apiRes.json();
    // Cache search results for 1 hour on Vercel's CDN
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to reach golf course API.' });
  }
};
