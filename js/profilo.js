/**
 * MONDIALITO 2026 — profilo.js
 * Pagina "Il mio profilo": punteggio personale, breakdown per categoria,
 * dettaglio partita per partita.
 */

import DB from '../mondialito_db.json' with { type: 'json' };
import { STATE, navigaA } from './app.js';
import { getPronostici, onRisultatiSnapshot, onClassificaSnapshot } from './db.js';
import { calcolaPunteggio } from './punteggi.js';
import { showSpinner } from './ui.js';
import { renderRiepilogoGironi, renderTabellone, getClassificaGirone } from './bracket.js';

let _pronostici  = null;
let _mioPronostici = null; // pronostici dell'utente loggato (per il confronto)
let _risultati   = {};
let _classifica  = [];
let _unsubRis    = null;
let _unsubClass  = null;
let _targetUid   = null;   // uid visualizzato (null = utente corrente)
let _targetNome  = null;

// True quando si sta guardando la scheda di un ALTRO partecipante.
function _isAltrui() {
  return !!(STATE.profiloUid && STATE.profiloUid !== STATE.utente?.id);
}
// Nome breve dell'avversario per le etichette di confronto.
function _nomeAvversario() {
  return (_targetNome || 'Avversario').split(' ')[0];
}

// ── INIT ──────────────────────────────────────────────
export async function initProfilo() {
  // Cancella subscriptions precedenti
  _unsubRis?.();
  _unsubClass?.();

  _targetUid  = STATE.profiloUid || STATE.utente?.id;
  _targetNome = null;  // verrà ricavato dalla classifica

  showSpinner('profilo-breakdown', 'Caricamento profilo…');
  _renderHeader();

  // Carica pronostici dell'utente target
  try {
    _pronostici = await getPronostici(_targetUid);
  } catch (e) {
    console.warn('Errore caricamento pronostici:', e);
    _pronostici = null;
  }

  // Se sto guardando un altro partecipante, carico anche i MIEI pronostici
  // per poter mostrare il confronto inline nel tab Riepilogo.
  _mioPronostici = null;
  if (_isAltrui()) {
    try {
      _mioPronostici = await getPronostici(STATE.utente?.id);
    } catch (e) {
      console.warn('Errore caricamento pronostici personali (confronto):', e);
      _mioPronostici = null;
    }
  }

  // Ascolta risultati per aggiornamento live
  _unsubRis = onRisultatiSnapshot((ris) => {
    _risultati = ris;
    _renderProfilo();
    _renderSchedaPronostici();
  });

  // Ascolta classifica per la posizione
  _unsubClass = onClassificaSnapshot((cl) => {
    _classifica = cl;
    const entry = cl.find(p => p.id === _targetUid);
    if (entry) _targetNome = entry.nome;
    _renderHeader();
    _renderProfilo();
  });

  // Tab interni: Riepilogo / Scheda
  document.getElementById('profilo-inner-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    const tabId = btn.dataset.tab;
    document.querySelectorAll('#profilo-inner-tabs .tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('#page-profilo .tab-content').forEach(el => {
      el.classList.toggle('active', el.id === tabId);
    });
    // Rendering lazy della scheda al primo accesso
    if (tabId === 'tab-profilo-scheda') _renderSchedaPronostici();
  });

  // Titolo pagina
  const titleEl = document.getElementById('profilo-page-title');
  if (titleEl) {
    titleEl.textContent = STATE.profiloUid && STATE.profiloUid !== STATE.utente?.id
      ? '📋 Scheda partecipante'
      : '📊 Il mio profilo';
  }
}

