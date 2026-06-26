/**
 * WIMBLEDINO — admin.js
 * Pannello admin per il torneo di tennis. Funzioni:
 *  - Approvazioni: accetta/rifiuta le richieste di iscrizione
 *  - Risultati: inserisci/correggi i vincitori reali turno per turno
 *  - Bonus: assegna i vincitori delle categorie bonus fine torneo
 *  - Partecipanti: stato schede, abilita/disabilita, gestione admin
 *  - Sistema: apri/chiudi pronostici, ricalcola la classifica
 *
 * Il ricalcolo classifica è interamente client-side (vedi handoff §8/§10):
 * carica pronostici + risultati, applica punteggi.js, scrive classifica/snapshot.
 */

import { STATE } from './app.js';
import {
  getPartecipanti, updatePartecipante,
  getRisultati, setRisultati, onRisultatiSnapshot,
  getTuttiPronostici, saveClassifica,
  getSistema, updateSistema, onSistemaSnapshot, getClassificaUpdatedAt,
} from './db.js';
import { caricaEvento, nomeGiocatore } from './evento.js';
import {
  TURNI, SET_OPTIONS, matchId, getPron, getMatchPlayers,
} from './bracket.js';
import { calcolaPunteggio } from './punteggi.js';
import { showToast, openModal, closeModal, formatDate } from './ui.js';

let _db = null;
let _ris = null;            // copia di lavoro dei risultati ufficiali
let _parts = [];            // partecipanti
let _aperti = true;
let _built = false;
let _unsubSistema = null;
let _activeRound = 'R128';

// ── INIT ──────────────────────────────────────────────
export async function initAdmin() {
  const page = document.getElementById('page-admin');
  if (!page) return;

  _db = await caricaEvento();
  _ris = (await getRisultati()) || {};
  if (!_ris.bracket) _ris.bracket = {};
  if (!_ris.bonus)   _ris.bonus = {};

  _buildShell();
  _built = true;

  await _caricaPartecipanti();
  TURNI.forEach(t => _renderRoundRisultati(t.id));
  _renderBonus();
  await _renderSistema();

  if (_unsubSistema) _unsubSistema();
  _unsubSistema = onSistemaSnapshot((cfg) => {
    _aperti = cfg?.pronostici_aperti !== false;
    _aggiornaStatoPronostici();
  });
}

