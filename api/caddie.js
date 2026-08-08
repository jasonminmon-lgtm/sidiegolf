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
    description: 'Set the round type and scoring method.\n\nroundType values (exact):\n- "stroke" = Stroke Play Round (any stroke-based game: gross, net, stableford, wolf, skins, nassau, etc.)\n- "match" = Match Play Round (singles, four-ball, foursomes)\n- "event" = Golf Event (tournament, trip, multi-day, multi-group)\n\nscoring method values (exact, by roundType):\n- stroke: "Stroke Play (Gross)", "Net Stroke Play", "Stableford", "Modified Stableford"\n- match: "Singles Match Play", "Four-Ball (Better Ball)", "Foursomes (Alternate Shot)"\n- event: "Stroke Play", "Stableford", "Modified Stableford", "Match Play", "Ryder Cup Format"\n\nWolf, Nassau, Skins, Scotch, Banker, etc. are SIDE GAMES — never use them as scoringMethod. A "Wolf round" = roundType "stroke" + Wolf added as a side game at step 5.\n\nIMPORTANT: If the player says "stroke play" without specifying Gross or Net, set scoringMethod to "" and ask them before proceeding.',
    input_schema: {
      type: 'object',
      properties: {
        roundType: { type: 'string', enum: ['stroke', 'match', 'event'] },
        scoringMethod: { type: 'string', description: 'Exact scoring method name from the list above. Use empty string if ambiguous (e.g. stroke play without gross/net).' }
      },
      required: ['roundType']
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
    name: 'set_player_count',
    description: 'Set the total number of player slots for the round (2–20). Creates placeholder slots when expanding, removes empty placeholder slots when shrinking. Use this when the player specifies how many people are playing before you know who they are. Never removes a real named player — only trims empty "Player N" placeholders.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Total players in the round (2–20)' }
      },
      required: ['count']
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
    description: 'Add a side game to the round. Available games: "Wolf", "Coin Flip Wolf", "3-Man Wolf", "Nassau", "Skins", "Scotch", "Banker", "9 Point", "Bingo Bango Bongo", "Snake", "Vegas".\n\nWolf options: amount ($ per man), hammerOn ("Off"/"On"), birdieEagle ("Off"/"Birdie 2x / Eagle 3x"/"Birdie 2x / Eagle 4x"), birdieEagleBasis ("Net"/"Gross"), carryRule ("None"/"Carry (unlimited)"/"Carry (max 1)"/"Carry (max 2)"/"Carry (max 3)"), cryBaby ("Off"/"On"), cryBabyStartHole ("16"/"17"/"18"), cryBabyRaise ("25%"..."200%").\n\nNassau options: front (front 9 $), back (back 9 $), total (total 18 $), carryTies ("Off"/"On"), pressAuto ("Off"/"1 hole"/"2 holes").\n\nSkins: amount ($ per skin). 9 Point: amount ($ per point).',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Game type exactly as listed above' },
        amount: { type: 'number', description: 'Wolf/Skins/9 Point: $ per man / per skin / per point' },
        front: { type: 'number', description: 'Nassau: front 9 $ bet' },
        back: { type: 'number', description: 'Nassau: back 9 $ bet' },
        total: { type: 'number', description: 'Nassau: total 18 $ bet' },
        carryTies: { type: 'string', enum: ['Off','On'], description: 'Nassau: carry front 9 tie to back 9' },
        pressAuto: { type: 'string', enum: ['Off','1 hole','2 holes'], description: 'Nassau: auto-press when down this many holes' },
        hammerOn: { type: 'string', enum: ['Off','On'], description: 'Wolf: hammers on or off' },
        birdieEagle: { type: 'string', enum: ['Off','Birdie 2x / Eagle 3x','Birdie 2x / Eagle 4x'], description: 'Wolf: birdie/eagle bonus for winning side' },
        birdieEagleBasis: { type: 'string', enum: ['Net','Gross'], description: 'Wolf: net or gross birdie/eagle' },
        carryRule: { type: 'string', enum: ['None','Carry (unlimited)','Carry (max 1)','Carry (max 2)','Carry (max 3)'], description: 'Wolf: carry rule for tied holes' },
        cryBaby: { type: 'string', enum: ['Off','On'], description: 'Wolf: cry baby rule on closing holes' },
        cryBabyStartHole: { type: 'string', enum: ['16','17','18'], description: 'Wolf: hole where cry baby activates' },
        cryBabyRaise: { type: 'string', enum: ['25%','50%','75%','100%','125%','150%','175%','200%'], description: 'Wolf: cry baby raise as % of $ the trailer is down' }
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
  },
  {
    name: 'open_account',
    description: 'Open the My Account overlay so the player can view or edit their profile, GHIN number, handicap index, change their password, view round history, or access the Season Money Ledger.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'open_season_ledger',
    description: 'Open the Season Money Ledger showing net money won/lost per player across all completed rounds (Standings tab) and a per-round breakdown (By Round tab) with settle tracking.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'submit_feedback',
    description: 'Submit feedback from the player — bug reports, feature requests, UX issues, or general comments. Always confirm the message with the player before submitting.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['bug', 'feature', 'ux', 'general'], description: 'bug = Bug Report, feature = Feature Request, ux = User Experience, general = General Feedback' },
        message: { type: 'string', description: 'The full feedback message text' }
      },
      required: ['category', 'message']
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
  let prompt = `You are Caddie, SidieGolf's AI game manager. You control the app directly — every tool call updates the UI in real time so the player can see each step being configured.

━━ ROUND TYPE VALUES (use exactly) ━━
• "stroke" — any stroke-based round (gross, net, stableford, wolf, nassau, skins — all use this)
• "match"  — match play (singles, four-ball, foursomes)
• "event"  — tournament, golf trip, multi-day, multi-group

━━ SCORING METHOD VALUES (use exactly) ━━
stroke rounds: "Stroke Play (Gross)" | "Net Stroke Play" | "Stableford" | "Modified Stableford"
match rounds:  "Singles Match Play" | "Four-Ball (Better Ball)" | "Foursomes (Alternate Shot)"
event rounds:  "Stroke Play" | "Stableford" | "Modified Stableford" | "Match Play" | "Ryder Cup Format"

Wolf, Nassau, Skins, Scotch, Banker = SIDE GAMES added at step 5, never scoring methods.
"Wolf round" = roundType "stroke" + Wolf added as a side game.

━━ STEP ORDER — never skip, always navigate so the player sees progress ━━
1. set_round_type → navigate_to_step(1)  [player sees round type card highlighted]
2. navigate_to_step(2)                   [player sees scoring method options]
   ⚠ STOP if stroke play was requested but Gross/Net not specified — ask "Gross or Net?" and wait.
   Once answered, call set_round_type again with the full scoringMethod, then navigate_to_step(2).
3. navigate_to_step(3) → search_course → set_course  [player sees course selected]
4. navigate_to_step(4) → search_buddies + add_player for each player
5. navigate_to_step(5) → add_side_game(s) for any games requested
6. navigate_to_step(6) only when player explicitly says "lock" or "start"

━━ NATURAL LANGUAGE ━━
Accept info in any order. "Wolf at Barton Creek with Dave and Tim, $5/man hammers on" → parse all of it, then execute in step order above. Never execute out of order.

━━ PLAYER SLOTS ━━
The app pre-allocates "Player 1", "Player 2", etc. as empty placeholders. add_player fills the first empty slot automatically — never creates duplicates. The context shows only real (named) players; totalSlots shows how many slots exist total.
- If told "4 players" before names are known → call set_player_count(4)
- If told "update to 4 players" or "we only have 3" → call set_player_count(N)
- NEVER call set_round_type to fix player count issues — it navigates back to step 1

━━ SET_ROUND_TYPE RULES ━━
- Call set_round_type exactly ONCE per setup, at the very beginning.
- If the round is already partially configured (course set, players added) and the player asks to change player count, scoring, or anything else — use the specific tool for that. NEVER re-call set_round_type.
- After set_round_type, immediately call navigate_to_step(1) so the UI reflects the choice.

━━ ACCOUNT & HISTORY ━━
- open_account → opens My Account (edit name/GHIN/handicap, password reset, history, ledger)
- open_season_ledger → opens Season Money Ledger (net standings + per-round breakdown)

━━ FEEDBACK ━━
- submit_feedback → saves feedback to Firestore + sends email notification
- Always confirm the message text with the player before calling submit_feedback
- Categories: "bug" (Bug Report), "feature" (Feature Request), "ux" (User Experience), "general" (General Feedback)

━━ OTHER RULES ━━
- Always search_buddies before add_player (for accurate HI/GHIN)
- Always search_course before set_course
- Never claim something was done unless the tool call returned success
- Be concise — 1 sentence per confirmation. Ask only one question at a time.
- Use golf lingo.`;

  if (ctx) {
    prompt += '\n\n--- Current App State ---\n';
    if (ctx.step) prompt += `On step: ${ctx.step}\n`;
    if (ctx.roundType) prompt += `Round type: ${ctx.roundType}\n`;
    if (ctx.scoringMethod) prompt += `Scoring: ${ctx.scoringMethod}\n`;
    if (ctx.course) prompt += `Course: ${ctx.course.name} (idx ${ctx.course.idx}), tees: ${ctx.course.tees.join(', ')}\n`;
    if (ctx.totalSlots) prompt += `Player slots: ${ctx.totalSlots} total\n`;
    if (ctx.players && ctx.players.length) {
      prompt += `Real players (${ctx.players.length}): ` + ctx.players.map(p => `${p.name} HI:${p.hi}`).join(', ') + '\n';
    } else if (ctx.totalSlots) {
      prompt += `Real players: 0 (all slots are empty placeholders)\n`;
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