// ── HEADER (torna indietro + nome se profilo altrui) ──
function _renderHeader() {
  const headerEl = document.getElementById('profilo-header-banner');
  if (!headerEl) return;

  const isAltrui = STATE.profiloUid && STATE.profiloUid !== STATE.utente?.id;
  if (isAltrui) {
    const nome = _targetNome || '…';
    headerEl.innerHTML = `
      <div class="profilo-banner-altrui">
        <button class="btn btn-ghost btn-sm" id="btn-torna-classifica">← Classifica</button>
        <span class="profilo-banner-nome">Scheda di <strong>${nome}</strong></span>
      </div>`;
    document.getElementById('btn-torna-classifica')?.addEventListener('click', () => {
      navigaA('classifica');
    });
  } else {
    headerEl.innerHTML = '';
  }
}

// ── RENDER PRINCIPALE ─────────────────────────────────
function _renderProfilo() {
  if (!_pronostici) {
    document.getElementById('profilo-breakdown').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📋</div><p>Nessun pronostico trovato. Compila la tua scheda nella sezione Pronostici.</p></div>';
    return;
  }

  const { totale, breakdown: bd } = calcolaPunteggio(_pronostici, _risultati);

  // Posizione in classifica (dell'utente visualizzato)
  const entry = _classifica.find(p => p.id === _targetUid);
  const pos = entry?._pos || '—';

  // Score card (aggiorna il div già nel DOM)
  _renderScoreCard(totale, pos);

  // Breakdown della MIA scheda (per il confronto, solo se guardo un altro)
  const bdMe = (_isAltrui() && _mioPronostici)
    ? calcolaPunteggio(_mioPronostici, _risultati).breakdown
    : null;

  // Breakdown per categoria
  _renderBreakdown(bd, bdMe);

  // Partite nelle 24h precedenti/successive al caricamento pagina
  _renderPartiteImminenti();

  // Dettaglio partite girone (elenco completo)
  _renderDettaglioGironi(bd);
}

// Calcola pronostico + punti di una partita per un dato set di pronostici-gironi.
function _calcPron(prGironi, p, r) {
  const pr = prGironi?.[p.id];
  const hasResult = r && r.gol_casa != null;
  const pronTxt = pr ? `${pr.gol_casa ?? '?'}–${pr.gol_trasferta ?? '?'} (${pr.segno || '?'})` : null;
  if (!hasResult) return { pr, pronTxt, hasResult: false, pti: null };
  const segnoR   = r.gol_casa > r.gol_trasferta ? '1' : r.gol_casa < r.gol_trasferta ? '2' : 'X';
  const segnoOk  = !!(pr && pr.segno === segnoR);
  const esattoOk = !!(pr && pr.gol_casa == r.gol_casa && pr.gol_trasferta == r.gol_trasferta);
  const pti = (segnoOk ? 10 : 0) + (esattoOk ? 5 : 0);
  return { pr, pronTxt, hasResult: true, segnoOk, esattoOk, pti };
}

// Riga partita in modalità CONFRONTO: pronostico mio vs avversario, con punti.
function _matchCompareRow(p, { quando = '' } = {}) {
  const r     = _risultati?.gironi?.[p.id];
  const casa  = DB.squadre[p.casa]      || { nome: p.casa,      flag: '' };
  const trasf = DB.squadre[p.trasferta] || { nome: p.trasferta, flag: '' };
  const them  = _calcPron(_pronostici?.gironi, p, r);
  const me    = _calcPron(_mioPronostici?.gironi, p, r);
  const nomeAvv = _nomeAvversario();
  const hasResult = them.hasResult;

  const meWin   = hasResult && (me.pti   || 0) > (them.pti || 0);
  const themWin = hasResult && (them.pti || 0) > (me.pti   || 0);

  const realHtml = hasResult
    ? `<span class="pm-real">${r.gol_casa}–${r.gol_trasferta}</span>`
    : `<span class="pm-pts-attesa">⏳ da giocare</span>`;

  const line = (who, x, cls, win) => {
    const pron = x.pronTxt || '<span class="scheda-tbd">—</span>';
    const pts  = hasResult
      ? `<span class="pm-cmp-pts ${x.pti > 0 ? 'pts-pos' : ''}">${x.pti > 0 ? '+' + x.pti : '0'} pt</span>`
      : '';
    return `
      <div class="pm-cmp-line ${cls} ${win ? 'cmp-win' : ''}">
        <span class="pm-cmp-who">${who}</span>
        <span class="pm-cmp-pron ${hasResult ? (x.segnoOk ? 'ok' : 'ko') : ''}">${pron}</span>
        ${x.esattoOk ? '<span class="pm-esatto">🎯</span>' : ''}
        ${pts}
      </div>`;
  };

  const rowClass = hasResult ? (meWin ? 'match-ok' : themWin ? 'match-ko' : '') : 'match-upcoming';

  return `
    <div class="profilo-match-row cmp ${rowClass}">
      <div class="pm-teams">
        ${casa.flag} ${casa.nome} vs ${trasf.nome} ${trasf.flag}
        ${quando ? `<span class="pm-quando">${quando}</span>` : ''}
        <span class="pm-real-inline">${realHtml}</span>
      </div>
      <div class="pm-cmp-block">
        ${line('Tu', me, 'me', meWin)}
        ${line(nomeAvv, them, 'them', themWin)}
      </div>
    </div>`;
}

