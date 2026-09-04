import * as api from './api';
import type { GameStateResponse } from './api';
import { drawMap, canvasToTile, kingdomColor } from './mapView';
import { getActiveSession, saveSession, listSessions, setActiveGameId, type SavedSession } from './storage';

const app = document.getElementById('app')!;

let session: SavedSession | null = null;
let state: GameStateResponse | null = null;
let selectedTile: { x: number; y: number } | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

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
  app.innerHTML = `
    <div class="wrap">
      <h1>Standing Orders</h1>
      <p class="sub">An async kingdom game — indirect orders for your workers, direct control of your Hero.</p>
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
        <p class="hint">Defaults to http://localhost:8787 for local dev. Point this at your deployed Worker once it's live.</p>
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
  const base = `${location.origin}${location.pathname}`;
  app.innerHTML = `
    <div class="wrap">
      <h1>${escapeHtml(gameName)} is ready</h1>
      <p>Send each player their own link below (Discord DM, whatever). Opening the link logs that player in on their device.</p>
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
    state = await api.getState(session!.gameId, session!.token);
    renderGame();
  });
}

function renderGame() {
  if (!state || !session) return;
  const s = state;
  const mine = s.kingdoms.find((k) => k.isMine)!;
  const waitingOn = s.players.filter((p) => !p.confirmed).map((p) => p.name);
  const myPlayer = s.players.find((p) => p.isMe);

  app.innerHTML = `
    <div class="game-wrap">
      <header>
        <h1>${escapeHtml(s.game.name)}</h1>
        <div class="round-info">
          Round ${s.game.roundNumber} &middot;
          ${waitingOn.length > 0 ? `waiting on: ${waitingOn.map(escapeHtml).join(', ')}` : 'everyone ready — resolving soon'}
        </div>
        <button id="confirm-btn" ${myPlayer?.confirmed ? 'disabled' : ''}>${myPlayer?.confirmed ? 'Confirmed ✓' : 'Confirm orders'}</button>
        <button id="refresh-btn">Refresh</button>
        <div id="so-error" class="error"></div>
      </header>

      <div class="game-main">
        <div class="map-col">
          <canvas id="map-canvas"></canvas>
          <div class="legend">
            ${s.kingdoms.map((k, i) => `<span class="legend-item"><span class="swatch" style="background:${kingdomColor(i)}"></span>${escapeHtml(k.playerName)}${k.isMine ? ' (you)' : ''} — score ${k.score}</span>`).join('')}
          </div>
          <div id="tile-panel" class="card"></div>
        </div>

        <div class="side-col">
          <section class="card">
            <h2>Kingdom</h2>
            <div>Treasury: <strong>${mine.treasury}</strong> gold</div>
            <label>Tax rate: <input id="tax-rate" type="range" min="0" max="100" value="${mine.taxRate}" /> <span id="tax-rate-val">${mine.taxRate}%</span></label>
            <button id="apply-tax-btn">Apply tax rate</button>
            <label>Alert level:
              <select id="alert-level">
                ${['Passive', 'Normal', 'Aggressive'].map((lvl) => `<option value="${lvl}" ${mine.alertLevel === lvl ? 'selected' : ''}>${lvl}</option>`).join('')}
              </select>
            </label>
            <button id="apply-alert-btn">Apply alert level</button>
            <h3>Buildings</h3>
            <ul class="building-list">
              ${mine.buildings.map((b) => `<li>${b.type} (lvl ${b.level}) — ${b.status}${b.status === 'building' ? ` (${b.build_progress_rounds_left} rounds left)` : ''}</li>`).join('')}
            </ul>
            <div class="building-buttons">
              ${['GuildHall', 'RoguesDen', 'WizardsTower', 'Temple', 'Market', 'Walls']
                .map((t) => `<button class="queue-building-btn" data-type="${t}">Queue ${t}</button>`)
                .join('')}
            </div>
            <h3>Workers (${mine.workers.filter((w) => w.state !== 'Dead').length})</h3>
            <ul class="worker-list">
              ${mine.workers
                .filter((w) => w.state !== 'Dead')
                .map((w) => `<li>${w.type} lvl${w.level} — ${w.state} (${w.hp}/${w.max_hp} hp)</li>`)
                .join('')}
            </ul>
          </section>

          ${renderHeroPanel(mine, s)}

          <section class="card">
            <h2>Events</h2>
            <ul class="event-list">
              ${s.events
                .slice(-15)
                .reverse()
                .map((e) => `<li><span class="event-round">R${e.round_number}</span> ${escapeHtml(e.message)}</li>`)
                .join('') || '<li class="hint">Nothing yet.</li>'}
            </ul>
          </section>
        </div>
      </div>
    </div>
  `;

  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  drawMap(canvas, s, selectedTile);
  canvas.addEventListener('click', (evt) => {
    selectedTile = canvasToTile(canvas, evt);
    renderGame();
  });

  wireHeaderControls();
  wireKingdomControls(mine.kingdomId);
  wireHeroControls(mine);
  renderTilePanel(mine.kingdomId);
}

