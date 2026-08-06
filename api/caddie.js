// api/caddie.js — SidieGolf Caddie AI proxy (agentic, tool-calling)
// Vercel serverless function: keeps ANTHROPIC_API_KEY server-side

const CADDIE_TOOLS = [
  {
    name: 'get_app_state',
    description: 'Get the full current state of the app: step, round type, players, course, side games, teams, event days. Call this first when you need to understand what is already configured.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'navigate_to_step',
    description: 'Navigate the app to a specific setup step. Step 1=Welcome, 2=Round Type & Scoring, 3=Course & Date, 4=Who\'s Playing, 5=Games & Event Schedule, 6=Lock & Start, 7=Scorecard/Leaderboard.',
    input_schema: {
      type: 'object',
      properties: {
        step: { type: 'number', description: 'Step number 1-7' }
      },
      required: ['step']
    }
  },
  {
    name: 'set_round_type',
    description: 'Set the round type and scoring method. roundType: "local" (solo, no sync), "networked" (live multi-device), "event" (multi-day golf event). scoringMethod examples: "Stroke Play (Net)", "Stroke Play (Gross)", "Match Play", "Nassau", "Wolf", "Coin Flip Wolf", "3-Man Wolf", "Skins", "Stableford", "Modified Stableford", "Ryder Cup Format", "Scramble", "Shamble", "Best Ball", "Foursomes (Alternate Shot)".',
    input_schema: {
      type: 'object',
      properties: {
        roundType: { type: 'string', enum: ['local', 'networked', 'event'] },
        scoringMethod: { type: 'string', description: 'The primary scoring method name' }
      },
      required: ['roundType', 'scoringMethod']
    }
  },
  {
    name: 'search_course',
    description: 'Search for a golf course by name. Returns matching courses with courseIdx values needed for set_course. Always search before setting a course.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Course name or partial name, e.g. "Barton Creek" or "Pebble Beach"' }
      },
      required: ['query']
    }
  },
  {
    name: 'set_course',
    description: 'Set the golf course for the round using a courseIdx from search_course results. Optionally specify a tee.',
    input_schema: {
      type: 'object',
      properties: {
        courseIdx: { type: 'number', description: 'Course index from search_course results' },
        tee: { type: 'string', description: 'Tee name e.g. "Blue", "White", "Gold", "Red". Omit to use the first available tee.' }
      },
      required: ['courseIdx']
    }
  },
  {
    name: 'search_buddies',
    description: 'Search the user\'s Golf Buddies list by name. Returns matching players with their handicap index and GHIN. Use "*" or "" to list all buddies.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Player name or partial name. Use "*" to list all.' }
      },
      required: ['query']
    }
  },
  {
    name: 'add_player',
    description: 'Add a player to the current round. Always use search_buddies first to get accurate HI and GHIN.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Player full name' },
        hi: { type: 'string', description: 'Handicap index, e.g. "5.2"' },
        ghin: { type: 'string', description: 'GHIN number' },
        tee: { type: 'string', description: 'Tee color/name for this player' }
      },
      required: ['name']
    }
  },
  {
    name: 'remove_player',
    description: 'Remove a player from the current round by name.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact player name to remove' }
      },
      required: ['name']
    }
  },
  {
    name: 'set_player_tee',
    description: 'Set the tee for a specific player.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Player name' },
        tee: { type: 'string', description: 'Tee name e.g. "Blue", "White", "Red"' }
      },
      required: ['name', 'tee']
    }
  },
  {
    name: 'add_side_game',
    description: 'Add a side/sidie game to the round. Available games: "Nassau", "Wolf", "Coin Flip Wolf", "3-Man Wolf", "Skins", "Scotch", "Banker", "Stableford", "Modified Stableford". Specify buyIn and any game-specific options.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Game type name exactly as listed' },
        buyIn: { type: 'number', description: 'Dollar amount (per side for Nassau, per point/hole for Wolf/Skins, etc.)' },
        carryTies: { type: 'boolean', description: 'Nassau: whether tied holes carry over to next hole' },
        pressAuto: { type: 'number', description: 'Nassau: automatically press when this many down (e.g. 2)' },
        eagleMultiplier: { type: 'number', description: 'Wolf: eagle multiplier, 2, 3, or 4x' },
        hammerOn: { type: 'boolean', description: 'Wolf: enable hammer doubling feature' }
      },
      required: ['type']
    }
  },
  {
    name: 'remove_side_game',
    description: 'Remove a side game from the round by its type name.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Game type to remove, e.g. "Nassau"' }
      },
      required: ['type']
    }
  },
  {
    name: 'set_ryder_cup_teams',
    description: 'Set up Ryder Cup teams: name each team and assign all players to Team A or Team B.',
    input_schema: {
      type: 'object',
      properties: {
        teamAName: { type: 'string', description: 'Name for Team A, e.g. "USA" or "Tony\'s Team"' },
        teamBName: { type: 'string', description: 'Name for Team B, e.g. "Europe" or "Kevin\'s Team"' },
        teamA: { type: 'array', items: { type: 'string' }, description: 'Player names for Team A' },
        teamB: { type: 'array', items: { type: 'string' }, description: 'Player names for Team B' }
      },
      required: ['teamAName', 'teamBName', 'teamA', 'teamB']
    }
  },
  {
    name: 'assign_player_to_group',
    description: 'Assign a player to a group number for a specific event day. Groups are numbered starting at 1.',
    input_schema: {
      type: 'object',
      properties: {
        playerName: { type: 'string' },
        groupNum: { type: 'number', description: 'Group number starting at 1' },
        dayIndex: { type: 'number', description: '0-based day index. Defaults to 0.' }
      },
      required: ['playerName', 'groupNum']
    }
  },
  {
    name: 'set_group_format',
    description: 'Set the match format for a group on an event day.',
    input_schema: {
      type: 'object',
      properties: {
        groupNum: { type: 'number', description: 'Group number starting at 1' },
        format: { type: 'string', description: 'Format: "Four-Ball", "Foursomes", or "Singles"' },
        dayIndex: { type: 'number', description: '0-based day index. Defaults to 0.' }
      },
      required: ['groupNum', 'format']
    }
  },
  {
    name: 'set_singles_pairing',
    description: 'Set Singles match pairings within a group for an event day. Each pair is one match.',
    input_schema: {
      type: 'object',
      properties: {
        groupNum: { type: 'number' },
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              playerA: { type: 'string', description: 'Team A player name' },
              playerB: { type: 'string', description: 'Team B player name' }
            },
            required: ['playerA', 'playerB']
          }
        },
        dayIndex: { type: 'number', description: '0-based day index. Defaults to 0.' }
      },
      required: ['groupNum', 'pairs']
    }
  },
  {
    name: 'configure_event_day',
    description: 'Configure an event day: set course, tee, day format, point value, points scope, number of groups.',
    input_schema: {
      type: 'object',
      properties: {
        dayIndex: { type: 'number', description: '0-based day index' },
        courseIdx: { type: 'number', description: 'Course index from search_course' },
        tee: { type: 'string', description: 'Tee name' },
        dayFormat: { type: 'string', description: '"match", "teamStroke", "scramble", "shamble", "bestBall", "par3Birdie"' },
        pointValue: { type: 'number', description: 'Points available for winning this day' },
        pointsScope: { type: 'string', enum: ['perMatch', 'perDay'], description: 'perMatch: each group match is worth points. perDay: one winner takes all points.' },
        numGroups: { type: 'number', description: 'Number of groups for this day' }
      },
      required: ['dayIndex']
    }
  },
  {
    name: 'lock_and_start',
    description: 'Lock the round and start play. Only call this after the round is fully configured with players, course, and games.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_leaderboard',
    description: 'Get the current leaderboard, scores, and standings for the active round.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'enter_score',
    description: 'Enter a gross score for a player on a specific hole.',
    input_schema: {
      type: 'object',
      properties: {
        playerName: { type: 'string' },
        hole: { type: 'number', description: 'Hole number 1-18' },
        score: { type: 'number', description: 'Gross strokes for the hole' }
      },
      required: ['playerName', 'hole', 'score']
    }
  }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  let { messages, context, toolResults, toolCalls } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  // If returning from client-side tool execution, append tool use + results to history
  if (toolResults && toolResults.length > 0 && toolCalls && toolCalls.length > 0) {
    messages = [
      ...messages,
      {
        role: 'assistant',
        content: toolCalls.map(tc => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input || {}
        }))
      },
      {
        role: 'user',
        content: toolResults.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.id,
          content: String(tr.result)
        }))
      }
    ];
  }

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
        max_tokens: 1024,
        system: buildSystemPrompt(context),
        tools: CADDIE_TOOLS,
        messages
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }

    // Claude wants to call tools — return them to the browser to execute
    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
      return res.status(200).json({
        tool_calls: toolUseBlocks.map(b => ({ id: b.id, name: b.name, input: b.input }))
      });
    }

    // Final text response
    const textBlock = data.content.find(b => b.type === 'text');
    return res.status(200).json({ reply: textBlock ? textBlock.text : 'Done.' });

  } catch (err) {
    console.error('Caddie handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function buildSystemPrompt(ctx) {
  let prompt = `You are Caddie, the AI assistant built into SidieGolf. You have full control of the app and can set up and manage everything a human manager can.

Your capabilities (via tools):
- Set round type and scoring method
- Search and set the golf course
- Search the user's Buddies list and add players
- Set player tees
- Add and configure side games (Nassau, Wolf, Skins, Scotch, Banker, etc.)
- Set up Ryder Cup teams
- Assign players to groups and configure group formats for event days
- Set Singles match pairings
- Configure multi-day event schedules
- Lock and start the round
- Read the leaderboard and enter scores

Behavior rules:
- Be concise — golfers are on the course. Confirm actions in 1-2 sentences.
- When a user asks you to set something up, DO IT using tools — don't ask permission or explain what you're about to do.
- For multi-step setups (e.g. "set up a Wolf round with Dave and Tim"), chain the tools: set_round_type → navigate to step 3 → search_course → set_course → navigate to step 4 → search_buddies → add_player × N → navigate to step 5 → add_side_game → navigate to step 6.
- Always search_buddies before add_player so HI and GHIN are accurate.
- Always search_course before set_course.
- If something isn't clear, make a reasonable assumption and proceed — you can always adjust.
- Use golf lingo naturally.`;

  if (ctx) {
    prompt += '\n\n--- Current App State ---\n';
    if (ctx.step) prompt += `On step: ${ctx.step}\n`;
    if (ctx.roundType) prompt += `Round type: ${ctx.roundType}\n`;
    if (ctx.scoringMethod) prompt += `Scoring: ${ctx.scoringMethod}\n`;
    if (ctx.course) prompt += `Course: ${ctx.course.name} (idx ${ctx.course.idx}), tees: ${ctx.course.tees.join(', ')}\n`;
    if (ctx.players && ctx.players.length) {
      prompt += `Players (${ctx.players.length}): ` + ctx.players.map(p => `${p.name} HI:${p.hi}`).join(', ') + '\n';
    }
    if (ctx.teams) {
      prompt += `Team A (${ctx.teams.A}), Team B (${ctx.teams.B})\n`;
    }
    if (ctx.sideGames && ctx.sideGames.length) {
      prompt += `Side games: ` + ctx.sideGames.map(g => g.type).join(', ') + '\n';
    }
    if (ctx.days && ctx.days.length) {
      prompt += `Event days: ${ctx.days.length}\n`;
    }
    if (ctx.leaderboard) {
      prompt += `Leaderboard: ${ctx.leaderboard}\n`;
    }
  }

  return prompt;
}
