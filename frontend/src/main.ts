import * as api from './api';
import type { GameStateResponse } from './api';
import { drawMap, canvasToTile, kingdomColor, heroIcon, featureIcon } from './mapView';
import {
  getActiveSession,
  saveSession,
  listSessions,
  setActiveGameId,
  saveCreatedGame,
  listCreatedGames,
  getLastSeenRound,
  setLastSeenRound,
  type SavedSession,
  type CreatedGame,
} from './storage';

const app = document.getElementById('app')!;

let session: SavedSession | null = null;
let state: GameStateResponse | null = null;
let selectedTile: { x: number; y: number } | null = null;
let hoveredTile: { x: number; y: number } | null = null;
let moveMode = false;
let activeQuestName: string | null = null;
let lastQuestMessage: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let prevSnapshot: { treasury: number; heroHp: number } | null = null;

init();

function init() {
  const params = new URLSearchParams(location.search);
  const gameId = params.get('game');
  const token = params.get('token');
  const name = params.get('name');
  if (gameId && token) {
    saveSession({ gameId, token, playerName: name ?? 'Player', gameName: '' });
    history.replaceState({}, '', location.pathname);
  }
  session = getActiveSession() ?? null;
  if (session) startGame();
  else renderSetup();
}

function setError(msg: string | null) {
  const el = document.getElementById('so-error');
  if (el) el.textContent = msg ?? '';
}

async function withErrorHandling(fn: () => Promise<void>) {
  try {
    await fn();
    setError(null);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------

function renderSetup() {
  if (refreshTimer) clearInterval(refreshTimer);
  const saved = listSessions();
  const created: CreatedGame[] = listCreatedGames();
  app.innerHTML = `
    <div class="wrap">
      <h1>⚜ Standing Orders</h1>
      <p class="sub">An async kingdom game for friends — indirect orders for your workers, direct command of your Hero.</p>
      <div id="so-error" class="error"></div>

      ${
        saved.length > 0
          ? `<section class="card">
              <h2>Resume a game</h2>
              <ul class="session-list">
                ${saved.map((s) => `<li><button data-game="${s.gameId}" class="resume-btn">${escapeHtml(s.playerName)} — ${escapeHtml(s.gameId)}</button></li>`).join('')}
              </ul>
            </section>`
          : ''
      }

      ${
        created.length > 0
          ? `<section class="card">
              <h2>Games you created</h2>
              <p class="hint">Get back the invite links to send (or re-send) to friends.</p>
              <ul class="session-list">
                ${created.map((g) => `<li><button data-game="${g.gameId}" class="view-links-btn">${escapeHtml(g.gameName)} — ${g.players.length} players</button></li>`).join('')}
              </ul>
            </section>`
          : ''
      }

      <section class="card">
        <h2>Create a new game</h2>
        <label>Site passphrase <input id="new-game-password" type="password" value="${escapeHtml(api.sitePassword())}" /></label>
        <p class="hint">Ask whoever set up this Worker for the passphrase — it's a spam gate, not a per-player login.</p>
        <label>Game name <input id="new-game-name" value="Our Realm" /></label>
        <label>Round timeout (hours) <input id="new-game-timeout" type="number" value="48" min="24" max="168" /></label>
        <div id="player-rows"></div>
        <button id="add-player-btn">+ Add player</button>
        <button id="create-game-btn" class="primary">Create game</button>
      </section>

      <section class="card">
        <h2>API server</h2>
        <label>Worker base URL <input id="api-base" value="${api.apiBaseUrl()}" /></label>
        <button id="save-api-base-btn">Save</button>
        <p class="hint">Points at the deployed Worker by default. Override for local dev only.</p>
      </section>
    </div>
  `;

  const playerRows = document.getElementById('player-rows')!;
  const addPlayerRow = (defaultName: string) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `<input class="player-name" placeholder="Player name" value="${escapeHtml(defaultName)}" />
      <input class="player-webhook" placeholder="Discord webhook URL (optional)" />`;
    playerRows.appendChild(row);
  };
  addPlayerRow('Player 1');
  addPlayerRow('Player 2');

  document.getElementById('add-player-btn')!.addEventListener('click', () => {
    if (playerRows.children.length >= 4) return;
    addPlayerRow(`Player ${playerRows.children.length + 1}`);
  });

  document.querySelectorAll<HTMLButtonElement>('.resume-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveGameId(btn.dataset.game!);
      session = getActiveSession() ?? null;
      if (session) startGame();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.view-links-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = created.find((c) => c.gameId === btn.dataset.game);
      if (g) renderCreatedGame({ gameId: g.gameId, players: g.players }, g.gameName);
    });
  });

  document.getElementById('save-api-base-btn')!.addEventListener('click', () => {
    const val = (document.getElementById('api-base') as HTMLInputElement).value.trim();
    if (val) api.setApiBaseUrl(val);
  });

  document.getElementById('create-game-btn')!.addEventListener('click', () =>
    withErrorHandling(async () => {
      const passwordInput = document.getElementById('new-game-password') as HTMLInputElement;
      const password = passwordInput.value.trim();
      if (!password) throw new Error('site passphrase is required');
      api.setSitePassword(password);

      const name = (document.getElementById('new-game-name') as HTMLInputElement).value.trim();
      const timeout = Number((document.getElementById('new-game-timeout') as HTMLInputElement).value) || 48;
      const players = Array.from(playerRows.querySelectorAll('.player-row')).map((row) => {
        const pname = (row.querySelector('.player-name') as HTMLInputElement).value.trim();
        const webhook = (row.querySelector('.player-webhook') as HTMLInputElement).value.trim();
        return { name: pname, discordWebhookUrl: webhook || undefined };
      });
      if (players.some((p) => !p.name)) throw new Error('every player needs a name');

      try {
        const result = await api.createGame(name, players, timeout);
        renderCreatedGame(result, name);
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 401) {
          api.clearSitePassword();
          passwordInput.value = '';
          throw new Error('wrong site passphrase — try again');
        }
        throw e;
      }
    })
  );
}