function renderHeroPanel(mine: api.KingdomPublic, s: GameStateResponse) {
  const hero = mine.hero;
  if (!hero) return '';
  const canAct = hero.state === 'AtCapital' || hero.state === 'Exploring';
  const heroTile = s.map.find((t) => t.x === hero.tile_x && t.y === hero.tile_y);
  const canStartQuest = !!(heroTile?.feature && heroTile.feature_state === 'active');
  return `
    <section class="card">
      <h2>${escapeHtml(hero.name)}</h2>
      <div>Level ${hero.level} ${hero.class} — ${hero.hp}/${hero.max_hp} hp &middot; attack ${hero.attack}</div>
      <div>State: <strong>${hero.state}</strong>${hero.state === 'Resting' ? ` (${hero.recovery_rounds_left} rounds left)` : ''}</div>
      ${
        canAct
          ? `<div class="hero-controls">
              <button id="move-hero-btn">Move to selected tile</button>
              <button id="marshal-toggle-btn">${hero.marshal_active ? 'Stand down (marshal off)' : 'Marshal! (rally nearby workers)'}</button>
              ${canStartQuest ? '<button id="start-quest-btn">Start quest here</button>' : ''}
            </div>`
          : hero.state === 'InDungeon'
            ? `<div class="hero-controls">
                <button class="quest-action-btn" data-action="attack">Attack</button>
                <button class="quest-action-btn" data-action="use_item">Use item</button>
                <button class="quest-action-btn" data-action="flee">Flee</button>
              </div>
              <div id="quest-outcome"></div>`
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
  document.getElementById('refresh-btn')?.addEventListener('click', () => refresh());
}

function wireKingdomControls(kingdomId: string) {
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
  document.querySelectorAll<HTMLButtonElement>('.queue-building-btn').forEach((btn) => {
    btn.addEventListener('click', () =>
      withErrorHandling(async () => {
        await api.submitOrders(session!.gameId, session!.token, { queueBuildings: [{ type: btn.dataset.type! }] });
        await refresh();
      })
    );
  });
  void kingdomId;
}

function wireHeroControls(mine: api.KingdomPublic) {
  const hero = mine.hero;
  if (!hero) return;

  document.getElementById('move-hero-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      if (!selectedTile) throw new Error('click a tile on the map first');
      await api.moveHero(session!.gameId, session!.token, hero.id, selectedTile.x, selectedTile.y);
      await refresh();
    })
  );

  document.getElementById('marshal-toggle-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      await api.setMarshal(session!.gameId, session!.token, hero.id, !hero.marshal_active);
      await refresh();
    })
  );

  document.getElementById('start-quest-btn')?.addEventListener('click', () =>
    withErrorHandling(async () => {
      await api.startQuest(session!.gameId, session!.token, hero.id);
      await refresh();
    })
  );

  document.querySelectorAll<HTMLButtonElement>('.quest-action-btn').forEach((btn) => {
    btn.addEventListener('click', () =>
      withErrorHandling(async () => {
        const action = btn.dataset.action as 'attack' | 'use_item' | 'flee';
        const result = await api.stepQuest(session!.gameId, session!.token, hero.id, action);
        const out = document.getElementById('quest-outcome');
        if (out) out.textContent = result.outcome.message;
        await refresh();
      })
    );
  });
}

function renderTilePanel(kingdomId: string) {
  const panel = document.getElementById('tile-panel');
  if (!panel || !state) return;
  if (!selectedTile) {
    panel.innerHTML = '<p class="hint">Click a tile on the map to see details or post a bounty.</p>';
    return;
  }
  const tile = state.map.find((t) => t.x === selectedTile!.x && t.y === selectedTile!.y);
  if (!tile || tile.state === 'unseen') {
    panel.innerHTML = `<p class="hint">(${selectedTile.x}, ${selectedTile.y}) — unexplored.</p>`;
    return;
  }
  panel.innerHTML = `
    <h3>Tile (${tile.x}, ${tile.y})</h3>
    <div>${tile.terrain} &middot; danger ${tile.danger_level}${tile.feature ? ` &middot; ${tile.feature} (${tile.feature_state})` : ''}</div>
    <label>Post a bounty here:
      <select id="bounty-type">
        <option>Explore</option><option>Kill</option><option>Gather</option><option>Guard</option>
      </select>
      <input id="bounty-reward" type="number" min="1" value="20" placeholder="reward gold" />
    </label>
    <button id="post-bounty-btn">Post bounty</button>
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
  void kingdomId;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
