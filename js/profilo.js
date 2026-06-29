/**
 * WIMBLEDINO — profilo.js
 * Pagina "Il mio profilo" (e scheda di un altro partecipante, via STATE.profiloUid).
 *
 * Contiene:
 *   • Score card: posizione in classifica + punti totali.
 *   • Tab "Riepilogo":
 *       – Punti per turno (breakdown esiti/set + giocatori indovinati).
 *       – Pronostici chiave (campione, finalisti, semifinalisti) con stato live
 *         confrontato coi risultati ufficiali (confermato / in corsa / fuori).
 *       – Prossime partite dei giocatori pronosticati (calendario live ESPN).
 *   • Tab "Scheda pronostici": tabellone grafico completo + bonus fine torneo.
 *
 * Privacy: la scheda/i pronostici di un ALTRO partecipante restano nascosti se
 * lui ha attivato "nascondi pronostico" e i pronostici sono ancora aperti
 * (gli admin e il proprietario vedono comunque tutto).
 */

import { STATE, navigaA } from './app.js';
import { getClassifica, getPronostici, getRisultati, getSistema } from './db.js';
import { caricaEvento, nomeGiocatore } from './evento.js';
import {
  TURNI, getCampione, getPron, getMatchPlayers, matchId,
  renderBracketGrafico, renderBonus,
} from './bracket.js';
import { calcolaPunteggio } from './punteggi.js';
import { rankBadge, infoBtn, openSchedaGiocatore } from './giocatore.js';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';
const GIORNI_FUTURI = 4;   // oggi + 3 giorni per le "prossime partite"

let _tabsBound = false;    // i listener dei sotto-tab vanno agganciati una sola volta