function renderCreatedGame(result: api.CreateGameResponse, gameName: string) {
  saveCreatedGame({ gameId: result.gameId, gameName, createdAt: Date.now(), players: result.players });

  const base = `${location.origin}${location.pathname}`;
  app.innerHTML = `
    <div class="wrap">
      <button id="back-to-setup-btn" class="link-back">← Back</button>
      <h1>${escapeHtml(gameName)} is ready</h1>
      <p>Send each player their own link below (Discord DM, whatever). Opening the link logs that player in on their device. These links don't expire — come back here any time from "Games you created" on the home screen to grab them again.</p>
      <ul class="join-links">
        ${result.players
          .map(
            (p) =>
              `<li><strong>${escapeHtml(p.name)}</strong><br/><code class="join-url">${base}?game=${result.gameId}&token=${p.token}&name=${encodeURIComponent(p.name)}</code>
               <button data-token="${p.token}" data-name="${escapeHtml(p.name)}" class="be-this-player">This is me →</button></li>`
          )
          .join('')}
      </ul>
    </div>
  `;
  document.getElementById('back-to-setup-btn')!.addEventListener('click', () => renderSetup());
  document.querySelectorAll<HTMLButtonElement>('.be-this-player').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveSession({ gameId: result.gameId, token: btn.dataset.token!, playerName: btn.dataset.name!, gameName });
      session = getActiveSession() ?? null;
      if (session) startGame();
    });
  });
}

// ---------------------------------------------------------------------------
// Game screen
// ---------------------------------------------------------------------------

function startGame() {
  refresh();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, 10_000);
}

async function refresh() {
  if (!session) return;
  await withErrorHandling(async () => {
    const prevMine = state?.kingdoms.find((k) => k.isMine);
    if (prevMine) prevSnapshot = { treasury: prevMine.treasury ?? 0, heroHp: prevMine.hero?.hp ?? 0 };

    state = await api.getState(session!.gameId, session!.token);
    const mine = state.kingdoms.find((k) => k.isMine);
    if (mine?.hero && mine.hero.state !== 'InDungeon') {
      activeQuestName = null;
      lastQuestMessage = null;
    }
    renderGame();
  });
}

