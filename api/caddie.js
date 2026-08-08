// api/caddie.js — SidieGolf Caddie AI proxy (agentic, tool-calling)
// Vercel serverless function: keeps ANTHROPIC_API_KEY server-side

const CADDIE_TOOLS = [
  // ── App navigation ──────────────────────────────────────────────────────────
  {
    name: 'get_app_state',
    description: 'Get the full current app state: step, round type, scoring, players, course, side games, teams, event days. Call this first when you need to understand what is already configured.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'navigate_to_step',
    description: 'Navigate to a setup step. 1=Welcome, 2=Round Type & Scoring, 3=Course & Date, 4=Who\'s Playing, 5=Games & Event Schedule, 6=Lock & Start, 7=Scorecard/Leaderboard.',
    input_schema: { type: 'object', properties: { step: { type: 'number' } }, required: ['step'] }
  },

  // ── Round type & scoring ────────────────────────────────────────────────────
  {
    name: 'set_round_type',
    description: 'Set round type and scoring method.\n\nroundType: "stroke" (any stroke-based round — gross, net, stableford, wolf, nassau, skins all use this), "match" (singles/four-ball/foursomes), "event" (tournament/trip/multi-day).\n\nSCORING METHODS (exact strings):\nstroke: "Stroke Play (Gross)" | "Net Stroke Play" | "Stableford" | "Modified Stableford"\nmatch: "Singles Match Play" | "Four-Ball (Better Ball)" | "Foursomes (Alternate Shot)"\nevent: "Stroke Play" | "Stableford" | "Modified Stableford" | "Match Play" | "Ryder Cup Format"\n\nWolf, Nassau, Skins, Scotch, Banker are SIDE GAMES — never use as scoringMethod. If "stroke play" without Gross/Net specified, leave scoringMethod empty and ask first.',
    input_schema: {
      type: 'object',
      properties: {
        roundType: { type: 'string', enum: ['stroke', 'match', 'event'] },
        scoringMethod: { type: 'string', description: 'Exact scoring method string. Empty if ambiguous.' }
      },
      required: ['roundType']
    }
  },

  // ── Course & date ───────────────────────────────────────────────────────────
  {
    name: 'search_course',
    description: 'Search for a golf course by name. Returns courseIdx values needed for set_course. Always search before setting a course.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'set_course',
    description: 'Set the golf course using a courseIdx from search_course. Optionally set a tee.',
    input_schema: {
      type: 'object',
      properties: {
        courseIdx: { type: 'number' },
        tee: { type: 'string', description: 'e.g. "Blue", "White", "Gold", "Red"' }
      },
      required: ['courseIdx']
    }
  },
  {
    name: 'set_date',
    description: 'Set the round date.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'Date string, e.g. "2026-08-10" or "today"' } }, required: ['date'] }
  },

  // ── Players ─────────────────────────────────────────────────────────────────
  {
    name: 'search_buddies',
    description: 'Search Golf Buddies by name. Use "*" to list all. Always search before add_player.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'add_player',
    description: 'Add a player to the round. Always search_buddies first for accurate HI/GHIN.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        hi: { type: 'string', description: 'Handicap index, e.g. "5.2"' },
        ghin: { type: 'string' },
        tee: { type: 'string' }
      },
      required: ['name']
    }
  },
  {
    name: 'remove_player',
    description: 'Remove a player from the round by name.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'update_player',
    description: 'Update a player\'s name, handicap index, or tee after they\'ve been added.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Current player name to find' },
        newName: { type: 'string', description: 'New name if changing' },
        hi: { type: 'string', description: 'New handicap index' },
        tee: { type: 'string', description: 'New tee name' }
      },
      required: ['name']
    }
  },
  {
    name: 'set_player_count',
    description: 'Set total number of player slots (2–20). Creates placeholders when expanding, removes empty "Player N" slots when shrinking. Never removes a real named player.',
    input_schema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] }
  },
  {
    name: 'set_player_tee',
    description: 'Set the tee for a specific player.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, tee: { type: 'string' } },
      required: ['name', 'tee']
    }
  },

  // ── Side games ──────────────────────────────────────────────────────────────
  {
    name: 'add_side_game',
    description: 'Add a side game. Available: "Wolf", "Coin Flip Wolf", "3-Man Wolf", "Nassau", "Skins", "Scotch", "Banker", "9 Point", "Bingo Bango Bongo", "Snake", "Vegas".\n\nWolf: amount($), hammerOn, birdieEagle, birdieEagleBasis, carryRule, teeOrder(player names array for wolf rotation).\n\nNassau: front($), back($), total($), carryTies, pressAuto.\n\nSkins: amount($), basis("Net"/"Gross"), carryover("Yes"/"No").\n\n9 Point: amount($), birdiesDouble("Off"/"On"), cryBaby("Off"/"On"), cryBabyStartHole(16 or 17), cryBabyPerPoint($).\n\nScotch: amount($), teamMethod("Fixed Partners"/"Sixes"/"High/Low HCP"/"Captain\'s Draft"), umbrella("Off"/"On"), crackOn("Off"/"On").\n\nBanker: minBet($), ties("Push"/"Banker Wins"), bogeyRule("Off"/"On"), birdieBonus("Off"/"On").\n\nBingo Bango Bongo/Snake/Vegas: amount($).\n\nNote: Wolf Cry Baby/Chaser is per-hole — entered in the Chaser $ row during play, not at setup.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        amount: { type: 'number' },
        front: { type: 'number', description: 'Nassau: front 9 $' },
        back: { type: 'number', description: 'Nassau: back 9 $' },
        total: { type: 'number', description: 'Nassau: total 18 $' },
        carryTies: { type: 'string', enum: ['Off','On'] },
        pressAuto: { type: 'string', enum: ['Off','1 hole','2 holes'] },
        hammerOn: { type: 'string', enum: ['Off','On'] },
        birdieEagle: { type: 'string', enum: ['Off','Birdie 2x / Eagle 3x','Birdie 2x / Eagle 4x'] },
        birdieEagleBasis: { type: 'string', enum: ['Net','Gross'] },
        carryRule: { type: 'string', enum: ['None','Carry (unlimited)','Carry (max 1)','Carry (max 2)','Carry (max 3)'] },
        teeOrder: { type: 'array', items: { type: 'string' }, description: 'Wolf: player names in tee/rotation order' },
        basis: { type: 'string', enum: ['Net','Gross'], description: 'Skins: net or gross scoring' },
        carryover: { type: 'string', enum: ['Yes','No'], description: 'Skins: carry tied skins' },
        birdiesDouble: { type: 'string', enum: ['Off','On'], description: '9 Point: birdies double point value' },
        cryBaby: { type: 'string', enum: ['Off','On'], description: '9 Point: enable Cry Baby mode' },
        cryBabyStartHole: { type: 'number', description: '9 Point: first hole of Cry Baby window (16 or 17)' },
        cryBabyPerPoint: { type: 'number', description: '9 Point: Cry Baby $/point' },
        teamMethod: { type: 'string', enum: ['Fixed Partners','Sixes','High/Low HCP','Captain\'s Draft'], description: 'Scotch: how teams are formed' },
        umbrella: { type: 'string', enum: ['Off','On'], description: 'Scotch: sweeping all 6 points doubles to 12' },
        crackOn: { type: 'string', enum: ['Off','On'], description: 'Scotch: enable crack/crack-back doubling' },
        minBet: { type: 'number', description: 'Banker: minimum wager per hole' },
        ties: { type: 'string', enum: ['Push','Banker Wins'], description: 'Banker: tied holes' },
        bogeyRule: { type: 'string', enum: ['Off','On'], description: 'Banker: Banker auto-loses all on bogey' },
        birdieBonus: { type: 'string', enum: ['Off','On'], description: 'Banker: birdie in matchup doubles payout' }
      },
      required: ['type']
    }
  },
  {
    name: 'remove_side_game',
    description: 'Remove a side game by type name.',
    input_schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] }
  },
  {
    name: 'set_nassau_teams',
    description: 'Set Nassau (or Vegas) team assignments — which players are on Team A vs Team B.',
    input_schema: {
      type: 'object',
      properties: {
        gameType: { type: 'string', enum: ['Nassau','Vegas'], description: 'Which game to set teams for' },
        teamA: { type: 'array', items: { type: 'string' }, description: 'Player names on Team A' },
        teamB: { type: 'array', items: { type: 'string' }, description: 'Player names on Team B' }
      },
      required: ['gameType', 'teamA', 'teamB']
    }
  },
  {
    name: 'set_scotch_teams',
    description: 'Set Scotch Captain\'s Draft team assignments — which players are on Team A vs Team B.',
    input_schema: {
      type: 'object',
      properties: {
        teamA: { type: 'array', items: { type: 'string' }, description: 'Player names on Team A' },
        teamB: { type: 'array', items: { type: 'string' }, description: 'Player names on Team B' }
      },
      required: ['teamA', 'teamB']
    }
  },

  // ── Per-hole game events ────────────────────────────────────────────────────
  {
    name: 'set_hole_event',
    description: 'Set per-hole game data during play. Handles Wolf assignments, BBB/Snake/Banker/Scotch events, and Wolf Chaser $ override. Provide only the fields relevant to the game being played.\n\nWolf fields: wolfPlayer (who is wolf), wolfPartner (partner name or null to clear), wolfAlone (true = Lone Wolf declared), wolfBlind (true = Blind Wolf, must be before tee shots), chaserAmt ($ to override stake for this hole).\n\nBingo Bango Bongo: firstOnGreen, closestToPin, firstIn (all player names).\n\nSnake: snakeBite (player name who most recently 3-putted — they hold the snake).\n\nBanker: banker (player name who is banker), bankerWager ($), bankerMultiplier (1/2/4 etc).\n\nScotch: scotchProx (player closest to pin), scotchStakeOverride ($ override for this hole).',
    input_schema: {
      type: 'object',
      properties: {
        hole: { type: 'number', description: 'Hole number 1–18' },
        wolfPlayer: { type: 'string', description: 'Wolf/3-Man Wolf: player name who is the wolf on this hole' },
        wolfPartner: { type: 'string', description: 'Wolf: partner name (null/"" to clear partner)' },
        wolfAlone: { type: 'boolean', description: 'Wolf: true = Lone Wolf (no partner, 2x stake)' },
        wolfBlind: { type: 'boolean', description: 'Wolf: true = Blind Wolf (before tee shots, 3x stake)' },
        chaserAmt: { type: 'number', description: 'Wolf/3-Man Wolf: dollar amount to override the stake for this hole (Chaser/Cry Baby)' },
        firstOnGreen: { type: 'string', description: 'BBB: player name who was first on the green (Bingo)' },
        closestToPin: { type: 'string', description: 'BBB: player name closest to the pin (Bango)' },
        firstIn: { type: 'string', description: 'BBB: player name who holed out first (Bongo)' },
        snakeBite: { type: 'string', description: 'Snake: player name of the most recent 3-putter (they hold the snake)' },
        banker: { type: 'string', description: 'Banker: player name who is the Banker for this hole' },
        bankerWager: { type: 'number', description: 'Banker: agreed wager $ for this hole' },
        bankerMultiplier: { type: 'number', description: 'Banker: press multiplier (1, 2, 3, 4, etc.)' },
        scotchProx: { type: 'string', description: 'Scotch: player name closest to pin (earns the Prox point)' },
        scotchStakeOverride: { type: 'number', description: 'Scotch: override $/pt for this hole onward' }
      },
      required: ['hole']
    }
  },
  {
    name: 'log_hammer',
    description: 'Record hammer throws for a Wolf, 3-Man Wolf, or Coin Flip Wolf hole. Hammers must alternate sides; a decline ends the chain immediately (thrower wins). Use append to add a single throw in real time, or entries to set the full log for a hole.',
    input_schema: {
      type: 'object',
      properties: {
        hole: { type: 'number' },
        append: {
          type: 'object',
          description: 'Add one hammer throw to the existing log',
          properties: {
            side: { type: 'string', enum: ['wolf','opp'], description: '"wolf" = wolf side threw; "opp" = opponents threw' },
            accepted: { type: 'boolean', description: 'true = receiving side accepted (stake doubles); false = receiving side declined (thrower wins immediately)' }
          },
          required: ['side', 'accepted']
        },
        entries: {
          type: 'array',
          description: 'Replace the entire hammer log for this hole',
          items: {
            type: 'object',
            properties: {
              side: { type: 'string', enum: ['wolf','opp'] },
              accepted: { type: 'boolean' }
            },
            required: ['side', 'accepted']
          }
        }
      },
      required: ['hole']
    }
  },
  {
    name: 'set_cfw_flip',
    description: 'Set a player\'s coin flip result (H or T) for a specific hole in Coin Flip Wolf.',
    input_schema: {
      type: 'object',
      properties: {
        hole: { type: 'number' },
        playerName: { type: 'string' },
        flip: { type: 'string', enum: ['H','T'], description: 'H = Heads, T = Tails' }
      },
      required: ['hole', 'playerName', 'flip']
    }
  },
  {
    name: 'add_nassau_press',
    description: 'Add a manual Nassau press starting on a specific hole. The press is a new side bet from that hole to 18.',
    input_schema: {
      type: 'object',
      properties: {
        startHole: { type: 'number', description: 'Hole number the press starts on' },
        stake: { type: 'number', description: 'Dollar amount for the press bet (defaults to the Nassau front/back bet amount)' }
      },
      required: ['startHole']
    }
  },

  // ── Ryder Cup / Event setup ─────────────────────────────────────────────────
  {
    name: 'set_ryder_cup_teams',
    description: 'Set Ryder Cup teams: name each team and assign players.',
    input_schema: {
      type: 'object',
      properties: {
        teamAName: { type: 'string' },
        teamBName: { type: 'string' },
        teamA: { type: 'array', items: { type: 'string' } },
        teamB: { type: 'array', items: { type: 'string' } }
      },
      required: ['teamAName', 'teamBName', 'teamA', 'teamB']
    }
  },
  {
    name: 'assign_player_to_group',
    description: 'Assign a player to a group for an event day.',
    input_schema: {
      type: 'object',
      properties: {
        playerName: { type: 'string' },
        groupNum: { type: 'number' },
        dayIndex: { type: 'number', description: '0-based. Defaults to 0.' }
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
        groupNum: { type: 'number' },
        format: { type: 'string', description: '"Four-Ball", "Foursomes", or "Singles"' },
        dayIndex: { type: 'number' }
      },
      required: ['groupNum', 'format']
    }
  },
  {
    name: 'set_singles_pairing',
    description: 'Set Singles match pairings within a group for an event day.',
    input_schema: {
      type: 'object',
      properties: {
        groupNum: { type: 'number' },
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              playerA: { type: 'string' },
              playerB: { type: 'string' }
            },
            required: ['playerA', 'playerB']
          }
        },
        dayIndex: { type: 'number' }
      },
      required: ['groupNum', 'pairs']
    }
  },
  {
    name: 'configure_event_day',
    description: 'Configure an event day: course, tee, day format, point value, points scope, number of groups.',
    input_schema: {
      type: 'object',
      properties: {
        dayIndex: { type: 'number' },
        courseIdx: { type: 'number' },
        tee: { type: 'string' },
        dayFormat: { type: 'string', description: '"match", "teamStroke", "scramble", "shamble", "bestBall", "par3Birdie"' },
        pointValue: { type: 'number' },
        pointsScope: { type: 'string', enum: ['perMatch','perDay'] },
        numGroups: { type: 'number' }
      },
      required: ['dayIndex']
    }
  },
  {
    name: 'mark_day_complete',
    description: 'Mark an event day as scoring-complete. Day index is 0-based.',
    input_schema: { type: 'object', properties: { dayIndex: { type: 'number' } }, required: ['dayIndex'] }
  },

  // ── Round control ───────────────────────────────────────────────────────────
  {
    name: 'lock_and_start',
    description: 'Lock the round and start play. Only call after fully configured.',
    input_schema: { type: 'object', properties: {} }
  },

  // ── Scoring & leaderboard ───────────────────────────────────────────────────
  {
    name: 'get_leaderboard',
    description: 'Get current leaderboard, scores, and money standings for the active round.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_scorecard',
    description: 'Get the FULL scorecard: every player\'s gross and net score per hole, all per-hole game events (wolf assignment, partner, blind/alone, hammer log, banker, BBB, coin flips, snake, Chaser $ etc.), and the exact per-hole dollar delta for every side game — computed by the live game engines. Use this to answer ANY question about how money was calculated, why a player won/lost a specific amount on a specific hole, or to verify a game outcome.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'enter_score',
    description: 'Enter a gross score for a player on a specific hole.',
    input_schema: {
      type: 'object',
      properties: {
        playerName: { type: 'string' },
        hole: { type: 'number' },
        score: { type: 'number', description: 'Gross strokes' }
      },
      required: ['playerName', 'hole', 'score']
    }
  },

  // ── Buddies ─────────────────────────────────────────────────────────────────
  {
    name: 'add_buddy',
    description: 'Add a new player to the Golf Buddies list (saved to the user\'s account in Firestore).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        hi: { type: 'string', description: 'Handicap index' },
        ghin: { type: 'string', description: 'GHIN number' }
      },
      required: ['name']
    }
  },
  {
    name: 'delete_buddy',
    description: 'Remove a player from the Golf Buddies list permanently.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },

  // ── Overlays & accounts ─────────────────────────────────────────────────────
  {
    name: 'open_account',
    description: 'Open My Account overlay (profile, GHIN, HI, password, round history).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'open_season_ledger',
    description: 'Open Season Money Ledger (net standings + per-round breakdown).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'open_settle_up',
    description: 'Open the Settle Up overlay showing exactly who owes whom to clear debts from this round.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'set_venmo_handle',
    description: 'Set a player\'s Venmo handle for the Settle Up overlay.',
    input_schema: {
      type: 'object',
      properties: {
        playerName: { type: 'string' },
        handle: { type: 'string', description: 'Venmo handle, e.g. "@jason-inmon"' }
      },
      required: ['playerName', 'handle']
    }
  },

  // ── Feedback ────────────────────────────────────────────────────────────────
  {
    name: 'submit_feedback',
    description: 'Submit feedback (bug, feature, UX, general). Always confirm the message with the player first.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['bug','feature','ux','general'] },
        message: { type: 'string' }
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

    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
      return res.status(200).json({
        tool_calls: toolUseBlocks.map(b => ({ id: b.id, name: b.name, input: b.input }))
      });
    }

    const textBlock = data.content.find(b => b.type === 'text');
    return res.status(200).json({ reply: textBlock ? textBlock.text : 'Done.' });

  } catch (err) {
    console.error('Caddie handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function buildSystemPrompt(ctx) {
  let prompt = `You are Caddie, SidieGolf's AI game manager. You control the app directly — every tool call updates the UI in real time. You have COMPLETE knowledge of every game rule, every calculation, and every dollar of every game. You can do EVERYTHING a human can do in the app.

━━ ROUND TYPES ━━
• "stroke" — any stroke-based round (gross, net, stableford, wolf, nassau, skins all use this)
• "match"  — match play (singles, four-ball, foursomes)
• "event"  — tournament, golf trip, multi-day, multi-group

━━ SCORING METHODS ━━
stroke: "Stroke Play (Gross)" | "Net Stroke Play" | "Stableford" | "Modified Stableford"
match:  "Singles Match Play" | "Four-Ball (Better Ball)" | "Foursomes (Alternate Shot)"
event:  "Stroke Play" | "Stableford" | "Modified Stableford" | "Match Play" | "Ryder Cup Format"
Wolf/Nassau/Skins/Scotch/Banker = SIDE GAMES added at step 5, never scoring methods.

━━ STEP ORDER ━━
1. set_round_type → navigate_to_step(1)
2. navigate_to_step(2)  ⚠ STOP if stroke play without Gross/Net — ask first
3. navigate_to_step(3) → search_course → set_course  [optionally set_date]
4. navigate_to_step(4) → search_buddies + add_player for each
5. navigate_to_step(5) → add_side_game(s)
6. navigate_to_step(6) only when player explicitly says "lock" or "start"

━━ HANDICAP MATH ━━
• Course Handicap = HI × (Slope ÷ 113), rounded to nearest integer
• All players in a group receive strokes relative to each other — the lowest CH player gets 0 strokes; everyone else gets (their CH − lowest CH) strokes
• Strokes allocated to holes in stroke-index order: SI 1 = hardest hole, gets strokes first
• Net score = Gross − strokes received on that hole
• get_scorecard returns computed net scores and strokes per hole per player

━━ COMPLETE GAME RULES ━━

── WOLF ($X per man, 3–5 players) ──
• Each hole: one player is Wolf (rotates by tee order — hole 1=P1, hole 2=P2, etc., cycling)
• Wolf sees all tee shots, then picks a Partner OR goes Lone Wolf (solo)
• PARTNER WOLF: Wolf+Partner vs. rest. Net best-ball wins.
  Wolf side wins → each opponent pays $X per man to wolf side; lose → each wolf-side player pays $X to each opponent
• LONE WOLF: Wolf declared alone. Stake DOUBLES to 2×X per man. Wolf vs everyone.
• BLIND WOLF: Declared BEFORE any tee shot (including wolf's own). Stake TRIPLES to 3×X. Wolf plays solo.
• NET scores decide the winner (best-ball from each side, using handicap strokes)
• HAMMERS (if on): either side throws a hammer to double current stake. Receiving side: accept (doubles again) or decline (thrower wins immediately at current X — no play outcome matters). Sides must alternate — same side can't throw twice in a row. Wolf side holds hammer first if solo.
• CARRY RULE (optional): on a tie/push, stake doubles for next hole (limited by carry max cap)
• BIRDIE/EAGLE BONUS: winning side's best score is a birdie → ×2 the hole's stake; eagle → ×3 or ×4 (set at setup)
• CHASER $/CRY BABY: per-hole dollar amount entered in the "Chaser $" row overrides the base stake for that hole entirely
• 5-player: asymmetric payouts handled by engine (2v3 and 1v4)

── 3-MAN WOLF (exactly 3 players) ──
• Always 1 wolf vs 2 opponents — no partner picking, always 2v1
• Wolf rotates by 6-hole segments (per tee order set at setup): P1=holes 1–6, P2=holes 7–12, P3=holes 13–18
• Same $X per man. Wolf wins → each opponent pays wolf $X; wolf loses → wolf pays $X to each opponent
• Hammers and Chaser $ work identically

── COIN FLIP WOLF (4–5 players) ──
• Each hole every player flips H or T. Same flip = partners, opposite = opponents
• Smaller side is "wolf" — holds hammer first
• Ghost Partner: if solo and no hammer thrown, solo's score = min(own net, par)
• Everyone-For-Themselves: all flipped the same → bet doubles, open hammer, low net wins outright

── NASSAU ──
• Three independent bets settled separately: Front 9 ($F), Back 9 ($B), Total 18 ($T)
• Match play scoring: who wins more holes (net) on each 9
• Hole won = lower net score; tied holes are halved (½ pt each)
• CARRY TIES: if Front 9 is tied going to the back, Front bet amount carries to Back (Back bet doubles)
• AUTO-PRESS: when team is down by configured holes, a new press starts automatically
• MANUAL PRESS: team calls press on any hole; each press is a separate side match to 18. Players can tap the per-hole press button on the scorecard OR ask Caddie.
• add_nassau_press(startHole, stake) — use this to record a manual press when called verbally during play
• Each press shows up in the scorecard event table as its own row; the net stroke display on the leaderboard reflects active presses

── SKINS ($X per skin) ──
• Each hole is a skin. Lowest net (or gross) score wins the skin
• Tie: if carryover=Yes, skin accumulates to next hole; if No, skin is void
• Skin winner collects $X × number of accumulated skins from each other player's ante

── SCOTCH (exactly 4 players, 6 points/hole) ──
• Two 2-player teams: Fixed Partners, Sixes (rotate every 6 holes by HCP rank), High/Low HCP (A+D vs B+C), or Captain's Draft
• Per hole, 6 points available:
  2 pts — Low Net: team with lower best individual net wins; tie = 1pt each
  2 pts — Team Net Total: team with lower combined net wins; tie = 1pt each
  1 pt  — Prox: manual assignment in the event table (closest to pin)
  1 pt  — Gross Birdie: any team member makes gross birdie; both teams make birdie = 0.5pt each
• Umbrella (optional): one team sweeps all 6 → doubles to 12 points
• Crack (optional): down team can "crack" (like a hammer) to double the $/pt; teams alternate; decline ends chain
• Sixes rotation (by HCP rank A=lowest, B, C, D=highest): 1–6: A+B vs C+D; 7–12: A+C vs B+D; 13–18: A+D vs B+C
• Payout: each player wins (own team pts − opp team pts) × $/pt for that hole

── BANKER ──
• One player per hole is the Banker (assigned in event table or auto-rotates to previous hole's lowest net scorer)
• Banker plays 1v1 against EVERY other player for a per-hole wager
• Default wager = minBet set at setup; can override per-hole in event table
• PRESS/MULTIPLIER: any player presses before hole → ×2 (×3 on par 3); Banker counter-doubles → ×2 again
• Net score wins each 1v1 matchup
• BIRDIE BONUS (default on): if EITHER player in a matchup makes gross birdie → that matchup's payout doubles
• BOGEY RULE (optional): Banker makes gross bogey or worse → Banker auto-loses ALL matchups that hole
• Ties: Push (no money) or Banker Wins (banker collects)

── 9 POINT (exactly 3 players) ──
• Each hole: 9 points split by net score — low=5, mid=3, high=1
• Tied spots split combined point values: two tie low → 4/4/1; two tie high → 5/2/2; three-way tie → 3/3/3
• 2-STROKE SWEEP: if outright low net beats SECOND-best by ≥2 strokes → low takes all 9 (others get 0)
• BIRDIES DOUBLE (optional): best gross on hole = birdie → all points ×2; eagle → ×3
• Payout per hole: each player wins (own pts − 3) × $/pt [3 = average of 9÷3 players]
• CRY BABY (9 Point only, different from Wolf): closing holes (16–18 or 17–18), trailing player names a higher $/pt rate. Still configured at setup as a stake option — NOT the same as Wolf's per-hole Chaser $.

── BINGO BANGO BONGO ($X per point) ──
• 3 points per hole, manually assigned in the event table:
  Bingo: first ball to reach the green
  Bango: closest to the pin once all balls are on the green
  Bongo: first to hole out
• Payout: each player wins (own total points − average points) × $X (zero-sum)

── SNAKE ($X total, any # players) ──
• The last player to 3-putt holds the snake
• At end of round: snake holder owes $X to every other player
• Only ONE snake — whoever most recently 3-putted holds it going into the next hole

── VEGAS (exactly 2v2 teams) ──
• Each hole: each team's score = concatenate lower+higher net digit (e.g. nets 4 and 5 → "45")
• If EITHER player on a team scores double-bogey or worse → digits FLIP (higher first, e.g. "45"→"54" — penalty)
• Lower Vegas number wins; winning team receives the DIFFERENCE × $/unit
• Example: Team A=43, Team B=47 → diff=4 → Team A wins $4/unit from each opponent

━━ HOW TO ANSWER MONEY QUESTIONS ━━
When asked "why did I lose $20" or "how was hole 7 calculated" or "show me the breakdown":
1. Call get_scorecard → returns every player's gross/net per hole AND exact per-hole dollar deltas per game
2. Find the hole in question. Check "events" for Wolf assignment/partner/blind, hammer log, banker, BBB picks, etc.
3. Look at the game's "perHole" array → find that hole's delta (positive=won, negative=lost)
4. Explain step by step using the rules above: who was wolf, was it blind/lone, any hammers, net scores, who beat whom

━━ CRY BABY CLARIFICATION ━━
• Wolf/3-Man Wolf "Chaser $": per-hole $ entered in the Wolf event table's "Chaser $" row. Overrides the base stake for that hole. Use set_hole_event(hole, chaserAmt=X). No setup field.
• 9 Point "Cry Baby": a setup stake option (cryBaby, cryBabyStartHole, cryBabyPerPoint). Closing-hole $/pt rate named by the trailing player. These ARE configured at game setup.

━━ PLAYER SLOTS ━━
App pre-allocates "Player 1", "Player 2", etc. add_player fills the first empty slot.
- Told "4 players" before names → set_player_count(4)
- Change HI/name/tee after adding → update_player

━━ SET_ROUND_TYPE RULES ━━
- Call exactly ONCE per setup at the very beginning
- Never re-call it to fix player count or other issues

━━ NATURAL LANGUAGE ━━
Accept info in any order. "Wolf at Barton Creek with Dave and Tim, $5/man hammers on" → parse all, execute in step order. Never execute out of order.

━━ QR CODE JOIN & SCOREKEEPER ━━
Networked rounds have a 6-letter Join Code. Tapping the code on step 4 (Who's Playing), step 5 (lobby), or the Event Hub shows a QR overlay encoding https://sidiegolf.com/?join=ROUNDCODE.

When someone scans the QR (or follows a share link):
• Not signed in → "Watch Live" or "Keep Score" choice overlay appears
  - Watch Live: anonymous sign-in → leaderboard view only
  - Keep Score: sign-in modal → after login, automatically joins as scorekeeper
• Already signed in → auto-joins the round

SCOREKEEPER: a player who claims a tee-time group to enter scores on behalf of that group. They see the same scorecard as the manager for their group. Scorekeepers are assigned per tee-time group — each group can have one active scorekeeper.

━━ ACCOUNTS & OVERLAYS ━━
- open_account → My Account (name/GHIN/HI, history)
- open_season_ledger → Season Money Ledger
- open_settle_up → Settle Up (who owes whom this round)
- set_venmo_handle → set Venmo handle for a player

━━ BUDDIES ━━
- search_buddies → find existing buddies
- add_buddy → create new buddy in Golf Buddies
- delete_buddy → remove buddy permanently

━━ FEEDBACK ━━
- submit_feedback → always confirm message text with player first

━━ GENERAL RULES ━━
- Always search_buddies before add_player (accurate HI/GHIN)
- Always search_course before set_course
- Never claim done unless tool returned success
- Be concise — 1 sentence per confirmation, one question at a time
- Use golf lingo`;

  if (ctx) {
    prompt += '\n\n--- Current App State ---\n';
    if (ctx.step)         prompt += `Step: ${ctx.step}\n`;
    if (ctx.roundType)    prompt += `Round type: ${ctx.roundType}\n`;
    if (ctx.scoringMethod) prompt += `Scoring: ${ctx.scoringMethod}\n`;
    if (ctx.course)       prompt += `Course: ${ctx.course.name} (idx ${ctx.course.idx}), tees: ${ctx.course.tees.join(', ')}\n`;
    if (ctx.date)         prompt += `Date: ${ctx.date}\n`;
    if (ctx.totalSlots)   prompt += `Player slots: ${ctx.totalSlots} total\n`;
    if (ctx.players && ctx.players.length) {
      prompt += `Real players (${ctx.players.length}): ` + ctx.players.map(p => `${p.name} HI:${p.hi}`).join(', ') + '\n';
    } else if (ctx.totalSlots) {
      prompt += `Real players: 0 (all empty placeholders)\n`;
    }
    if (ctx.teams)        prompt += `Teams — A: ${ctx.teams.A}, B: ${ctx.teams.B}\n`;
    if (ctx.sideGames && ctx.sideGames.length) {
      prompt += `Side games: ` + ctx.sideGames.map(g => g.type + (g.stakes && g.stakes.amount ? ' $'+g.stakes.amount : '')).join(', ') + '\n';
    }
    if (ctx.days && ctx.days.length) prompt += `Event days: ${ctx.days.length}\n`;
    if (ctx.scores)       prompt += `Scores so far: ${ctx.scores}\n`;
    if (ctx.money)        prompt += `Money standings: ${ctx.money}\n`;
    if (ctx.leaderboard)  prompt += `Leaderboard: ${ctx.leaderboard}\n`;
  }

  return prompt;
}
