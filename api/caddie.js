// api/caddie.js — SidieGolf Caddie AI proxy
// Vercel serverless function: keeps ANTHROPIC_API_KEY server-side

export default async function handler(req, res) {
  // CORS for sidiegolf.com
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { messages, context } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const systemPrompt = buildSystemPrompt(context);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }

    return res.status(200).json({ reply: data.content[0].text });

  } catch (err) {
    console.error('Caddie handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function buildSystemPrompt(ctx) {
  let prompt = `You are Caddie, the AI assistant built into SidieGolf — a golf scoring and side games app. You're an expert caddie: knowledgeable about golf rules, handicaps, match play, and all the side games the app supports.

Side games available: Nassau (with optional press), Wolf (standard, Coin Flip, 3-Man), Skins, Scotch, Banker, Stableford, Modified Stableford.
Event formats: Ryder Cup (match play, singles, team stroke play), Scramble, Shamble, Best Ball, Par 3 Birdie.

Be concise and conversational — golfers are on the course. Use golf lingo naturally. Keep replies to 2-4 sentences unless a detailed explanation is needed.`;

  if (ctx) {
    prompt += '\n\n--- Current Round ---\n';

    if (ctx.roundType) prompt += `Round type: ${ctx.roundType}\n`;
    if (ctx.scoringMethod) prompt += `Format: ${ctx.scoringMethod}\n`;

    if (ctx.players && ctx.players.length) {
      prompt += `Players (${ctx.players.length}): ` +
        ctx.players.map((p, i) => `${p.name} (HI ${p.hi})`).join(', ') + '\n';
    }

    if (ctx.teamA && ctx.teamB) {
      prompt += `Team A (${ctx.teamA.name}): ${(ctx.teamA.members || []).map(i => ctx.players[i]?.name).join(', ')}\n`;
      prompt += `Team B (${ctx.teamB.name}): ${(ctx.teamB.members || []).map(i => ctx.players[i]?.name).join(', ')}\n`;
    }

    if (ctx.days && ctx.days.length) {
      prompt += `Event: ${ctx.days.length} days\n`;
      ctx.days.forEach(function(d, i) {
        prompt += `  Day ${i+1}: ${d.dayFormat || 'match'}, ${d.pointValue || 1}pt(s), status=${d.status || 'pending'}\n`;
      });
    }

    if (ctx.score) {
      prompt += `Current score: ${ctx.score}\n`;
    }

    if (ctx.activeGames && ctx.activeGames.length) {
      prompt += `Active side games: ${ctx.activeGames.join(', ')}\n`;
    }
  }

  return prompt;
}