// --- event categorization, used by both the digest and the running log ---

type EventCat = 'bad' | 'good' | 'hero' | 'legend' | 'neutral';

function eventMeta(type: string): { icon: string; cat: EventCat } {
  switch (type) {
    case 'worker_died':
      return { icon: '💀', cat: 'bad' };
    case 'kingdom_attacked':
      return { icon: '⚠️', cat: 'bad' };
    case 'hero_defeated':
      return { icon: '🩸', cat: 'bad' };
    case 'bounty_completed':
      return { icon: '💰', cat: 'good' };
    case 'building_completed':
      return { icon: '🏗️', cat: 'good' };
    case 'worker_claimed_bounty':
      return { icon: '📜', cat: 'neutral' };
    case 'hero_returned':
      return { icon: '🏆', cat: 'hero' };
    case 'hero_recovered':
      return { icon: '💫', cat: 'hero' };
    case 'dragon_slain':
      return { icon: '🐉', cat: 'legend' };
    case 'round_resolved':
      return { icon: '🕰️', cat: 'neutral' };
    case 'waiting_on_you':
      return { icon: '⏳', cat: 'neutral' };
    default:
      return { icon: '•', cat: 'neutral' };
  }
}

function renderDigest(s: GameStateResponse): string {
  const lastSeen = getLastSeenRound(s.game.id);
  const baseline = lastSeen ?? s.game.roundNumber;
  const storyworthy = s.events.filter((e) => e.round_number > baseline && e.type !== 'round_resolved' && e.type !== 'waiting_on_you');
  setLastSeenRound(s.game.id, s.game.roundNumber);

  if (storyworthy.length === 0) return '';

  const items = storyworthy.slice(-8);
  return `
    <div class="digest">
      <h2>While you were away</h2>
      ${items
        .map((e) => {
          const meta = eventMeta(e.type);
          return `<div class="digest-item cat-${meta.cat}">
            <span class="digest-icon">${meta.icon}</span>
            <span class="digest-text"><span class="digest-round">R${e.round_number}</span>${escapeHtml(e.message)}</span>
          </div>`;
        })
        .join('')}
    </div>
  `;
}