// ── SHELL ─────────────────────────────────────────────
function _buildShell() {
  const page = document.getElementById('page-admin');

  const roundTabs = TURNI.map((t, i) =>
    `<button type="button" class="tab${i === 0 ? ' active' : ''}" data-tab="ris-${t.id}" data-rround="${t.id}">${t.nome}</button>`
  ).join('');
  const roundContents = TURNI.map((t, i) =>
    `<div id="ris-${t.id}" class="tab-content${i === 0 ? ' active' : ''}">
       <div class="round-head"><h4 class="section-title">${t.nome} — risultati reali</h4>
         <span class="round-progress" id="risprog-${t.id}"></span></div>
       <div id="risround-${t.id}" class="round-matches"></div>
       <div class="elim-save-row">
         <button type="button" class="btn btn-primary" data-savris="${t.id}">💾 Salva risultati ${t.nome}</button>
         <span class="elim-save-msg" id="rismsg-${t.id}"></span>
       </div>
     </div>`
  ).join('');

  page.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">⚙️ Pannello Admin</h2>
      <span class="page-subtitle">Approvazioni, risultati, sistema</span>
    </div>

    <div class="tab-bar admin-tabs">
      <button type="button" class="tab active" data-tab="tab-admin-approvazioni">
        Approvazioni <span id="approv-badge" class="nav-badge" style="display:none;position:relative;top:-1px;right:auto;margin-left:4px"></span>
      </button>
      <button type="button" class="tab" data-tab="tab-admin-risultati">Risultati</button>
      <button type="button" class="tab" data-tab="tab-admin-bonus">🏆 Bonus</button>
      <button type="button" class="tab" data-tab="tab-admin-partecipanti">Partecipanti</button>
      <button type="button" class="tab" data-tab="tab-admin-sistema">Sistema</button>
    </div>

    <div id="tab-admin-approvazioni" class="tab-content active">
      <div id="admin-approvazioni-container"></div>
    </div>

    <div id="tab-admin-risultati" class="tab-content">
      <div class="info-banner info-banner--yellow">
        <span>📝</span>
        <span>Inserisci i vincitori reali turno per turno. Dopo il salvataggio la classifica viene ricalcolata automaticamente.</span>
      </div>
      <div class="tab-bar" id="ris-round-tabs">${roundTabs}</div>
      ${roundContents}
    </div>

    <div id="tab-admin-bonus" class="tab-content">
      <div class="info-banner info-banner--yellow">
        <span>🏆</span>
        <span>Assegna i vincitori delle categorie bonus quando sono noti a fine torneo.</span>
      </div>
      <div id="admin-bonus-box" class="bonus-form"></div>
      <div class="elim-save-row">
        <button type="button" class="btn btn-primary" data-savris="BONUS">💾 Salva Bonus</button>
        <span class="elim-save-msg" id="rismsg-BONUS"></span>
      </div>
    </div>

    <div id="tab-admin-partecipanti" class="tab-content">
      <div id="admin-partecipanti-container"></div>
    </div>

    <div id="tab-admin-sistema" class="tab-content">
      <div class="admin-sistema-grid">
        <div class="sistema-card">
          <h4>🔒 Pronostici</h4>
          <p id="sistema-pronostici-status">—</p>
          <button type="button" id="btn-toggle-pronostici" class="btn btn-secondary">Apri / Chiudi</button>
        </div>
        <div class="sistema-card">
          <h4>🏅 Classifica</h4>
          <p id="sistema-classifica-status">—</p>
          <button type="button" id="btn-ricalcola-classifica" class="btn btn-primary">Ricalcola classifica</button>
        </div>
      </div>
    </div>
  `;

  // Salvataggi risultati per turno / bonus
  page.querySelectorAll('[data-savris]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.savris;
      if (r === 'BONUS') _salvaBonus(btn);
      else _salvaRisultatiTurno(r, btn);
    });
  });
  // Re-render del turno risultati quando la sua tab diventa attiva
  page.querySelectorAll('#ris-round-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => { _activeRound = tab.dataset.rround; _renderRoundRisultati(_activeRound); });
  });

  // L'handler globale dei tab (in app.js) disattiva TUTTI i .tab-content dentro
  // page-admin, comprese le sotto-schede dei turni: quando si entra nella scheda
  // "Risultati" riattiviamo il turno corrente (dopo che l'handler globale ha girato).
  const tabRis = page.querySelector('[data-tab="tab-admin-risultati"]');
  if (tabRis) tabRis.addEventListener('click', () => setTimeout(() => {
    page.querySelectorAll('#ris-round-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.rround === _activeRound));
    TURNI.forEach(t => {
      const c = document.getElementById('ris-' + t.id);
      if (c) c.classList.toggle('active', t.id === _activeRound);
    });
    _renderRoundRisultati(_activeRound);
  }, 0));

  // Sistema
  page.querySelector('#btn-toggle-pronostici').addEventListener('click', _togglePronostici);
  page.querySelector('#btn-ricalcola-classifica').addEventListener('click', () => _ricalcola(true));
}

// ── APPROVAZIONI ──────────────────────────────────────
async function _caricaPartecipanti() {
  _parts = await getPartecipanti();
  _renderApprovazioni();
  _renderPartecipanti();
}

function _displayName(p) {
  return p.nickname || `${p.nome || ''} ${p.cognome || ''}`.trim() || p.id;
}

function _renderApprovazioni() {
  const box = document.getElementById('admin-approvazioni-container');
  if (!box) return;
  const pending = _parts.filter(p => p.approvato !== true && p.disabilitato !== true);

  const badge = document.getElementById('approv-badge');
  if (badge) {
    if (pending.length) { badge.style.display = ''; badge.textContent = pending.length; }
    else badge.style.display = 'none';
  }

  if (!pending.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>Nessuna richiesta in attesa.</p></div>`;
    return;
  }

  box.innerHTML = pending.map(p => `
    <div class="admin-row" data-uid="${p.id}">
      <div class="admin-row-info">
        <span class="admin-row-nome">${_displayName(p)}</span>
        <span class="admin-row-sub">${p.nome || ''} ${p.cognome || ''} · ${p.telefono || '—'} · ${p.email || '—'}</span>
      </div>
      <div class="admin-row-actions">
        <button type="button" class="btn btn-primary btn-sm" data-approva="${p.id}">✅ Approva</button>
        <button type="button" class="btn btn-secondary btn-sm" data-rifiuta="${p.id}">✖ Rifiuta</button>
      </div>
    </div>`).join('');

  box.querySelectorAll('[data-approva]').forEach(b =>
    b.addEventListener('click', () => _approva(b.dataset.approva)));
  box.querySelectorAll('[data-rifiuta]').forEach(b =>
    b.addEventListener('click', () => _rifiuta(b.dataset.rifiuta)));
}