// ── INIT ──────────────────────────────────────────────
export async function initProfilo() {
  const page = document.getElementById('page-profilo');
  if (!page || !STATE.utente) return;

  const targetUid = STATE.profiloUid || STATE.utente.id;
  const isMe = targetUid === STATE.utente.id;

  // Sotto-tab Riepilogo / Scheda
  _bindInnerTabs();
  _resetInnerTabs();

  // Banner "torna alla classifica" (solo su profilo altrui)
  _renderBanner(isMe);

  // Stato di caricamento
  const bd = document.getElementById('profilo-breakdown');
  if (bd) bd.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Caricamento profilo…</p></div>';
  _setHtml('profilo-imminenti', '');
  _setHtml('profilo-partite', '');
  _setHtml('profilo-scheda-container', '');

  try {
    const db = await caricaEvento();
    const [classifica, risultati, sistema] = await Promise.all([
      getClassifica(), getRisultati(), getSistema(),
    ]);
    const aperti = sistema?.pronostici_aperti !== false;

    const me = (classifica || []).find(p => p.id === targetUid) || null;
    const nome = isMe
      ? (STATE.utente.nickname || STATE.utente.nome || 'Tu')
      : (me?.nome || 'Partecipante');

    // Pronostici del target
    const pron = (await getPronostici(targetUid)) || {};
    if (!pron.bracket) pron.bracket = {};
    if (!pron.bonus) pron.bonus = {};

    // Privacy: scheda visibile?
    const nascosto = pron.pronostico_nascosto === true;
    const puoVedere = isMe || STATE.utente.isAdmin || !aperti || !nascosto;

    // Titolo
    const title = document.getElementById('profilo-page-title');
    if (title) title.textContent = isMe ? '📊 Il mio profilo' : `📊 ${nome}`;

    // Stato risultati (per i confronti "live")
    const stato = _statoTorneo(risultati, db);

    _renderScoreCard(me, nome, isMe, classifica);
    _renderBreakdown(me, pron, risultati, db);
    _renderKeyPicks(pron, db, stato, puoVedere, nascosto);
    _renderScheda(pron, db, puoVedere, nascosto, aperti);
    _renderProssime(pron, db, stato, puoVedere);
  } catch (err) {
    if (bd) bd.innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div>` +
      `<p>Impossibile caricare il profilo.</p><p class="text-muted">${err.message || ''}</p></div>`;
  }
}

// ── BANNER / TAB ──────────────────────────────────────
function _renderBanner(isMe) {
  const banner = document.getElementById('profilo-header-banner');
  if (!banner) return;
  if (isMe) { banner.style.display = 'none'; banner.innerHTML = ''; return; }
  banner.style.display = '';
  banner.innerHTML =
    `<button type="button" class="prof-back-btn">← Torna alla classifica</button>` +
    `<span class="prof-back-note">Stai guardando la scheda di un altro partecipante</span>`;
  const btn = banner.querySelector('.prof-back-btn');
  if (btn) btn.addEventListener('click', () => navigaA('classifica'));
}

/** Switch dei sotto-tab (Riepilogo / Scheda). I bottoni sono statici in index.html,
 *  quindi i listener si agganciano una volta sola. */
function _bindInnerTabs() {
  if (_tabsBound) return;
  const bar = document.getElementById('profilo-inner-tabs');
  if (!bar) return;
  bar.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      bar.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      ['tab-profilo-riepilogo', 'tab-profilo-scheda'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', id === targetId);
      });
    });
  });
  _tabsBound = true;
}

function _resetInnerTabs() {
  const tabs = document.getElementById('profilo-inner-tabs');
  if (tabs) tabs.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  ['tab-profilo-riepilogo', 'tab-profilo-scheda'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', i === 0);
  });
}

// ── SCORE CARD ────────────────────────────────────────
function _renderScoreCard(me, nome, isMe, classifica) {
  const card = document.getElementById('profilo-score-card');
  if (!card) return;
  const pos = _posizione(classifica, me?.id);
  card.innerHTML = `
    <div class="score-card-inner">
      <div class="score-card-pos">${_posLabel(pos)}</div>
      <div class="score-card-info">
        <div class="score-card-nome">${nome}${isMe ? ' <span class="badge-tu">Tu</span>' : ''}</div>
        <div class="score-card-totale">${me?.totale ?? 0} <span class="score-card-pt">pt</span></div>
      </div>
    </div>`;
}

// ── BREAKDOWN PUNTI PER TURNO ─────────────────────────
function _renderBreakdown(me, pron, risultati, db) {
  const box = document.getElementById('profilo-breakdown');
  if (!box) return;

  // Usa il breakdown pre-calcolato (classifica); fallback: calcolo locale.
  let breakdown = me?.breakdown;
  if (!breakdown || !breakdown.perTurno) {
    breakdown = calcolaPunteggio(pron, risultati, db).breakdown;
  }
  const perTurno = breakdown.perTurno || {};

  const rows = TURNI.map(t => {
    const pt = perTurno[t.id] || { esiti: 0, set: 0, indovinati: 0 };
    const tot = (pt.esiti || 0) + (pt.set || 0);
    const cls = tot > 0 ? '' : ' prof-row--empty';
    return `<tr class="prof-bd-row${cls}">
      <td class="prof-bd-turno">${t.nome}</td>
      <td class="prof-bd-num">${pt.indovinati || 0}</td>
      <td class="prof-bd-num">${pt.esiti || 0}</td>
      <td class="prof-bd-num">${pt.set || 0}</td>
      <td class="prof-bd-num prof-bd-tot">${tot}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="prof-card">
      <h3 class="prof-card-title">📈 Punti per turno</h3>
      <table class="prof-bd-table">
        <thead><tr>
          <th>Turno</th><th>Azzeccati</th><th>Esiti</th><th>Set</th><th>Punti</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="prof-bd-foot">
        <span class="prof-pill">Esiti <strong>${breakdown.esiti || 0}</strong></span>
        <span class="prof-pill">Bonus-set <strong>${breakdown.set || 0}</strong></span>
        <span class="prof-pill">Bonus statistici <strong>${breakdown.bonus || 0}</strong></span>
        <span class="prof-pill prof-pill--tot">Totale <strong>${(breakdown.esiti || 0) + (breakdown.set || 0) + (breakdown.bonus || 0)}</strong></span>
      </div>
      <p class="prof-note">«Azzeccati» = giocatori dati vincitori che hanno davvero vinto in quel turno. Il bonus-set premia il numero di set esatto (solo se il vincitore è corretto).</p>
    </div>`;
}

// ── PRONOSTICI CHIAVE ─────────────────────────────────
function _renderKeyPicks(pron, db, stato, puoVedere, nascosto) {
  const box = document.getElementById('profilo-imminenti');
  if (!box) return;

  if (!puoVedere) {
    box.innerHTML = `
      <div class="prof-card prof-card--locked">
        <h3 class="prof-card-title">🙈 Pronostici nascosti</h3>
        <p class="text-muted">Questo partecipante ha scelto di nascondere la propria scheda finché i pronostici sono aperti.</p>
      </div>`;
    return;
  }

  const campione = getCampione(pron);
  const finalisti = _vincitoriRound(pron, 'SF');
  const semifinalisti = _vincitoriRound(pron, 'QF');

  if (!campione && !finalisti.length && !semifinalisti.length) {
    box.innerHTML = `
      <div class="prof-card">
        <h3 class="prof-card-title">🎯 Pronostici chiave</h3>
        <p class="text-muted">Nessun pronostico nelle fasi finali ancora compilato.</p>
      </div>`;
    return;
  }

  const champHtml = campione
    ? _chipGiocatore(db, campione, _statoPick(campione, 'F', stato))
    : '<span class="text-muted">—</span>';

  box.innerHTML = `
    <div class="prof-card">
      <h3 class="prof-card-title">🎯 Pronostici chiave</h3>
      <div class="prof-keys">
        <div class="prof-key-group">
          <div class="prof-key-label">🏆 Campione</div>
          <div class="prof-chips">${champHtml}</div>
        </div>
        <div class="prof-key-group">
          <div class="prof-key-label">🥈 Finalisti</div>
          <div class="prof-chips">${_chipList(db, finalisti, 'SF', stato)}</div>
        </div>
        <div class="prof-key-group">
          <div class="prof-key-label">🎽 Semifinalisti</div>
          <div class="prof-chips">${_chipList(db, semifinalisti, 'QF', stato)}</div>
        </div>
      </div>
      <p class="prof-note">✅ raggiunto · ⏳ ancora in corsa · ❌ eliminato — rispetto ai risultati ufficiali.</p>
    </div>`;

  box.querySelectorAll('.player-info-btn[data-info]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSchedaGiocatore(db, btn.dataset.info); });
  });
}

function _chipList(db, pids, round, stato) {
  if (!pids.length) return '<span class="text-muted">—</span>';
  return pids.map(pid => _chipGiocatore(db, pid, _statoPick(pid, round, stato))).join('');
}

function _chipGiocatore(db, pid, st) {
  const icon = st === 'ok' ? '✅' : st === 'out' ? '❌' : '⏳';
  const cls = st === 'ok' ? ' prof-chip--ok' : st === 'out' ? ' prof-chip--out' : ' prof-chip--live';
  return `<span class="prof-chip${cls}">
    <span class="prof-chip-ic">${icon}</span>
    <span class="prof-chip-name">${nomeGiocatore(db, pid)}</span>${rankBadge(db, pid)}
    ${infoBtn(pid)}
  </span>`;
}

// ── SCHEDA (tabellone grafico + bonus) ────────────────
function _renderScheda(pron, db, puoVedere, nascosto, aperti) {
  const box = document.getElementById('profilo-scheda-container');
  if (!box) return;

  if (!puoVedere) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🙈</div>
        <p>Scheda nascosta</p>
        <p class="text-muted">Sarà visibile a tutti quando i pronostici verranno chiusi.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="prof-card">
      <h3 class="prof-card-title">🗺️ Tabellone pronosticato</h3>
      <div id="profilo-bracket-grafico"></div>
    </div>
    <div class="prof-card">
      <div id="profilo-bonus-box"></div>
    </div>`;

  renderBracketGrafico(document.getElementById('profilo-bracket-grafico'), pron, db);
  renderBonus(document.getElementById('profilo-bonus-box'), pron, db);
}

// ── PROSSIME PARTITE (calendario live ESPN) ───────────
async function _renderProssime(pron, db, stato, puoVedere) {
  const box = document.getElementById('profilo-partite');
  if (!box) return;
  if (!puoVedere) { box.innerHTML = ''; return; }

  // Giocatori "scelti" (dati vincitori in QUALSIASI turno) e ancora non eliminati.
  const scelti = new Set();
  TURNI.forEach(t => Object.keys(_vincitoriRoundMap(pron, t.id)).forEach(pid => scelti.add(pid)));
  const vivi = [...scelti].filter(pid => !stato.eliminati.has(pid));

  // Mappa espnId → pid (per riconoscere i match dal calendario ESPN).
  const espnToPid = new Map();
  vivi.forEach(pid => {
    const eid = db.giocatori?.[pid]?.espnId;
    if (eid) espnToPid.set(String(eid), pid);
  });
  if (!espnToPid.size) { box.innerHTML = ''; return; }

  box.innerHTML = `
    <div class="prof-card">
      <h3 class="prof-card-title">📅 Prossime partite dei tuoi giocatori</h3>
      <div id="prof-prossime-list"><span class="pc-loading">Carico il calendario…</span></div>
    </div>`;
  const list = document.getElementById('prof-prossime-list');

  let matches = [];
  try {
    matches = await _fetchProssime(espnToPid);
  } catch (_) {
    list.innerHTML = '<p class="text-muted">Calendario non disponibile al momento.</p>';
    return;
  }

  if (!matches.length) {
    list.innerHTML = '<p class="text-muted">Nessuna partita in programma a breve per i giocatori che hai pronosticato ancora in corsa.</p>';
    return;
  }

  list.innerHTML = matches.slice(0, 10).map(m => {
    const live = m.state === 'in';
    const teams = m.players.map(p => {
      const mine = espnToPid.has(p.id) ? ' prof-pm-mine' : '';
      const flag = p.flag ? `<img class="pc-flag" src="${p.flag}" alt=""> ` : '';
      return `<span class="prof-pm-team${mine}">${flag}${p.name || '—'}</span>`;
    }).join('<span class="prof-pm-vs">vs</span>');
    const meta = [m.tournament, m.round].filter(Boolean).join(' · ');
    const when = live
      ? '<span class="prof-pm-live">🔴 in corso</span>'
      : `<span class="prof-pm-when">${_dataOra(m.date)}</span>`;
    return `<div class="prof-pm-row">
      <div class="prof-pm-teams">${teams}</div>
      <div class="prof-pm-meta">${meta}</div>
      <div class="prof-pm-time">${when}</div>
    </div>`;
  }).join('');
}

function _fetchProssime(espnToPid) {
  const urls = _giorniFuturi(GIORNI_FUTURI).map(d => `${SCOREBOARD}?dates=${d}`);
  return Promise.all(urls.map(u => _fetchJson(u).catch(() => null))).then(lists => {
    const out = [];
    const seen = new Set();
    for (const data of lists) {
      if (!data) continue;
      for (const ev of (data.events || [])) {
        const tname = ev.name || '';
        for (const g of (ev.groupings || [])) {
          const slug = (g.grouping && g.grouping.slug) || g.slug;
          if (slug !== 'mens-singles') continue;
          for (const c of (g.competitions || [])) {
            if (!c.id || seen.has(c.id)) continue;
            const st = (c.status && c.status.type) || {};
            if (st.state === 'post' || st.completed === true) continue; // solo da giocare / in corso
            const comps = c.competitors || [];
            if (comps.length !== 2) continue;
            const ids = comps.map(x => String(x.id || ''));
            if (ids.some(i => i.includes('-'))) continue;             // niente doppio
            if (!ids.some(i => espnToPid.has(i))) continue;            // almeno un mio giocatore
            seen.add(c.id);
            out.push({
              date: c.date, tournament: tname,
              round: (c.round && c.round.displayName) || '',
              state: st.state,
              players: comps.map(x => ({
                id: String(x.id || ''),
                name: (x.athlete && x.athlete.displayName) || '',
                flag: (x.athlete && x.athlete.flag && x.athlete.flag.href) || null,
              })),
            });
          }
        }
      }
    }
    out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return out;
  });
}

// ── STATO TORNEO (dai risultati ufficiali) ────────────
/** Calcola: vincitori reali per turno + insieme dei giocatori eliminati. */
function _statoTorneo(risultati, db) {
  const winnersByRound = {};
  const eliminati = new Set();
  TURNI.forEach(t => {
    const set = new Set();
    for (let i = 0; i < t.matches; i++) {
      const mid = matchId(t.id, i);
      const p = getPron(risultati, t.id, mid);
      if (!p?.vincitore) continue;
      const { a, b } = getMatchPlayers(t.id, i, risultati, db);
      if (p.vincitore !== a && p.vincitore !== b) continue;
      set.add(p.vincitore);
      const perdente = p.vincitore === a ? b : a;
      if (perdente) eliminati.add(perdente);
    }
    winnersByRound[t.id] = set;
  });
  return { winnersByRound, eliminati };
}

/** Stato di un pronostico chiave: 'ok' (raggiunto), 'out' (eliminato), 'live'. */
function _statoPick(pid, round, stato) {
  if (stato.winnersByRound[round]?.has(pid)) return 'ok';
  if (stato.eliminati.has(pid)) return 'out';
  return 'live';
}

// ── HELPERS ───────────────────────────────────────────
function _vincitoriRoundMap(pron, roundId) {
  const out = {};
  const matches = pron?.bracket?.[roundId] || {};
  Object.values(matches).forEach(m => { if (m && m.vincitore) out[m.vincitore] = true; });
  return out;
}
function _vincitoriRound(pron, roundId) {
  return Object.keys(_vincitoriRoundMap(pron, roundId));
}

/** Posizione (con ex-aequo) di un uid nella classifica, stessa logica di classifica.js. */
function _posizione(classifica, uid) {
  if (!uid || !classifica?.length) return null;
  const sorted = [...classifica].sort((a, b) => {
    if (b.totale !== a.totale) return (b.totale || 0) - (a.totale || 0);
    const sa = a.spareggio || [], sb = b.spareggio || [];
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if ((sb[i] || 0) !== (sa[i] || 0)) return (sb[i] || 0) - (sa[i] || 0);
    }
    return (a.nome || '').localeCompare(b.nome || '', 'it');
  });
  let pos = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1], cur = sorted[i];
      const same = prev.totale === cur.totale &&
        JSON.stringify(prev.spareggio) === JSON.stringify(cur.spareggio);
      if (!same) pos = i + 1;
    }
    if (sorted[i].id === uid) return pos;
  }
  return null;
}

function _posLabel(pos) {
  if (!pos) return '—';
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return medals[pos] || `${pos}°`;
}

function _setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

function _fetchJson(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal, cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .finally(() => clearTimeout(t));
}

/** YYYYMMDD per oggi e i prossimi n-1 giorni (fuso Europe/London). */
function _giorniFuturi(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const s = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    out.push(s.replace(/-/g, ''));
  }
  return out;
}

function _dataOra(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const oggi = new Date();
    const stessoGiorno = d.toDateString() === oggi.toDateString();
    const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    if (stessoGiorno) return `Oggi ${ora}`;
    const data = d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', timeZone: 'Europe/Rome' });
    return `${data} ${ora}`;
  } catch { return ''; }
}