function renderGame() {
  if (!state || !session) return;
  const s = state;
  const mine = s.kingdoms.find((k) => k.isMine)!;
  const waitingOn = s.players.filter((p) => !p.confirmed).map((p) => p.name);
  const myPlayer = s.players.find((p) => p.isMe);
  const digestHtml = renderDigest(s);

  const treasuryFlash =
    prevSnapshot && prevSnapshot.treasury !== mine.treasury ? (mine.treasury! > prevSnapshot.treasury ? 'flash-up' : 'flash-down') : '';
  const heroHpFlash =
    prevSnapshot && mine.hero && prevSnapshot.heroHp !== mine.hero.hp ? (mine.hero.hp > prevSnapshot.heroHp ? 'flash-up' : 'flash-down') : '';

  app.innerHTML = `
    <div class="game-wrap">
      <div class="round-banner">
        <div class="round-num">${s.game.roundNumber}<small>Round</small></div>
        <div class="round-mid">
          <div class="gate-status ${waitingOn.length === 0 ? 'gate-ready' : ''}">
            ${waitingOn.length === 0 ? '✓ Everyone has confirmed — resolving shortly.' : `Waiting on: ${waitingOn.map(escapeHtml).join(', ')}`}
          </div>
          <div class="player-chips">
            ${s.players
              .map(
                (p) =>
                  `<span class="player-chip ${p.confirmed ? 'ready' : 'pending'} ${p.isMe ? 'me' : ''}">${p.confirmed ? '✓' : '⏳'} ${escapeHtml(p.name)}</span>`
              )
              .join('')}
          </div>
        </div>
        <div class="round-cta">
          <button id="confirm-btn" class="confirm-cta" ${myPlayer?.confirmed ? 'disabled' : ''}>
            ${myPlayer?.confirmed ? '✓ Orders confirmed' : 'Confirm standing orders'}
          </button>
          <div class="deadline-note">Standing orders carry over — nothing is lost if you go quiet.</div>
        </div>
      </div>

      <div id="so-error" class="error"></div>
      ${digestHtml}

      <div class="game-main">
        <div class="map-col">
          <div class="map-frame">
            <h2>The Realm</h2>
            <canvas id="map-canvas"></canvas>
            ${moveMode ? `<div class="map-mode-banner">🧭 Click a tile to send ${escapeHtml(mine.hero?.name ?? 'your Hero')} there. <button id="cancel-move-mode-btn">Cancel</button></div>` : ''}
            <div class="legend-v2">
              ${s.kingdoms.map((k, i) => `<span class="legend-item"><span class="swatch" style="background:${kingdomColor(i)}"></span>${escapeHtml(k.playerName)}${k.isMine ? ' (you)' : ''}</span>`).join('')}
              <span class="legend-item">🐉 dragon's lair</span>
              <span class="legend-item">⛺ monster camp</span>
              <span class="legend-item">🏚️ ruin</span>
              <span class="legend-item">💀 threat</span>
            </div>
            <div class="scoreboard">
              ${[...s.kingdoms]
                .sort((a, b) => b.score - a.score)
                .map(
                  (k, rank) =>
                    `<div class="score-row ${k.isMine ? 'mine' : ''}"><span class="score-rank">${rank + 1}</span>${escapeHtml(k.playerName)}${k.isMine ? ' (you)' : ''}<span class="score-val">${k.score}</span></div>`
                )
                .join('')}
            </div>
          </div>
          <div id="tile-panel"></div>
        </div>

        <div class="side-col">
          <section class="card panel-indirect">
            <span class="panel-tag">Indirect · you influence, they decide</span>
            <h2>Your Kingdom</h2>
            <div class="stat-row">Treasury <span class="stat-val ${treasuryFlash}" id="treasury-val">${mine.treasury} gold</span></div>
            <label>Tax rate: <input id="tax-rate" type="range" min="0" max="100" value="${mine.taxRate}" /> <span id="tax-rate-val">${mine.taxRate}%</span></label>
            <button id="apply-tax-btn">Set tax rate</button>
            <label>Alert level:
              <select id="alert-level">
                ${['Passive', 'Normal', 'Aggressive'].map((lvl) => `<option value="${lvl}" ${mine.alertLevel === lvl ? 'selected' : ''}>${lvl}</option>`).join('')}
              </select>
            </label>
            <button id="apply-alert-btn">Set alert level</button>

            <h3>Buildings</h3>
            <ul class="owned-buildings">
              ${mine.buildings
                .map((b) => {
                  const total = BUILD_ROUNDS[b.type] ?? 1;
                  const pct = b.status === 'building' ? Math.round(100 * (1 - b.build_progress_rounds_left / total)) : 100;
                  return `<li>
                    <span>${buildingIcon(b.type)} ${b.type}${b.level > 1 ? ` lvl ${b.level}` : ''}</span>
                    ${
                      b.status === 'building'
                        ? `<span class="building-progress"><span class="building-progress-fill" style="width:${pct}%"></span></span><span class="hint">${b.build_progress_rounds_left}r left</span>`
                        : ''
                    }
                    ${b.status !== 'active' ? `<button class="cancel-building-btn" data-id="${b.id}">✕</button>` : ''}
                  </li>`;
                })
                .join('') || '<li class="hint">Just the capital, so far.</li>'}
            </ul>
            <div class="building-grid">
              ${['GuildHall', 'RoguesDen', 'WizardsTower', 'Temple', 'Market', 'Walls']
                .map((t) => `<div class="building-tile queue-building-btn" data-type="${t}"><span class="b-icon">${buildingIcon(t)}</span>${buildingLabel(t)}</div>`)
                .join('')}
            </div>

            <h3>Workers (${mine.workers.filter((w) => w.state !== 'Dead').length})</h3>
            <div class="worker-roster">
              ${mine.workers
                .filter((w) => w.state !== 'Dead')
                .map((w) => {
                  const pct = Math.round((w.hp / w.max_hp) * 100);
                  return `<div class="worker-chip state-${w.state.toLowerCase()}">
                    <span class="w-icon">${workerIcon(w.type)}</span>${w.type} L${w.level}
                    <div class="hint">${w.state}</div>
                    <div class="hp-bar"><div class="hp-fill ${pct < 35 ? 'low' : ''}" style="width:${pct}%"></div></div>
                  </div>`;
                })
                .join('') || '<p class="hint">None yet — queue a building to attract some.</p>'}
            </div>
          </section>

          ${renderHeroPanel(mine, s, heroHpFlash)}

          <section class="card">
            <h2>Chronicle</h2>
            <ul class="event-list">
              ${s.events
                .slice(-20)
                .reverse()
                .map((e) => {
                  const meta = eventMeta(e.type);
                  return `<li class="cat-${meta.cat}"><span class="event-round">R${e.round_number}</span>${meta.icon} ${escapeHtml(e.message)}</li>`;
                })
                .join('') || '<li class="hint">Nothing yet.</li>'}
            </ul>
          </section>
        </div>
      </div>
    </div>
  `;

  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  redrawCanvas();
  canvas.classList.toggle('mode-move', moveMode);

  canvas.addEventListener('mousemove', (evt) => {
    const tile = canvasToTile(canvas, evt);
    if (hoveredTile?.x === tile.x && hoveredTile?.y === tile.y) return;
    hoveredTile = tile;
    redrawCanvas();
  });
  canvas.addEventListener('mouseleave', () => {
    hoveredTile = null;
    redrawCanvas();
  });

  canvas.addEventListener('click', (evt) => {
    const tile = canvasToTile(canvas, evt);
    if (moveMode) {
      withErrorHandling(async () => {
        moveMode = false;
        await api.moveHero(session!.gameId, session!.token, mine.hero!.id, tile.x, tile.y);
        await refresh();
      });
      return;
    }
    selectedTile = tile;
    renderGame();
  });

  document.getElementById('cancel-move-mode-btn')?.addEventListener('click', (evt) => {
    evt.stopPropagation();
    moveMode = false;
    renderGame();
  });

  wireHeaderControls();
  wireKingdomControls();
  wireHeroControls(mine);
  renderTilePanel();
}