// ── PARTITE IMMINENTI (±24h dal caricamento) ──────────
function _renderPartiteImminenti() {
  const el = document.getElementById('profilo-imminenti');
  if (!el) return;

  const pGironi = _pronostici?.gironi || {};
  const rGironi = _risultati?.gironi  || {};

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const da  = now - DAY;
  const a   = now + DAY;

  // Raccogli le partite con kickoff nella finestra ±24h, ordinate per data.
  const items = [];
  Object.values(DB.gironi).forEach(girone => {
    girone.partite.forEach(p => {
      if (!p.data) return;
      const t = new Date(p.data).getTime();
      if (isNaN(t) || t < da || t > a) return;
      items.push({ p, t });
    });
  });
  items.sort((x, y) => x.t - y.t);

  const cmp = _isAltrui() && _mioPronostici;
  const titoloCmp = cmp ? ` <span class="text-muted">· confronto con ${_nomeAvversario()}</span>` : '';

  if (!items.length) {
    el.innerHTML = `
      <div class="breakdown-section">
        <h3 class="section-title">⏱️ Partite di oggi <span class="text-muted">(±24h)</span>${titoloCmp}</h3>
        <div class="empty-state"><div class="empty-icon">📅</div><p>Nessuna partita nelle 24 ore precedenti o successive.</p></div>
      </div>`;
    return;
  }

  const rows = items.map(({ p }) => {
    const quando = new Date(p.data).toLocaleString('it-IT', {
      weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    if (cmp) return _matchCompareRow(p, { quando });

    const casa  = DB.squadre[p.casa]      || { nome: p.casa,      flag: '' };
    const trasf = DB.squadre[p.trasferta] || { nome: p.trasferta, flag: '' };
    const pr = pGironi[p.id];
    const r  = rGironi[p.id];
    const hasResult = r && r.gol_casa != null;

    const pronTxt = pr
      ? `${pr.gol_casa ?? '?'}–${pr.gol_trasferta ?? '?'} (${pr.segno || '?'})`
      : '<span class="scheda-tbd">non pronosticata</span>';

    let resultHtml, ptiHtml, rowClass;
    if (hasResult) {
      const segnoR   = r.gol_casa > r.gol_trasferta ? '1' : r.gol_casa < r.gol_trasferta ? '2' : 'X';
      const segnoOk  = pr && pr.segno === segnoR;
      const esattoOk = pr && pr.gol_casa == r.gol_casa && pr.gol_trasferta == r.gol_trasferta;
      const pti = (segnoOk ? 10 : 0) + (esattoOk ? 5 : 0);
      rowClass = segnoOk ? 'match-ok' : 'match-ko';
      resultHtml = `
        <span class="pm-real">${r.gol_casa}–${r.gol_trasferta}</span>
        <span class="pm-sep">·</span>
        <span class="pm-pron ${segnoOk ? 'ok' : 'ko'}">${pronTxt}</span>
        ${esattoOk ? '<span class="pm-esatto">🎯</span>' : ''}`;
      ptiHtml = `<div class="pm-pts ${pti > 0 ? 'pts-pos' : ''}">${pti > 0 ? '+' + pti : '0'} pt</div>`;
    } else {
      rowClass = 'match-upcoming';
      resultHtml = `<span class="pm-pron">${pronTxt}</span>`;
      ptiHtml = `<div class="pm-pts pm-pts-attesa">⏳ da giocare</div>`;
    }

    return `
      <div class="profilo-match-row ${rowClass}">
        <div class="pm-teams">
          ${casa.flag} ${casa.nome} vs ${trasf.nome} ${trasf.flag}
          <span class="pm-quando">${quando}</span>
        </div>
        <div class="pm-result">${resultHtml}</div>
        ${ptiHtml}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="breakdown-section">
      <h3 class="section-title">⏱️ Partite di oggi <span class="text-muted">(±24h)</span>${titoloCmp}</h3>
      <div class="profilo-matches-list">${rows}</div>
    </div>`;
}

// ── SCORE CARD ────────────────────────────────────────
function _renderScoreCard(totale, pos) {
  const card = document.getElementById('profilo-score-card');
  if (!card) return;

  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const posLabel = medals[pos] || `${pos}°`;

  card.innerHTML = `
    <div class="score-card-inner">
      <div class="score-card-pos">${posLabel}</div>
      <div class="score-card-info">
        <div class="score-card-nome">${_targetNome || STATE.utente?.nome || ''}</div>
        <div class="score-card-totale">${totale} <span class="score-card-pt">pt</span></div>
      </div>
    </div>`;
}

// Costruisce l'elenco categorie (con punti) da un oggetto breakdown.
function _categorieFromBd(bd) {
  return [
    {
      label: 'Fase a gironi — Segno 1X2',
      icon: '⚽',
      punti: bd.gironi_segno.punti,
      desc: `${bd.gironi_segno.corretti}/${bd.gironi_segno.totale} segni corretti`,
    },
    {
      label: 'Fase a gironi — Risultato esatto',
      icon: '🎯',
      punti: bd.gironi_esatto.punti,
      desc: `${bd.gironi_esatto.corretti}/${bd.gironi_esatto.totale} risultati esatti`,
    },
    {
      label: 'Posto in griglia',
      icon: '📊',
      punti: bd.posto_griglia.punti,
      desc: `${bd.posto_griglia.corretti} posizioni corrette (solo squadre ai sedicesimi)`,
    },
    {
      label: 'Sedicesimi di finale',
      icon: '🏟️',
      punti: bd.sedicesimi.punti,
      desc: `${bd.sedicesimi.corretti} squadre qualificate indovinate`,
    },
    {
      label: 'Ottavi di finale',
      icon: '⚡',
      punti: bd.ottavi.punti,
      desc: `${bd.ottavi.corretti} squadre indovinate`,
    },
    {
      label: 'Quarti di finale',
      icon: '🔥',
      punti: bd.quarti.punti,
      desc: `${bd.quarti.corretti} squadre indovinate`,
    },
    {
      label: 'Semifinali',
      icon: '💥',
      punti: bd.semifinali.punti,
      desc: `${bd.semifinali.corretti} squadre indovinate`,
    },
    {
      label: 'Finaliste',
      icon: '🏆',
      punti: bd.finale.punti,
      desc: `${bd.finale.corretti} finaliste indovinate`,
    },
    {
      label: 'Vincitore torneo',
      icon: '🥇',
      punti: bd.vincitore.punti,
      desc: bd.vincitore.corretto ? 'Campione indovinato! 🎉' : 'Campione non ancora noto',
    },
    {
      label: 'Modalità passaggio turno',
      icon: '🎲',
      punti: bd.modalita.punti,
      desc: `${bd.modalita.corretti} modalità indovinate`,
    },
    {
      label: 'Capocannoniere',
      icon: '👟',
      punti: bd.capocannoniere.punti,
      desc: bd.capocannoniere.dettaglio || 'Nessun punto ancora',
    },
  ];
}

// ── BREAKDOWN CATEGORIE ───────────────────────────────
// Se bdMe è valorizzato (sto guardando un altro utente) mostra il confronto
// inline: punti miei vs punti dell'avversario, con evidenza di chi è avanti.
function _renderBreakdown(bd, bdMe = null) {
  const el = document.getElementById('profilo-breakdown');
  if (!el) return;

  const categorie = _categorieFromBd(bd);
  const cmp = !!bdMe;
  const mieCat = cmp ? _categorieFromBd(bdMe) : null;
  const nomeAvv = _nomeAvversario();

  const fmt = (n) => (n > 0 ? '+' + n : '—');
  const totale = categorie.reduce((s, c) => s + c.punti, 0);
  const totaleMe = cmp ? mieCat.reduce((s, c) => s + c.punti, 0) : 0;

  // Cella punti: singola (vista propria) o doppia (confronto).
  const cellaPunti = (puntiAvv, puntiMe) => {
    if (!cmp) {
      return `<div class="bd-pts ${puntiAvv > 0 ? 'bd-pts-pos' : ''}">${fmt(puntiAvv)}</div>`;
    }
    const meWin   = puntiMe > puntiAvv;
    const themWin = puntiAvv > puntiMe;
    return `
      <div class="bd-compare">
        <span class="bd-cmp me ${meWin ? 'cmp-win' : ''}">Tu ${fmt(puntiMe)}</span>
        <span class="bd-cmp them ${themWin ? 'cmp-win' : ''}">${nomeAvv} ${fmt(puntiAvv)}</span>
      </div>`;
  };

  el.innerHTML = `
    <div class="breakdown-section">
      <h3 class="section-title">📈 Dettaglio punteggio${cmp ? ` <span class="text-muted">· confronto con ${nomeAvv}</span>` : ''}</h3>
      <div class="breakdown-list">
        ${categorie.map((c, i) => `
          <div class="breakdown-row ${c.punti > 0 ? 'breakdown-has-pts' : ''}">
            <div class="bd-icon">${c.icon}</div>
            <div class="bd-info">
              <div class="bd-label">${c.label}</div>
              <div class="bd-desc">${c.desc}</div>
            </div>
            ${cellaPunti(c.punti, cmp ? mieCat[i].punti : 0)}
          </div>`).join('')}
        <div class="breakdown-row breakdown-total">
          <div class="bd-icon">🏅</div>
          <div class="bd-info"><div class="bd-label"><strong>Totale</strong></div></div>
          ${cmp
            ? `<div class="bd-compare bd-compare-total">
                 <span class="bd-cmp me ${totaleMe > totale ? 'cmp-win' : ''}"><strong>Tu ${totaleMe}</strong></span>
                 <span class="bd-cmp them ${totale > totaleMe ? 'cmp-win' : ''}"><strong>${nomeAvv} ${totale}</strong></span>
               </div>`
            : `<div class="bd-pts bd-pts-total"><strong>${totale}</strong></div>`}
        </div>
      </div>
    </div>`;
}

// ── DETTAGLIO PARTITE GIRONE ──────────────────────────
function _renderDettaglioGironi(bd) {
  const el = document.getElementById('profilo-partite');
  if (!el) return;

  const pGironi = _pronostici?.gironi || {};
  const rGironi = _risultati?.gironi  || {};

  const cmp = _isAltrui() && _mioPronostici;
  const titoloCmp = cmp ? ` <span class="text-muted">· confronto con ${_nomeAvversario()}</span>` : '';

  let rows = '';
  let count = 0;

  Object.entries(DB.gironi).forEach(([lettera, girone]) => {
    girone.partite.forEach(p => {
      const r = rGironi[p.id];
      if (!r || r.gol_casa == null) return; // non ancora giocata

      // In modalità confronto mostro tutte le partite giocate (anche se uno dei
      // due non l'ha pronosticata); in vista propria solo quelle pronosticate.
      if (cmp) {
        count++;
        rows += _matchCompareRow(p);
        return;
      }

      const pr = pGironi[p.id];
      if (!pr) return;

      count++;
      const casa  = DB.squadre[p.casa];
      const trasf = DB.squadre[p.trasferta];

      const segnoR = r.gol_casa > r.gol_trasferta ? '1' : r.gol_casa < r.gol_trasferta ? '2' : 'X';
      const segnoP = pr.segno || '?';
      const segnoOk = segnoP === segnoR;

      const esattoOk = pr.gol_casa == r.gol_casa && pr.gol_trasferta == r.gol_trasferta;
      const pti = (segnoOk ? 10 : 0) + (esattoOk ? 5 : 0);

      rows += `
        <div class="profilo-match-row ${segnoOk ? 'match-ok' : 'match-ko'}">
          <div class="pm-teams">
            ${casa?.flag || ''} ${casa?.nome || p.casa} vs ${trasf?.nome || p.trasferta} ${trasf?.flag || ''}
          </div>
          <div class="pm-result">
            <span class="pm-real">${r.gol_casa}–${r.gol_trasferta}</span>
            <span class="pm-sep">·</span>
            <span class="pm-pron ${segnoOk ? 'ok' : 'ko'}">${pr.gol_casa ?? '?'}–${pr.gol_trasferta ?? '?'} (${segnoP})</span>
            ${esattoOk ? '<span class="pm-esatto">🎯</span>' : ''}
          </div>
          <div class="pm-pts ${pti > 0 ? 'pts-pos' : ''}">${pti > 0 ? '+' + pti : '0'} pt</div>
        </div>`;
    });
  });

  if (!count) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚽</div><p>Le partite dei gironi non sono ancora iniziate.</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="breakdown-section">
      <h3 class="section-title">⚽ Partite giocate — girone${titoloCmp}</h3>
      <div class="profilo-matches-list">${rows}</div>
    </div>`;
}

// ── SCHEDA PRONOSTICI COMPLETA (read-only) ────────────
function _renderSchedaPronostici() {
  const el = document.getElementById('profilo-scheda-container');
  if (!el) return;
  if (!_pronostici) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Nessun pronostico trovato.</p></div>';
    return;
  }

  // Se la scheda è nascosta, i pronostici sono ancora aperti, e stiamo guardando il profilo altrui → placeholder
  // Una volta che i pronostici sono chiusi, la privacy decade e tutti possono vedere le schede
  const isAltrui = STATE.profiloUid && STATE.profiloUid !== STATE.utente?.id;
  if (isAltrui && _pronostici.pronostico_nascosto && STATE.pronosticiAperti) {
    el.innerHTML = `
      <div class="empty-state empty-state--locked">
        <div class="empty-icon">🔒</div>
        <p>Questo partecipante ha scelto di nascondere la propria scheda pronostici.</p>
      </div>`;
    return;
  }

  const pGironi = _pronostici.gironi              || {};
  const pCannon = _pronostici.capocannoniere      || {};
  const mGironi = _mioPronostici?.gironi          || {};
  const mCannon = _mioPronostici?.capocannoniere  || {};
  const rGironi = _risultati.gironi               || {};

  // Confronto sempre attivo se guardo un altro e ho compilato i miei pronostici.
  const cmp = _isAltrui() && !!_mioPronostici;
  const nomeAvv = _nomeAvversario();

  // Cella pronostico (punteggio + segno + badge vs risultato reale) per un set.
  const cellaScore = (pr, p, r) => {
    const hasResult = r?.gol_casa != null;
    const segnoR = hasResult ? (r.gol_casa > r.gol_trasferta ? '1' : r.gol_casa < r.gol_trasferta ? '2' : 'X') : null;
    const ok = pr && segnoR && pr.segno === segnoR;
    const esatto = pr && hasResult && pr.gol_casa == r.gol_casa && pr.gol_trasferta == r.gol_trasferta;
    const score = pr
      ? `<strong>${pr.gol_casa ?? '?'}–${pr.gol_trasferta ?? '?'}</strong> <span class="scheda-segno">(${pr.segno || '?'})</span>`
      : '<span class="scheda-tbd">—</span>';
    const badge = esatto ? ' 🎯' : ok ? ' ✓' : hasResult ? ' ✗' : '';
    return { html: score + badge, ok, hasResult };
  };

  // ── 1. GIRONI ──────────────────────────────────────
  let htmlGironi = '';
  Object.entries(DB.gironi).forEach(([lettera, girone]) => {
    const matchRows = girone.partite.map(p => {
      const r  = rGironi[p.id];
      const casa  = DB.squadre[p.casa]      || { nome: p.casa,      flag: '' };
      const trasf = DB.squadre[p.trasferta] || { nome: p.trasferta, flag: '' };

      const them = cellaScore(pGironi[p.id], p, r);

      if (cmp) {
        const me = cellaScore(mGironi[p.id], p, r);
        return `
          <div class="scheda-match-row scheda-match-cmp">
            <span class="scheda-team">${casa.flag} ${casa.nome}</span>
            <span class="scheda-score-cmp">
              <span class="scheda-cmp-me ${them.hasResult ? (me.ok ? 'scheda-ok' : 'scheda-ko') : ''}">Tu ${me.html}</span>
              <span class="scheda-cmp-them ${them.hasResult ? (them.ok ? 'scheda-ok' : 'scheda-ko') : ''}">${nomeAvv} ${them.html}</span>
            </span>
            <span class="scheda-team scheda-team-away">${trasf.nome} ${trasf.flag}</span>
          </div>`;
      }

      const rowClass = them.hasResult ? (them.ok ? 'scheda-ok' : 'scheda-ko') : '';
      return `
        <div class="scheda-match-row ${rowClass}">
          <span class="scheda-team">${casa.flag} ${casa.nome}</span>
          <span class="scheda-score">${them.html}</span>
          <span class="scheda-team scheda-team-away">${trasf.nome} ${trasf.flag}</span>
        </div>`;
    }).join('');

    htmlGironi += `
      <div class="scheda-girone-block">
        <div class="scheda-girone-title">Girone ${lettera}</div>
        ${matchRows}
      </div>`;
  });

  // ── 4. CAPOCANNONIERE ──────────────────────────────
  const cannonHtml = [
    { pos: 'primo',   label: '🥇 1° marcatore' },
    { pos: 'secondo', label: '🥈 2° marcatore' },
    { pos: 'terzo',   label: '🥉 3° marcatore' },
  ].map(({ pos, label }) => {
    if (cmp) {
      return `
        <div class="scheda-griglia-item">
          <span class="scheda-cannon-label">${label}</span>
          <span class="scheda-cannon-cmp">
            <span class="scheda-cmp-me">Tu: <strong>${mCannon[pos] || '—'}</strong></span>
            <span class="scheda-cmp-them">${nomeAvv}: <strong>${pCannon[pos] || '—'}</strong></span>
          </span>
        </div>`;
    }
    return `<div class="scheda-griglia-item"><span class="scheda-cannon-label">${label}</span> <strong>${pCannon[pos] || '—'}</strong></div>`;
  }).join('');

  // ── 2 & 3: Classifica pronosticata + Tabellone ─────
  // In confronto raggruppo per girone (mia | avversario affiancate dentro lo
  // stesso girone) così su mobile restano sempre vicine e leggibili.
  const sezClassifica = cmp
    ? _classificaCmpHtml(nomeAvv)
    : `<div id="scheda-riepilogo-container"></div>`;

  const sezTabellone = cmp
    ? `<div class="scheda-cmp-head me">La tua schedina</div>
       <div id="scheda-tabellone-me" class="tb-scroll-wrapper"></div>
       <div class="scheda-cmp-head them" style="margin-top:14px">Schedina di ${nomeAvv}</div>
       <div id="scheda-tabellone-them" class="tb-scroll-wrapper"></div>`
    : `<div id="scheda-tabellone-container" class="tb-scroll-wrapper"></div>`;

  // ── Struttura contenitore ──────────────────────────
  el.innerHTML = `
    <div class="scheda-section">
      <h3 class="section-title">⚽ Pronostici gironi${cmp ? ` <span class="text-muted">· Tu vs ${nomeAvv}</span>` : ''}</h3>
      <div class="scheda-gironi-grid">${htmlGironi || '<p class="text-muted">Non compilati</p>'}</div>
    </div>
    <div class="scheda-section">
      <h3 class="section-title">📊 Classifica gironi pronosticata</h3>
      ${sezClassifica}
    </div>
    <div class="scheda-section">
      <h3 class="section-title">🏟️ Tabellone eliminatorie</h3>
      ${sezTabellone}
    </div>
    <div class="scheda-section">
      <h3 class="section-title">👟 Capocannoniere</h3>
      <div class="scheda-griglia-block">${cannonHtml}</div>
    </div>`;

  // Renderizza riepilogo e tabellone nei loro container
  if (cmp) {
    // La classifica di confronto è già HTML inline (_classificaCmpHtml).
    renderTabellone(document.getElementById('scheda-tabellone-me'),   _mioPronostici, DB);
    renderTabellone(document.getElementById('scheda-tabellone-them'), _pronostici,    DB);
  } else {
    renderRiepilogoGironi(document.getElementById('scheda-riepilogo-container'), _pronostici, DB);
    renderTabellone(document.getElementById('scheda-tabellone-container'), _pronostici, DB);
  }
}

// Mini-classifica di un girone per un dato set di pronostici (stile riepilogo).
function _miniClassificaTable(lettera, pron) {
  const cl = getClassificaGirone(lettera, pron?.gironi || {}, DB);
  const hasData = cl.some(t => t.g > 0);
  let h = '<table class="riepilogo-table"><thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>GD</th></tr></thead><tbody>';
  cl.forEach((t, i) => {
    const sq = DB.squadre[t.id];
    const gdStr = t.gd >= 0 ? '+' + t.gd : '' + t.gd;
    const gdCls = t.gd > 0 ? 'gd-pos' : t.gd < 0 ? 'gd-neg' : '';
    const rowCls = i < 2 ? 'qualificata' : i === 2 ? 'terza' : '';
    h += `<tr class="${rowCls}"><td class="riepilogo-pos">${i + 1}</td>`
       + `<td class="riepilogo-team">${sq?.flag || ''} ${sq?.nome || t.id}</td>`
       + `<td class="riepilogo-pt">${hasData ? t.pt : '—'}</td>`
       + `<td class="riepilogo-gd">${hasData ? `<span class="${gdCls}">${gdStr}</span>` : '—'}</td></tr>`;
  });
  return h + '</tbody></table>';
}

// Confronto classifiche pronosticate, raggruppate per girone (mia | avversario).
function _classificaCmpHtml(nomeAvv) {
  let grid = '<div class="riepilogo-cmp-grid">';
  Object.keys(DB.gironi).forEach(lettera => {
    grid += `
      <div class="riepilogo-cmp-block">
        <div class="riepilogo-cmp-title">Girone ${lettera}</div>
        <div class="riepilogo-cmp-pair">
          <div class="riepilogo-cmp-side">
            <div class="scheda-cmp-head me">Tu</div>
            ${_miniClassificaTable(lettera, _mioPronostici)}
          </div>
          <div class="riepilogo-cmp-side">
            <div class="scheda-cmp-head them">${nomeAvv}</div>
            ${_miniClassificaTable(lettera, _pronostici)}
          </div>
        </div>
      </div>`;
  });
  return grid + '</div>';
}