async function _approva(uid) {
  try {
    await updatePartecipante(uid, { approvato: true, disabilitato: false });
    const p = _parts.find(x => x.id === uid); if (p) { p.approvato = true; p.disabilitato = false; }
    showToast('Utente approvato.', 'success');
    _renderApprovazioni(); _renderPartecipanti();
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

function _rifiuta(uid) {
  const p = _parts.find(x => x.id === uid);
  openModal({
    title: 'Rifiuta richiesta',
    body: `<p>Rifiutare la richiesta di <strong>${p ? _displayName(p) : uid}</strong>? L'account verrà disabilitato e non potrà accedere.</p>`,
    buttons: [
      { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
      { label: 'Rifiuta', cls: 'btn btn-danger', onClick: async () => {
          closeModal();
          try {
            await updatePartecipante(uid, { approvato: false, disabilitato: true });
            const pp = _parts.find(x => x.id === uid); if (pp) { pp.approvato = false; pp.disabilitato = true; }
            showToast('Richiesta rifiutata.', 'info');
            _renderApprovazioni(); _renderPartecipanti();
          } catch (err) { showToast('Errore: ' + err.message, 'error'); }
        } },
    ],
  });
}

// ── PARTECIPANTI ──────────────────────────────────────
async function _renderPartecipanti() {
  const box = document.getElementById('admin-partecipanti-container');
  if (!box) return;

  // Chi ha compilato almeno un pronostico
  let compilati = {};
  try {
    const prons = await getTuttiPronostici();
    prons.forEach(d => {
      const n = d.bracket ? Object.values(d.bracket).reduce((s, r) => s + Object.keys(r || {}).length, 0) : 0;
      compilati[d.id] = n;
    });
  } catch (_) {}

  const lista = _parts.filter(p => p.approvato === true);
  if (!lista.length) { box.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>Nessun partecipante approvato.</p></div>`; return; }

  box.innerHTML = `<div class="admin-part-list">` + lista.map(p => {
    const n = compilati[p.id] || 0;
    const owner = p.isOwner === true;
    const disab = p.disabilitato === true;
    return `
    <div class="admin-row${disab ? ' admin-row--off' : ''}" data-uid="${p.id}">
      <div class="admin-row-info">
        <span class="admin-row-nome">${_displayName(p)}
          ${p.isAdmin ? '<span class="badge-admin">admin</span>' : ''}
          ${owner ? '<span class="badge-owner">owner</span>' : ''}
        </span>
        <span class="admin-row-sub">${n} pronostici · ${p.email || '—'}${disab ? ' · disabilitato' : ''}</span>
      </div>
      <div class="admin-row-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-toggleadmin="${p.id}" ${owner ? 'disabled title="Owner sempre admin"' : ''}>
          ${p.isAdmin ? '↓ Rimuovi admin' : '↑ Rendi admin'}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" data-toggleoff="${p.id}" ${owner ? 'disabled title="Owner protetto"' : ''}>
          ${disab ? '✓ Riattiva' : '⛔ Disabilita'}
        </button>
      </div>
    </div>`;
  }).join('') + `</div>`;

  box.querySelectorAll('[data-toggleadmin]').forEach(b =>
    b.addEventListener('click', () => _toggleAdmin(b.dataset.toggleadmin)));
  box.querySelectorAll('[data-toggleoff]').forEach(b =>
    b.addEventListener('click', () => _toggleOff(b.dataset.toggleoff)));
}

async function _toggleAdmin(uid) {
  const p = _parts.find(x => x.id === uid); if (!p || p.isOwner) return;
  try {
    await updatePartecipante(uid, { isAdmin: !p.isAdmin });
    p.isAdmin = !p.isAdmin;
    showToast('Permessi aggiornati.', 'success');
    _renderPartecipanti();
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

async function _toggleOff(uid) {
  const p = _parts.find(x => x.id === uid); if (!p || p.isOwner) return;
  try {
    await updatePartecipante(uid, { disabilitato: !p.disabilitato });
    p.disabilitato = !p.disabilitato;
    showToast('Stato aggiornato.', 'success');
    _renderPartecipanti();
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

// ── RISULTATI (turno per turno) ───────────────────────
function _renderRoundRisultati(roundId) {
  const box = document.getElementById('risround-' + roundId);
  if (!box) return;
  const t = TURNI.find(x => x.id === roundId);

  let html = '';
  let compilati = 0;
  for (let i = 0; i < t.matches; i++) {
    const mid = matchId(roundId, i);
    // Gli accoppiamenti reali derivano dai vincitori reali del turno precedente
    const { a, b } = getMatchPlayers(roundId, i, _ris, _db);
    const p = getPron(_ris, roundId, mid);
    const vinc = (p && (p.vincitore === a || p.vincitore === b)) ? p.vincitore : null;
    const set = vinc ? (p.set || '') : '';
    if (vinc) compilati++;

    if (!a && !b) {
      html += `<div class="match-card match-locked"><span class="match-num">${i + 1}</span>
        <span class="match-locked-msg">Inserisci prima i risultati del turno precedente</span></div>`;
      continue;
    }
    const opt = (pid) => {
      if (!pid) return `<button type="button" class="match-team match-team--empty" disabled>—</button>`;
      const sel = vinc === pid ? ' selected' : '';
      return `<button type="button" class="match-team${sel}" data-mid="${mid}" data-pid="${pid}" data-round="${roundId}">${nomeGiocatore(_db, pid)}</button>`;
    };
    const setBtns = SET_OPTIONS.map(s =>
      `<button type="button" class="set-opt${set === s ? ' selected' : ''}" data-mid="${mid}" data-round="${roundId}" data-set="${s}">${s}</button>`
    ).join('');
    html += `<div class="match-card${vinc ? ' match-done' : ''}">
      <span class="match-num">${i + 1}</span>
      <div class="match-teams">${opt(a)}<span class="match-vs">vs</span>${opt(b)}</div>
      <div class="match-set${vinc ? '' : ' match-set--hidden'}"><span class="match-set-label">set</span>${setBtns}</div>
    </div>`;
  }
  box.innerHTML = html;
  const prog = document.getElementById('risprog-' + roundId);
  if (prog) prog.textContent = `${compilati}/${t.matches}`;

  box.querySelectorAll('.match-team[data-pid]').forEach(btn =>
    btn.addEventListener('click', () => { _setRisVincitore(btn.dataset.round, btn.dataset.mid, btn.dataset.pid); _renderRoundRisultati(btn.dataset.round); }));
  box.querySelectorAll('.set-opt[data-set]').forEach(btn =>
    btn.addEventListener('click', () => { _setRisSet(btn.dataset.round, btn.dataset.mid, btn.dataset.set); _renderRoundRisultati(btn.dataset.round); }));
}

function _setRisVincitore(roundId, mid, pid) {
  if (!_ris.bracket[roundId]) _ris.bracket[roundId] = {};
  const cur = _ris.bracket[roundId][mid] || {};
  if (cur.vincitore === pid) delete _ris.bracket[roundId][mid];
  else _ris.bracket[roundId][mid] = { vincitore: pid, set: cur.set || '' };
}
function _setRisSet(roundId, mid, set) {
  const cur = _ris.bracket[roundId]?.[mid];
  if (!cur || !cur.vincitore) return;
  cur.set = (cur.set === set) ? '' : set;
}

async function _salvaRisultatiTurno(roundId, btn) {
  const msg = document.getElementById('rismsg-' + roundId);
  btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Salvataggio…';
  try {
    await setRisultati({ bracket: _ris.bracket, bonus: _ris.bonus });
    if (msg) { msg.textContent = '✅ Salvato'; msg.className = 'elim-save-msg ok'; }
    showToast('Risultati salvati. Ricalcolo classifica…', 'success');
    await _ricalcola(false);
  } catch (err) {
    if (msg) { msg.textContent = '❌ Errore'; msg.className = 'elim-save-msg err'; }
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = old;
    setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
  }
}

// ── BONUS (risultati reali) ───────────────────────────
function _renderBonus() {
  const box = document.getElementById('admin-bonus-box');
  if (!box) return;
  const cats = _db.bonus || [];
  if (!cats.length) { box.innerHTML = '<p class="text-muted">Nessun bonus configurato.</p>'; return; }
  const ids = Object.keys(_db.giocatori || {});
  ids.sort((x, y) => nomeGiocatore(_db, x).localeCompare(nomeGiocatore(_db, y), 'it'));
  const optsHtml = (sel) => '<option value="">— non assegnato —</option>' +
    ids.map(pid => `<option value="${pid}"${sel === pid ? ' selected' : ''}>${nomeGiocatore(_db, pid)}</option>`).join('');

  box.innerHTML = cats.map(c => {
    const sel = _ris.bonus?.[c.id] || '';
    return `<div class="bonus-field">
      <label class="bonus-field-label">${c.label}</label>
      <select class="bonus-select" data-bonus="${c.id}">${optsHtml(sel)}</select>
    </div>`;
  }).join('');

  box.querySelectorAll('.bonus-select').forEach(s =>
    s.addEventListener('change', () => {
      if (!_ris.bonus) _ris.bonus = {};
      _ris.bonus[s.dataset.bonus] = s.value || null;
    }));
}

async function _salvaBonus(btn) {
  const msg = document.getElementById('rismsg-BONUS');
  btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Salvataggio…';
  try {
    await setRisultati({ bracket: _ris.bracket, bonus: _ris.bonus });
    if (msg) { msg.textContent = '✅ Salvato'; msg.className = 'elim-save-msg ok'; }
    showToast('Bonus salvati. Ricalcolo classifica…', 'success');
    await _ricalcola(false);
  } catch (err) {
    if (msg) { msg.textContent = '❌ Errore'; msg.className = 'elim-save-msg err'; }
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = old;
    setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
  }
}

// ── SISTEMA ───────────────────────────────────────────
async function _renderSistema() {
  try {
    const cfg = await getSistema();
    _aperti = cfg?.pronostici_aperti !== false;
  } catch (_) {}
  _aggiornaStatoPronostici();
  try {
    const ts = await getClassificaUpdatedAt();
    const el = document.getElementById('sistema-classifica-status');
    if (el) el.textContent = ts ? `Ultimo aggiornamento: ${formatDate(ts.toISOString(), true)}` : 'Mai ricalcolata';
  } catch (_) {}
}

function _aggiornaStatoPronostici() {
  const el = document.getElementById('sistema-pronostici-status');
  if (el) el.textContent = _aperti ? '🟢 Aperti — i partecipanti possono modificare' : '🔴 Chiusi — schede bloccate';
}

async function _togglePronostici() {
  const nuovo = !_aperti;
  try {
    await updateSistema({ pronostici_aperti: nuovo });
    _aperti = nuovo;
    _aggiornaStatoPronostici();
    showToast(nuovo ? 'Pronostici aperti.' : 'Pronostici chiusi.', 'success');
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

// ── RICALCOLO CLASSIFICA (client-side) ────────────────
async function _ricalcola(manuale) {
  const btn = document.getElementById('btn-ricalcola-classifica');
  if (manuale && btn) { btn.disabled = true; btn.textContent = '⏳ Ricalcolo…'; }
  try {
    const [parts, prons, ris] = await Promise.all([
      getPartecipanti(), getTuttiPronostici(), getRisultati(),
    ]);
    // Nomi solo per approvati e non disabilitati (guard contro pronostici orfani)
    const nomi = {};
    parts.forEach(p => {
      if (p.approvato === true && p.disabilitato !== true) {
        nomi[p.id] = p.nickname || `${p.nome || ''} ${p.cognome || ''}`.trim() || p.id;
      }
    });

    const out = [];
    const visti = new Set();
    prons.forEach(d => {
      if (!nomi[d.id]) return; // orfano o non idoneo
      const { totale, breakdown, spareggio } = calcolaPunteggio(d, ris, _db);
      out.push({ id: d.id, nome: nomi[d.id], totale, breakdown, spareggio });
      visti.add(d.id);
    });
    // Includi anche gli approvati senza pronostici (a 0) così compaiono in classifica
    Object.keys(nomi).forEach(uid => {
      if (visti.has(uid)) return;
      out.push({ id: uid, nome: nomi[uid], totale: 0,
        breakdown: { esiti: 0, set: 0, bonus: 0, perTurno: {} },
        spareggio: [0, 0, 0, 0, 0, 0] });
    });

    await saveClassifica(out);
    showToast(`Classifica ricalcolata (${out.length} partecipanti).`, 'success');
    const el = document.getElementById('sistema-classifica-status');
    if (el) el.textContent = `Ultimo aggiornamento: ${formatDate(new Date().toISOString(), true)}`;
  } catch (err) {
    showToast('Errore nel ricalcolo: ' + err.message, 'error');
  } finally {
    if (manuale && btn) { btn.disabled = false; btn.textContent = 'Ricalcola classifica'; }
  }
}