function redrawCanvas() {
  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement | null;
  if (!canvas || !state) return;
  const mine = state.kingdoms.find((k) => k.isMine);
  drawMap(canvas, state, {
    selectedTile,
    hoveredTile,
    moveMode,
    heroOrigin: moveMode && mine?.hero ? { x: mine.hero.tile_x, y: mine.hero.tile_y } : null,
  });
}

// Mirrors DESIGN.md §15's build-round values (worker/src/constants.ts BUILDING_COSTS) —
// the API only reports rounds *remaining*, not the original total, so this is needed
// purely to render an accurate progress bar. Static balance numbers, safe to duplicate.
const BUILD_ROUNDS: Record<string, number> = { GuildHall: 2, RoguesDen: 2, WizardsTower: 3, Temple: 2, Market: 1, Walls: 2 };

function buildingIcon(type: string): string {
  return { GuildHall: '🏛️', RoguesDen: '🗝️', WizardsTower: '🔮', Temple: '✟', Market: '🛒', Walls: '🧱', Capital: '🏰' }[type] ?? '🏗️';
}

function buildingLabel(type: string): string {
  return { GuildHall: 'Guild Hall', RoguesDen: "Rogues' Den", WizardsTower: "Wizard's Tower", Temple: 'Temple', Market: 'Market', Walls: 'Walls' }[type] ?? type;
}

function workerIcon(type: string): string {
  return heroIcon(type);
}

function renderHeroPanel(mine: api.KingdomPublic, s: GameStateResponse, hpFlash: string) {
  const hero = mine.hero;
  if (!hero) return '';
  const canAct = hero.state === 'AtCapital' || hero.state === 'Exploring';
  const heroTile = s.map.find((t) => t.x === hero.tile_x && t.y === hero.tile_y);
  const canStartQuest = !!(heroTile?.feature && heroTile.feature_state === 'active');
  const hpPct = Math.round((hero.hp / hero.max_hp) * 100);
  const hpClass = hpPct < 30 ? 'critical' : hpPct < 60 ? 'hurt' : '';

  let stateBadge = '';
  if (hero.state === 'Resting') stateBadge = `<span class="hero-state-badge resting">recovering — ${hero.recovery_rounds_left}r left</span>`;
  else if (hero.state === 'InDungeon') stateBadge = `<span class="hero-state-badge dungeon">on a quest</span>`;
  else if (hero.marshal_active) stateBadge = `<span class="hero-state-badge marshal">marshaling nearby workers</span>`;
  else stateBadge = `<span class="hero-state-badge">${hero.state}</span>`;

  return `
    <section class="card panel-direct">
      <span class="panel-tag">Direct · you command this one, personally</span>
      <div class="hero-header">
        <div class="hero-portrait">${heroIcon(hero.class)}</div>
        <div style="flex:1">
          <h2 style="margin-bottom:0">${escapeHtml(hero.name)}</h2>
          <div class="hint">Level ${hero.level} ${hero.class} &middot; attack ${hero.attack}</div>
        </div>
      </div>
      <div class="hero-hp-bar"><div class="hero-hp-fill ${hpClass} ${hpFlash}" style="width:${hpPct}%"></div></div>
      <div class="hint">${hero.hp} / ${hero.max_hp} hp</div>
      ${stateBadge}

      ${
        canAct
          ? `<div class="hero-controls">
              <button id="move-hero-btn" class="hero-action">🧭 Move</button>
              <button id="marshal-toggle-btn" class="hero-action ${hero.marshal_active ? 'marshal-on' : ''}">${hero.marshal_active ? '🛡 Stand down' : '📯 Marshal!'}</button>
              ${canStartQuest ? `<button id="start-quest-btn" class="hero-action">${featureIcon(heroTile!.feature!)} Enter</button>` : ''}
            </div>
            <p class="hint">${moveMode ? 'Click a tile on the map.' : canStartQuest ? "There's something here to investigate." : 'Click Move, then click the map.'}</p>`
          : hero.state === 'InDungeon'
            ? `<div class="quest-combat">
                <div class="quest-title">${activeQuestName ? escapeHtml(activeQuestName) : 'Somewhere dark and dangerous'}</div>
                <div class="quest-log" id="quest-outcome">${lastQuestMessage ? escapeHtml(lastQuestMessage) : 'What will you do?'}</div>
                <button class="quest-action-btn hero-action" data-action="attack">⚔ Attack</button>
                <button class="quest-action-btn hero-action" data-action="use_item">🧪 Use item</button>
                <button class="quest-action-btn hero-action" data-action="flee">🏃 Flee</button>
              </div>`
            : ''
      }
    </section>
  `;
}

function wireHeaderControls() {
  document.getElementById('confirm-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      await api.confirmOrders(session!.gameId, session!.token);
      await refresh();
    })
  );
}

function wireKingdomControls() {
  const taxInput = document.getElementById('tax-rate') as HTMLInputElement | null;
  taxInput?.addEventListener('input', () => {
    document.getElementById('tax-rate-val')!.textContent = `${taxInput.value}%`;
  });
  document.getElementById('apply-tax-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      await api.submitOrders(session!.gameId, session!.token, { taxRate: Number(taxInput!.value) });
      await refresh();
    })
  );
  document.getElementById('apply-alert-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      const val = (document.getElementById('alert-level') as HTMLSelectElement).value as 'Passive' | 'Normal' | 'Aggressive';
      await api.submitOrders(session!.gameId, session!.token, { alertLevel: val });
      await refresh();
    })
  );
  document.querySelectorAll<HTMLButtonElement>('.cancel-building-btn').forEach((btn) => {
    btn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      withErrorHandling(async () => {
        await api.submitOrders(session!.gameId, session!.token, { cancelBuildingIds: [btn.dataset.id!] });
        await refresh();
      });
    });
  });
  document.querySelectorAll<HTMLElement>('.queue-building-btn').forEach((el) => {
    el.addEventListener('click', () =>
      withErrorHandling(async () => {
        await api.submitOrders(session!.gameId, session!.token, { queueBuildings: [{ type: el.dataset.type! }] });
        await refresh();
      })
    );
  });
}

function wireHeroControls(mine: api.KingdomPublic) {
  const hero = mine.hero;
  if (!hero) return;

  document.getElementById('move-hero-btn')?.addEventListener('click', () => {
    moveMode = true;
    selectedTile = null;
    renderGame();
  });

  document.getElementById('marshal-toggle-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      await api.setMarshal(session!.gameId, session!.token, hero.id, !hero.marshal_active);
      await refresh();
    })
  );

  document.getElementById('start-quest-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      const result = await api.startQuest(session!.gameId, session!.token, hero.id);
      activeQuestName = result.script.name;
      lastQuestMessage = null;
      await refresh();
    })
  );

  document.querySelectorAll<HTMLButtonElement>('.quest-action-btn').forEach((btn) => {
    btn.addEventListener('click', () =>
      withErrorHandling(async () => {
        const action = btn.dataset.action as 'attack' | 'use_item' | 'flee';
        const result = await api.stepQuest(session!.gameId, session!.token, hero.id, action);
        lastQuestMessage = result.outcome.message;
        if (result.outcome.status !== 'active') activeQuestName = null;
        await refresh();
      })
    );
  });
}

function renderTilePanel() {
  const panel = document.getElementById('tile-panel');
  if (!panel || !state) return;
  if (!selectedTile) {
    panel.innerHTML = '';
    return;
  }
  const tile = state.map.find((t) => t.x === selectedTile!.x && t.y === selectedTile!.y);
  if (!tile || tile.state === 'unseen') {
    panel.innerHTML = `<div class="card decree-panel"><p class="hint">(${selectedTile.x}, ${selectedTile.y}) — unexplored. Send your Hero or a worker's bounty out that way first.</p></div>`;
    return;
  }
  const dangerPct = Math.min(100, tile.danger_level ?? 0);
  panel.innerHTML = `
    <div class="card decree-panel">
      <div class="tile-summary">
        <span class="t-icon">${tile.feature ? featureIcon(tile.feature) : terrainIcon(tile.terrain)}</span>
        <div>
          <strong>${capitalize(tile.terrain ?? 'unknown')}${tile.feature ? ` &middot; ${capitalize(tile.feature)}${tile.feature_state === 'cleared' ? ' (cleared)' : ''}` : ''}</strong>
          <div class="hint">Danger <span class="danger-meter"><span class="danger-meter-fill" style="width:${dangerPct}%"></span></span></div>
        </div>
      </div>
      <h3>Post a decree</h3>
      <p class="decree-flavor">Offer gold for this task. Any capable worker — yours, or a rival's — may answer the call. You aren't sending anyone; you're making it worth someone's while.</p>
      <label>Task
        <select id="bounty-type">
          <option>Explore</option><option>Kill</option><option>Gather</option><option>Guard</option>
        </select>
      </label>
      <label>Reward <input id="bounty-reward" type="number" min="1" value="20" /> gold</label>
      <button id="post-bounty-btn" class="hero-action">📜 Post decree</button>
    </div>
  `;
  document.getElementById('post-bounty-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      const type = (document.getElementById('bounty-type') as HTMLSelectElement).value;
      const reward = Number((document.getElementById('bounty-reward') as HTMLInputElement).value);
      await api.submitOrders(session!.gameId, session!.token, {
        postBounties: [{ type, targetX: selectedTile!.x, targetY: selectedTile!.y, reward }],
      });
      await refresh();
    })
  );
}

function terrainIcon(terrain?: string): string {
  return { plains: '🌾', forest: '🌲', hills: '⛰️', mountains: '🏔️', swamp: '🌿' }[terrain ?? ''] ?? '·';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
