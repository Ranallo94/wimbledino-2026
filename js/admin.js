/**
 * MONDIALITO 2026 — admin.js
 * Pannello amministratore:
 * - Tab Approvazioni: approva/rifiuta nuovi iscritti
 * - Tab Risultati: verifica e correzione risultati partite
 * - Tab Partecipanti: stato schede pronostici
 * - Tab Sistema: sync manuale, apertura/chiusura pronostici, stato API
 */

import DB from '../mondialito_db.json' with { type: 'json' };
import { STATE } from './app.js';
import {
  getRisultati, patchRisultati,
  getPartecipanti, getPronostici,
  getSistema, updateSistema,
  onRisultatiSnapshot,
} from './db.js';
import { showToast, openModal, closeModal, showSpinner, formatDate } from './ui.js';
import { calcolaPunteggio, calcolaSparegnio } from './punteggi.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  collection, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const db = () => window._firebase.db;

// ── INIT ──────────────────────────────────────────────
export async function initAdmin() {
  if (!STATE.utente?.isAdmin) return;

  showSpinner('admin-risultati-container', 'Caricamento risultati…');
  showSpinner('admin-partecipanti-container', 'Caricamento partecipanti…');

  await Promise.all([
    _initTabApprovazioni(),
    _initTabRisultati(),
    _initTabMarcatori(),
    _initTabPartecipanti(),
    _initTabSistema(),
  ]);

  // Auto-ricalcolo classifica al variare dei risultati
  _initAutoRicalcolo();
}

// ── AUTO-RICALCOLO CLASSIFICA ─────────────────────────
// Ascolta risultati/ufficiali: ad ogni cambio dopo il caricamento iniziale
// ricalcola automaticamente la classifica, senza bisogno di Cloud Functions.
function _initAutoRicalcolo() {
  let primoCaricamento = true;

  onRisultatiSnapshot(async () => {
    if (primoCaricamento) {
      primoCaricamento = false;
      return; // Salta il caricamento iniziale
    }
    // Risultati cambiati → ricalcola in background
    try {
      await _ricalcolaClassificaClient();
      showToast('Classifica aggiornata ✓', 'success');
    } catch (e) {
      console.warn('[auto-ricalcolo]', e.message);
    }
  });
}

// ── TAB MARCATORI ─────────────────────────────────────
// Form editabile della classifica marcatori. "Aggiorna Marcatori" scrive
// live/marcatori, che alimenta in tempo reale il tab Risultati › Marcatori.

// Normalizza DB.squadre in mappa id → {nome, flag}, sia che l'origine
// sia un array sia che sia già un oggetto.
function _squadreMap() {
  const sq = DB.squadre;
  if (Array.isArray(sq)) return Object.fromEntries(sq.map(s => [s.id, s]));
  return sq || {};
}

function _marcSquadraOptions(selected) {
  const items = Object.values(_squadreMap())
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'it'));
  return ['<option value="">— squadra —</option>']
    .concat(items.map(s =>
      `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${s.flag || ''} ${s.nome}</option>`))
    .join('');
}

function _marcRigaHtml(m = {}) {
  const nome = (m.nome || '').replace(/"/g, '&quot;');
  return `
    <tr class="marc-edit-row">
      <td data-label="Giocatore"><input type="text" class="marc-f-nome" value="${nome}" placeholder="Nome giocatore"></td>
      <td data-label="Squadra"><select class="marc-f-squadra">${_marcSquadraOptions(m.squadra_id)}</select></td>
      <td data-label="Gol"><input type="number" class="marc-f-gol" min="0" value="${m.gol ?? 0}"></td>
      <td data-label="Assist"><input type="number" class="marc-f-assist" min="0" value="${m.assist ?? 0}"></td>
      <td data-label="Rigori"><input type="number" class="marc-f-rigori" min="0" value="${m.rigori ?? 0}"></td>
      <td><button type="button" class="btn-icon marc-del" title="Rimuovi riga">🗑️</button></td>
    </tr>`;
}

async function _initTabMarcatori() {
  const container = document.getElementById('admin-marcatori-container');
  if (!container) return;

  let lista = [];
  try {
    const snap = await getDoc(doc(db(), 'live', 'marcatori'));
    if (snap.exists()) lista = snap.data().lista || [];
  } catch (e) {
    console.warn('[marcatori] lettura iniziale:', e.message);
  }

  const righe = (lista.length ? lista : [{}]).map(_marcRigaHtml).join('');
  container.innerHTML = `
    <div class="marc-admin-card">
      <table class="marc-edit-table">
        <thead>
          <tr><th>Giocatore</th><th>Squadra</th><th>Gol</th><th>Assist</th><th>Rigori</th><th></th></tr>
        </thead>
        <tbody id="marc-edit-body">${righe}</tbody>
      </table>
      <div class="marc-admin-actions">
        <button type="button" class="btn btn-secondary marc-add">➕ Aggiungi riga</button>
        <button type="button" class="btn btn-primary marc-save">💾 Aggiorna Marcatori</button>
        <span class="marc-save-msg"></span>
      </div>
      <div class="marc-admin-sync">
        <button type="button" class="btn btn-secondary marc-sync">🔄 Sync automatico da API</button>
        <span class="text-muted">Pesca i marcatori da football-data.org. Richiede le Cloud Functions attive.</span>
      </div>
    </div>`;

  // Event delegation: registrata una sola volta sul container.
  if (container._marcWired) return;
  container._marcWired = true;
  container.addEventListener('click', async (e) => {
    if (e.target.closest('.marc-add')) {
      document.getElementById('marc-edit-body')
        ?.insertAdjacentHTML('beforeend', _marcRigaHtml());
    } else if (e.target.closest('.marc-del')) {
      const tr = e.target.closest('tr');
      const body = document.getElementById('marc-edit-body');
      if (body && body.querySelectorAll('tr').length > 1) {
        tr.remove();
      } else {
        // Ultima riga: svuotala invece di rimuoverla.
        tr.querySelectorAll('input').forEach(i => { i.value = i.type === 'number' ? 0 : ''; });
        const sel = tr.querySelector('select'); if (sel) sel.value = '';
      }
    } else if (e.target.closest('.marc-save')) {
      await _salvaMarcatori(e.target.closest('.marc-save'));
    } else if (e.target.closest('.marc-sync')) {
      await _syncMarcatoriApi(e.target.closest('.marc-sync'));
    }
  });
}

async function _salvaMarcatori(btn) {
  const map = _squadreMap();
  const rows = [...document.querySelectorAll('#marc-edit-body tr')];

  let lista = rows.map(tr => ({
    nome:       tr.querySelector('.marc-f-nome').value.trim(),
    squadra_id: tr.querySelector('.marc-f-squadra').value,
    gol:        parseInt(tr.querySelector('.marc-f-gol').value, 10) || 0,
    assist:     parseInt(tr.querySelector('.marc-f-assist').value, 10) || 0,
    rigori:     parseInt(tr.querySelector('.marc-f-rigori').value, 10) || 0,
  })).filter(m => m.nome);

  // Ordina per gol, poi assist; assegna posizione a pari merito (stesso gol → stessa pos).
  lista.sort((a, b) => (b.gol - a.gol) || (b.assist - a.assist));
  let posCorrente = 0;
  let golPrec = null;
  lista = lista.map((m, i) => {
    if (m.gol !== golPrec) { posCorrente = i + 1; golPrec = m.gol; }
    return {
      pos:          posCorrente,
      nome:         m.nome,
      squadra_id:   m.squadra_id,
      squadra_nome: map[m.squadra_id]?.nome || '',
      gol:          m.gol,
      assist:       m.assist,
      rigori:       m.rigori,
    };
  });

  const msg = document.querySelector('.marc-save-msg');
  btn.disabled = true; btn.textContent = '⏳ Salvataggio…';
  try {
    await setDoc(doc(db(), 'live', 'marcatori'), {
      lista,
      updatedAt: serverTimestamp(),
    });
    showToast('Marcatori aggiornati!', 'success');
    // Ricarica la tabella con i dati appena salvati: le righe si riordinano
    // automaticamente per gol (chi ha segnato di più finisce in cima).
    await _initTabMarcatori();
    const msgNew = document.querySelector('.marc-save-msg');
    if (msgNew) { msgNew.textContent = `✓ Salvati ${lista.length} marcatori`; msgNew.className = 'marc-save-msg ok'; }
  } catch (e) {
    if (msg) { msg.textContent = '❌ ' + e.message; msg.className = 'marc-save-msg err'; }
    showToast('Errore salvataggio: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Aggiorna Marcatori';
  }
}

async function _syncMarcatoriApi(btn) {
  btn.disabled = true; btn.textContent = '⏳ Sync…';
  try {
    const fn = httpsCallable(window._firebase.functions, 'syncMarcatori');
    const res = await fn();
    showToast(`Sync completato — ${res.data?.count ?? 0} marcatori dall'API`, 'success');
    await _initTabMarcatori(); // ricarica la tabella con i dati freschi
  } catch (e) {
    showToast('Sync non riuscito: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🔄 Sync automatico da API';
  }
}

// ── TAB APPROVAZIONI ──────────────────────────────────
let _unsubApprov = null;

async function _initTabApprovazioni() {
  const container = document.getElementById('admin-approvazioni-container');
  if (!container) return;

  // Ascolta in real-time le richieste in attesa
  _unsubApprov = onSnapshot(
    query(collection(db(), 'partecipanti'), where('approvato', '==', false)),
    (snap) => {
      _renderApprovazioni(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      // Aggiorna badge contatore nel tab
      const badge = document.getElementById('approv-badge');
      if (badge) {
        badge.textContent = snap.size;
        badge.style.display = snap.size > 0 ? '' : 'none';
      }
    }
  );
}

function _renderApprovazioni(richieste) {
  const container = document.getElementById('admin-approvazioni-container');
  if (!container) return;

  if (!richieste.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <p>Nessuna richiesta in attesa.</p>
      </div>`;
    return;
  }

  const rows = richieste.map(r => {
    const data = r.richiestaAt?.toDate
      ? r.richiestaAt.toDate().toLocaleString('it-IT')
      : '—';
    return `
      <div class="approv-card" id="approv-${r.id}">
        <div class="approv-info">
          <div class="approv-nome">${r.nome} ${r.cognome || ''}</div>
          <div class="approv-meta">
            📱 ${r.telefono || '—'}
            &nbsp;·&nbsp;
            ✉️ ${r.email || '—'}
            &nbsp;·&nbsp;
            🕐 ${data}
          </div>
        </div>
        <div class="approv-actions">
          <button class="btn btn-sm btn-primary" onclick="window._approva('${r.id}', '${(r.nome + ' ' + (r.cognome||'')).trim()}')">
            ✅ Approva
          </button>
          <button class="btn btn-sm btn-danger" onclick="window._rifiuta('${r.id}', '${(r.nome + ' ' + (r.cognome||'')).trim()}')">
            ❌ Rifiuta
          </button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="info-banner info-banner--yellow" style="margin-bottom:16px">
      <span>🔔</span>
      <span><strong>${richieste.length}</strong> richiesta${richieste.length > 1 ? 'e' : ''} in attesa di approvazione.</span>
    </div>
    <div class="approv-list">${rows}</div>`;

  // Bind globali
  window._approva = async (uid, nome) => {
    try {
      await updateDoc(doc(db(), 'partecipanti', uid), { approvato: true });
      showToast(`${nome} approvato! ✅`, 'success');
    } catch (e) {
      showToast('Errore: ' + e.message, 'error');
    }
  };

  window._rifiuta = (uid, nome) => {
    openModal({
      title: 'Rifiuta richiesta',
      body: `<p>Vuoi rifiutare ed eliminare la richiesta di <strong>${nome}</strong>? L'operazione è irreversibile.</p>`,
      buttons: [
        {
          label: 'Sì, rifiuta',
          cls: 'btn btn-danger',
          onClick: async () => {
            try {
              await deleteDoc(doc(db(), 'partecipanti', uid));
              // Elimina anche l'utente Auth tramite callable function
              const fn = httpsCallable(window._firebase.functions, 'eliminaUtente');
              await fn({ uid }).catch(() => {}); // non blocca se fallisce
              showToast(`Richiesta di ${nome} rifiutata.`, 'info');
              closeModal();
            } catch (e) {
              showToast('Errore: ' + e.message, 'error');
            }
          },
        },
        { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
      ],
    });
  };
}

// ── TAB RISULTATI ─────────────────────────────────────
let _unsubRis = null;

async function _initTabRisultati() {
  _unsubRis = onRisultatiSnapshot((ris) => {
    _renderRisultati(ris);
  });
}

function _renderRisultati(risultati) {
  const container = document.getElementById('admin-risultati-container');
  if (!container) return;

  const rGironi = risultati?.gironi || {};
  let html = '';

  Object.entries(DB.gironi).forEach(([lettera, girone]) => {
    const partiteHtml = girone.partite.map(p => {
      const r = rGironi[p.id] || {};
      const casa  = DB.squadre[p.casa];
      const trasf = DB.squadre[p.trasferta];
      const hasResult = r.gol_casa != null && r.gol_trasferta != null;

      return `
        <div class="admin-match-row" data-id="${p.id}">
          <div class="admin-match-teams">
            ${casa?.flag || ''} ${casa?.nome || p.casa}
            <span class="admin-score ${hasResult ? 'score-set' : 'score-tbd'}">
              ${hasResult ? `${r.gol_casa} — ${r.gol_trasferta}` : '—'}
            </span>
            ${trasf?.nome || p.trasferta} ${trasf?.flag || ''}
          </div>
          <div class="admin-match-actions">
            <span class="admin-api-badge ${hasResult ? 'badge-ok' : 'badge-pending'}">
              ${hasResult ? '✅ API' : '⏳ In attesa'}
            </span>
            <button class="btn btn-sm btn-secondary" onclick="window._adminEditMatch('${p.id}', 'gironi')">
              ✏️ Correggi
            </button>
          </div>
        </div>`;
    }).join('');

    html += `
      <div class="admin-girone-block">
        <div class="admin-girone-header">Girone ${lettera}</div>
        ${partiteHtml}
      </div>`;
  });

  container.innerHTML = html || '<p class="text-muted">Nessuna partita.</p>';

  // Bind globale per i pulsanti correggi (genera modal)
  window._adminEditMatch = (matchId, tipo) => _apriModalCorreggi(matchId, tipo, risultati);
}

function _apriModalCorreggi(matchId, tipo, risultati) {
  const r = risultati?.gironi?.[matchId] || {};

  // Trova la partita nel DB
  let partita = null;
  for (const [, girone] of Object.entries(DB.gironi)) {
    partita = girone.partite.find(p => p.id === matchId);
    if (partita) break;
  }

  if (!partita) {
    showToast('Partita non trovata.', 'error');
    return;
  }

  const casa  = DB.squadre[partita.casa];
  const trasf = DB.squadre[partita.trasferta];

  openModal({
    title: `Correggi risultato`,
    body: `
      <div class="modal-match-title">
        ${casa?.flag || ''} ${casa?.nome || partita.casa}
        &nbsp;vs&nbsp;
        ${trasf?.nome || partita.trasferta} ${trasf?.flag || ''}
      </div>
      <div class="modal-form">
        <div class="field-group">
          <label class="field-label">Gol ${casa?.nome || 'Casa'}</label>
          <input type="number" id="modal-gol-casa" class="field-input" min="0" max="30"
            value="${r.gol_casa ?? ''}">
        </div>
        <div class="field-group">
          <label class="field-label">Gol ${trasf?.nome || 'Trasferta'}</label>
          <input type="number" id="modal-gol-trasf" class="field-input" min="0" max="30"
            value="${r.gol_trasferta ?? ''}">
        </div>
        <p class="modal-note">⚠️ Questo sovrascrive il dato automatico da API.</p>
      </div>`,
    buttons: [
      {
        label: 'Salva',
        cls: 'btn btn-primary',
        onClick: async () => {
          const gc = parseInt(document.getElementById('modal-gol-casa').value);
          const gt = parseInt(document.getElementById('modal-gol-trasf').value);

          if (isNaN(gc) || isNaN(gt)) {
            showToast('Inserisci entrambi i gol.', 'error');
            return;
          }

          try {
            await patchRisultati({
              [`gironi.${matchId}.gol_casa`]: gc,
              [`gironi.${matchId}.gol_trasferta`]: gt,
              [`gironi.${matchId}.fonte`]: 'admin_manual',
              [`gironi.${matchId}.updatedAt`]: new Date().toISOString(),
            });
            showToast('Risultato aggiornato!', 'success');
            closeModal();
          } catch (e) {
            showToast('Errore: ' + e.message, 'error');
          }
        },
      },
      { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
    ],
  });
}

// ── VALIDAZIONE SCHEDA ───────────────────────────────
const _SEDICESIMI_IDS = ['S01','S02','S03','S04','S05','S06','S07','S08',
                         'S09','S10','S11','S12','S13','S14','S15','S16'];
const _OTTAVI_IDS     = ['O1','O2','O3','O4','O5','O6','O7','O8'];
const _QUARTI_IDS     = ['Q1','Q2','Q3','Q4'];
const _SEMIFINALI_IDS = ['SF1','SF2'];

function _validaScheda(pr) {
  if (!pr) return { completa: false, issues: ['Nessuna scheda salvata'], ok: [], pct: 0 };

  const issues = [];
  const ok     = [];

  // 1. Gironi (72 partite)
  const gironi = pr?.gironi || {};
  const mancGironi = [];
  Object.keys(DB.gironi).forEach(l => {
    const girone = DB.gironi[l];
    if (!girone) return;
    girone.partite.forEach(p => {
      const g = gironi[p.id];
      if (!g || g.gol_casa === '' || g.gol_casa == null ||
                g.gol_trasferta === '' || g.gol_trasferta == null ||
                isNaN(Number(g.gol_casa)) || isNaN(Number(g.gol_trasferta))) {
        mancGironi.push(p.id);
      }
    });
  });
  if (mancGironi.length === 0) ok.push('Gironi 72/72');
  else issues.push(`Gironi: ${72 - mancGironi.length}/72 — mancanti: ${mancGironi.join(', ')}`);

  // 2. Fase eliminatoria
  const fe = pr?.fase_eliminatoria || {};

  const mancSed = _SEDICESIMI_IDS.filter(id => !fe.sedicesimi?.[id]?.vincitore);
  if (mancSed.length === 0) ok.push('Sedicesimi 16/16');
  else issues.push(`Sedicesimi: ${16 - mancSed.length}/16 — mancanti: ${mancSed.join(', ')}`);

  const mancOtt = _OTTAVI_IDS.filter(id => !fe.ottavi?.[id]?.vincitore);
  if (mancOtt.length === 0) ok.push('Ottavi 8/8');
  else issues.push(`Ottavi: ${8 - mancOtt.length}/8 — mancanti: ${mancOtt.join(', ')}`);

  const mancQuar = _QUARTI_IDS.filter(id => !fe.quarti?.[id]?.vincitore);
  if (mancQuar.length === 0) ok.push('Quarti 4/4');
  else issues.push(`Quarti: ${4 - mancQuar.length}/4 — mancanti: ${mancQuar.join(', ')}`);

  const mancSemi = _SEMIFINALI_IDS.filter(id => !fe.semifinali?.[id]?.vincitore);
  if (mancSemi.length === 0) ok.push('Semifinali 2/2');
  else issues.push(`Semifinali: ${2 - mancSemi.length}/2 — mancanti: ${mancSemi.join(', ')}`);

  if (fe.finale?.F?.vincitore || fe.finale?.vincitore) ok.push('Finale');
  else issues.push('Finale: non compilato');

  // 4. Capocannoniere
  const cap = pr?.capocannoniere || {};
  const mancCap = ['primo','secondo','terzo'].filter(k => !cap[k]);
  if (mancCap.length === 0) ok.push('Capocannoniere 3/3');
  else issues.push(`Capocannoniere: ${3 - mancCap.length}/3 — mancanti: ${mancCap.join(', ')}`);

  const totSezioni = ok.length + issues.length;
  const pct = totSezioni > 0 ? Math.round((ok.length / totSezioni) * 100) : 0;

  return { completa: issues.length === 0, issues, ok, pct };
}

// ── TAB PARTECIPANTI ──────────────────────────────────
async function _initTabPartecipanti() {
  await _renderPartecipanti();
}

async function _renderPartecipanti() {
  const container = document.getElementById('admin-partecipanti-container');
  if (!container) return;

  try {
    const { collection, getDocs } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
    );

    // Carica partecipanti e tutti i pronostici in parallelo (batch)
    const [partecipanti, proSnap] = await Promise.all([
      getPartecipanti(),
      getDocs(collection(db(), 'pronostici')),
    ]);

    const pronosticiMap = {};
    proSnap.forEach(d => { pronosticiMap[d.id] = d.data(); });

    const schede = partecipanti.map(p => {
      const pr = pronosticiMap[p.id] || null;
      const validazione = _validaScheda(pr);
      return { ...p, pr, validazione, updatedAt: pr?.updatedAt };
    });

    const rows = schede.map(p => {
      const { completa, issues, ok, pct } = p.validazione;
      const stato = !p.pr
        ? `<span class="badge-pending">❌ Non compilata</span>`
        : completa
          ? `<span class="badge-ok">✅ Completa</span>`
          : `<span class="badge-warning">⚠️ Incompleta (${issues.length} sezioni)</span>`;

      const aggiornato = p.updatedAt?.toDate
        ? p.updatedAt.toDate().toLocaleString('it-IT')
        : p.updatedAt || '—';

      const isSelf    = p.id === STATE.utente?.id;
      const isOwner   = !!p.isOwner;
      const isDisab   = !!p.disabilitato;

      const adminBtn = isOwner ? '' : p.isAdmin
        ? `<button class="btn btn-sm btn-secondary" data-uid="${p.id}" data-action="revoca-admin" ${isSelf ? 'disabled title="Non puoi revocare te stesso"' : ''}>Revoca admin</button>`
        : `<button class="btn btn-sm btn-secondary" data-uid="${p.id}" data-action="promuovi-admin">⭐ Promuovi</button>`;

      const disabBtn = isOwner || isSelf ? '' : isDisab
        ? `<button class="btn btn-sm btn-ok" data-uid="${p.id}" data-action="riabilita">✅ Riabilita</button>`
        : `<button class="btn btn-sm btn-warning" data-uid="${p.id}" data-action="disabilita">🚫 Disabilita</button>`;

      const deleteBtn = isOwner || isSelf ? ''
        : `<button class="btn btn-sm btn-danger" data-uid="${p.id}" data-action="elimina">🗑️ Elimina</button>`;

      const nickBtn = `<button class="btn btn-sm btn-secondary" data-uid="${p.id}" data-action="nickname" data-current="${p.nickname || ''}">✏️ Nickname</button>`;

      const dettaglioBtn = (!p.pr || !completa)
        ? `<button class="btn btn-sm btn-secondary" data-uid="${p.id}" data-action="scheda-dettaglio">🔍 Dettaglio</button>`
        : '';

      const tel = (p.telefono || '').replace(/[\s\-().]/g, '');
      const waNum = tel.startsWith('+') ? tel.slice(1) : tel.startsWith('00') ? tel.slice(2) : tel ? '39' + tel : '';
      const waBtn = waNum
        ? `<a class="btn btn-sm btn-wa" href="https://wa.me/${waNum}" target="_blank" rel="noopener">💬 WhatsApp</a>`
        : '';

      const badgeDisab = isDisab ? ' <span class="badge-disab">Disabilitato</span>' : '';
      const badgeLabel = isOwner ? ' <span class="badge-owner">👑 Proprietario</span>'
                       : p.isAdmin ? ' <span class="badge-admin">Admin</span>' : '';
      const nicknameLabel = p.nickname
        ? `<span class="ap-nickname">"${p.nickname}"</span> `
        : '';

      return `
        <div class="admin-partecipante-row${isDisab ? ' ap-row-disab' : ''}">
          <div class="ap-info">
            <span class="ap-nome">${nicknameLabel}${p.nome} ${p.cognome || ''}${badgeLabel}${badgeDisab}</span>
            <span class="ap-stato">${stato}</span>
            ${p.pr ? `<span class="ap-date">Salvato: ${aggiornato}</span>` : ''}
          </div>
          <div class="ap-actions">${waBtn} ${dettaglioBtn} ${nickBtn} ${adminBtn} ${disabBtn} ${deleteBtn}</div>
        </div>`;
    }).join('');

    const nComplete   = schede.filter(p => p.validazione.completa).length;
    const nParziali   = schede.filter(p => p.pr && !p.validazione.completa).length;
    const nAssenti    = schede.filter(p => !p.pr).length;

    container.innerHTML = `
      <div class="admin-partecipanti-header">
        ${partecipanti.length} partecipanti —
        ✅ ${nComplete} complete · ⚠️ ${nParziali} parziali · ❌ ${nAssenti} assenti
      </div>
      <div class="admin-partecipanti-search-wrap">
        <input type="search" id="admin-partecipanti-search" class="admin-search-input"
               placeholder="🔍 Cerca per nome, nickname…" autocomplete="off">
      </div>
      <div class="admin-partecipanti-list">${rows}</div>`;

    // Ricerca live
    const searchInput = container.querySelector('#admin-partecipanti-search');
    const listEl = container.querySelector('.admin-partecipanti-list');
    const allRows = listEl.querySelectorAll('.admin-partecipante-row');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      allRows.forEach(row => {
        const text = row.querySelector('.ap-nome')?.textContent.toLowerCase() || '';
        row.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    });
    searchInput.focus();

    // Gestione clic pulsanti admin
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid    = btn.dataset.uid;
        const action = btn.dataset.action;
        const p      = schede.find(s => s.id === uid);
        const nome   = `${p?.nome || ''} ${p?.cognome || ''}`.trim();

        if (action === 'scheda-dettaglio') {
          const { validazione } = p;
          const okHtml = validazione.ok.map(s =>
            `<li class="scheda-det-ok">✅ ${s}</li>`).join('');
          const issueHtml = validazione.issues.map(s =>
            `<li class="scheda-det-issue">⚠️ ${s}</li>`).join('');
          const body = validazione.issues.length === 0
            ? `<p style="color:var(--color-success)">Scheda completamente compilata!</p><ul class="scheda-det-list">${okHtml}</ul>`
            : `<ul class="scheda-det-list">${issueHtml}${okHtml}</ul>`;
          openModal({
            title: `Scheda — ${nome}`,
            body: `<div style="max-height:360px;overflow-y:auto">${body}</div>`,
            buttons: [{ label: 'Chiudi', cls: 'btn btn-secondary', onClick: closeModal }],
          });
        }

        if (action === 'nickname') {
          const current = btn.dataset.current || '';
          const inputId = 'modal-nickname-input';
          openModal({
            title: `Nickname — ${nome}`,
            body: `
              <p style="margin-bottom:12px;color:var(--text-muted);font-size:13px">
                Questo nome sarà visibile nella classifica e nelle schede pronostici.
              </p>
              <input id="${inputId}" type="text" class="field-input"
                value="${current}" maxlength="20"
                placeholder="es. Roby, Il Fenomeno, MrGol…"
                style="width:100%">`,
            buttons: [
              {
                label: 'Salva',
                cls: 'btn btn-primary',
                onClick: async () => {
                  const newNick = document.getElementById(inputId)?.value.trim();
                  if (!newNick) { showToast('Il nickname non può essere vuoto.', 'error'); return; }
                  try {
                    await updateDoc(doc(db(), 'partecipanti', uid), { nickname: newNick });
                    closeModal();
                    _renderPartecipanti();
                    // Ricalcola classifica in background per aggiornare il nickname
                    await _ricalcolaClassificaClient();
                    showToast(`Nickname aggiornato: "${newNick}" ✓`, 'success');
                  } catch (e) {
                    showToast('Errore: ' + e.message, 'error');
                  }
                },
              },
              { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
            ],
          });
          // Focus automatico sull'input appena la modal è aperta
          setTimeout(() => {
            const inp = document.getElementById(inputId);
            if (inp) { inp.focus(); inp.select(); }
          }, 50);
        }

        if (action === 'promuovi-admin') {
          openModal({
            title: 'Promuovi ad admin',
            body: `<p>Vuoi promuovere <strong>${nome}</strong> ad amministratore?<br>Potrà accedere al pannello admin e gestire i risultati.</p>`,
            buttons: [
              {
                label: 'Sì, promuovi',
                cls: 'btn btn-primary',
                onClick: async () => {
                  try {
                    await updateDoc(doc(db(), 'partecipanti', uid), { isAdmin: true });
                    showToast(`${nome} è ora admin ⭐`, 'success');
                    closeModal();
                    _renderPartecipanti();
                  } catch (e) {
                    showToast('Errore: ' + e.message, 'error');
                  }
                },
              },
              { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
            ],
          });
        }

        if (action === 'revoca-admin') {
          openModal({
            title: 'Revoca admin',
            body: `<p>Vuoi revocare i privilegi di amministratore a <strong>${nome}</strong>?</p>`,
            buttons: [
              {
                label: 'Sì, revoca',
                cls: 'btn btn-danger',
                onClick: async () => {
                  try {
                    await updateDoc(doc(db(), 'partecipanti', uid), { isAdmin: false });
                    showToast(`Privilegi admin revocati a ${nome}`, 'info');
                    closeModal();
                    _renderPartecipanti();
                  } catch (e) {
                    showToast('Errore: ' + e.message, 'error');
                  }
                },
              },
              { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
            ],
          });
        }

        if (action === 'disabilita') {
          openModal({
            title: 'Disabilita account',
            body: `<p>Vuoi disabilitare l'account di <strong>${nome}</strong>?<br>L'utente non potrà più accedere all'app ma i suoi dati resteranno intatti. Potrai riabilitarlo in qualsiasi momento.</p>`,
            buttons: [
              {
                label: 'Sì, disabilita',
                cls: 'btn btn-warning',
                onClick: async () => {
                  try {
                    await updateDoc(doc(db(), 'partecipanti', uid), { disabilitato: true });
                    showToast(`Account di ${nome} disabilitato`, 'info');
                    closeModal();
                    _renderPartecipanti();
                  } catch (e) {
                    showToast('Errore: ' + e.message, 'error');
                  }
                },
              },
              { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
            ],
          });
        }

        if (action === 'riabilita') {
          try {
            await updateDoc(doc(db(), 'partecipanti', uid), { disabilitato: false });
            showToast(`Account di ${nome} riabilitato ✅`, 'success');
            _renderPartecipanti();
          } catch (e) {
            showToast('Errore: ' + e.message, 'error');
          }
        }

        if (action === 'elimina') {
          openModal({
            title: 'Elimina utente',
            body: `<p>Vuoi eliminare definitivamente <strong>${nome}</strong>?<br>Verranno cancellati il profilo e i pronostici. L'operazione è <strong>irreversibile</strong>.</p>`,
            buttons: [
              {
                label: 'Sì, elimina',
                cls: 'btn btn-danger',
                onClick: async () => {
                  try {
                    await deleteDoc(doc(db(), 'partecipanti', uid));
                    // Prova a eliminare anche i pronostici
                    try { await deleteDoc(doc(db(), 'pronostici', uid)); } catch (_) {}
                    // Prova a eliminare da Auth (richiede Cloud Function)
                    try {
                      const fn = httpsCallable(window._firebase.functions, 'eliminaUtente');
                      await fn({ uid });
                    } catch (_) {}
                    showToast(`${nome} eliminato`, 'info');
                    closeModal();
                    _renderPartecipanti();
                  } catch (e) {
                    showToast('Errore: ' + e.message, 'error');
                  }
                },
              },
              { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
            ],
          });
        }
      });
    });

  } catch (e) {
    container.innerHTML = `<p class="text-muted">Errore caricamento: ${e.message}</p>`;
  }
}

// ── TAB SISTEMA ───────────────────────────────────────
async function _initTabSistema() {
  try {
    const cfg = await getSistema();
    await _initSparteggioTerze(cfg);

    // Stato pronostici
    const statusEl = document.getElementById('sistema-pronostici-status');
    if (statusEl) {
      statusEl.textContent = cfg.pronostici_aperti !== false
        ? '✅ Aperti — i partecipanti possono modificare'
        : '🔒 Chiusi — il torneo è iniziato';
    }

    // Pulsante apri/chiudi
    const btnToggle = document.getElementById('btn-toggle-pronostici');
    if (btnToggle) {
      btnToggle.addEventListener('click', async () => {
        if (btnToggle.disabled) return;
        btnToggle.disabled = true;
        btnToggle.textContent = '⏳ …';
        try {
          // Legge stato fresco da Firestore per evitare stale closure
          const cfgFresco = await getSistema();
          const nuovoStato = cfgFresco.pronostici_aperti === false ? true : false;
          await updateSistema({ pronostici_aperti: nuovoStato });
          cfg.pronostici_aperti = nuovoStato;
          if (statusEl) {
            statusEl.textContent = nuovoStato
              ? '✅ Aperti — i partecipanti possono modificare'
              : '🔒 Chiusi — il torneo è iniziato';
          }
          showToast(nuovoStato ? 'Pronostici aperti!' : 'Pronostici chiusi!', 'success');
        } catch (e) {
          showToast('Errore: ' + e.message, 'error');
        } finally {
          btnToggle.disabled = false;
          btnToggle.textContent = 'Apri / Chiudi';
        }
      });
    }

    // Sync manuale
    const btnSync = document.getElementById('btn-sync-now');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        btnSync.disabled = true;
        btnSync.textContent = '⏳ Sincronizzazione…';
        try {
          const fn = httpsCallable(window._firebase.functions, 'syncManuale');
          await fn();
          showToast('Sincronizzazione completata!', 'success');
        } catch (e) {
          showToast('Errore sync: ' + e.message, 'error');
        } finally {
          btnSync.disabled = false;
          btnSync.textContent = 'Sincronizza ora';
        }
      });
    }

    // Stato API
    const apiEl = document.getElementById('sistema-api-status');
    const btnApi = document.getElementById('btn-check-api');
    if (btnApi && apiEl) {
      btnApi.addEventListener('click', async () => {
        apiEl.textContent = '⏳ Verifica in corso…';
        try {
          const fn = httpsCallable(window._firebase.functions, 'checkApiStatus');
          const res = await fn();
          apiEl.textContent = res.data?.ok ? '✅ API raggiungibile' : '❌ API non raggiungibile';
        } catch (e) {
          apiEl.textContent = '❌ Errore: ' + e.message;
        }
      });
    }

    // Ricalcola classifica
    const btnRicalcola = document.getElementById('btn-ricalcola-classifica');
    const classiEl = document.getElementById('sistema-classifica-status');
    if (btnRicalcola) {
      btnRicalcola.addEventListener('click', async () => {
        btnRicalcola.disabled = true;
        btnRicalcola.textContent = '⏳ Calcolo in corso…';
        if (classiEl) classiEl.textContent = '⏳ Ricalcolo…';
        try {
          await _ricalcolaClassificaClient();
          if (classiEl) classiEl.textContent = '✅ Classifica aggiornata';
          showToast('Classifica aggiornata!', 'success');
        } catch (e) {
          if (classiEl) classiEl.textContent = '❌ Errore: ' + e.message;
          showToast('Errore ricalcolo: ' + e.message, 'error');
        } finally {
          btnRicalcola.disabled = false;
          btnRicalcola.textContent = 'Ricalcola classifica';
        }
      });
    }

  } catch (e) {
    console.warn('Errore init sistema:', e);
  }
}

// ── SPAREGGIO MIGLIORI TERZE ──────────────────────────

async function _initSparteggioTerze(cfg) {
  const container = document.getElementById('spareggio-terze-container');
  if (!container) return;

  // Carica risultati reali per calcolare le terze classificate
  let risultati = {};
  try { risultati = await getRisultati(); } catch (e) {}

  // Per ogni girone, calcola la classifica e prendi la 3ª
  const terze = [];
  Object.entries(DB.gironi).forEach(([lettera, girone]) => {
    const stats = {};
    girone.squadre.forEach(id => { stats[id] = { pt: 0, g: 0, gf: 0, gs: 0, gd: 0 }; });
    girone.partite.forEach(p => {
      const r = risultati?.gironi?.[p.id];
      if (r?.gol_casa == null || r?.gol_trasferta == null) return;
      const gc = r.gol_casa, gt = r.gol_trasferta;
      stats[p.casa].g++;    stats[p.trasferta].g++;
      stats[p.casa].gf    += gc; stats[p.casa].gs    += gt; stats[p.casa].gd    += gc - gt;
      stats[p.trasferta].gf += gt; stats[p.trasferta].gs += gc; stats[p.trasferta].gd += gt - gc;
      if (gc > gt)      stats[p.casa].pt += 3;
      else if (gc < gt) stats[p.trasferta].pt += 3;
      else { stats[p.casa].pt++; stats[p.trasferta].pt++; }
    });
    const cl = girone.squadre
      .map(id => ({ id, lettera, ...stats[id] }))
      .sort((a, b) => b.pt - a.pt || b.gd - a.gd || b.gf - a.gf);
    if (cl.length >= 3) terze.push(cl[2]);
  });

  // Ordina automaticamente pt → GD → GF
  terze.sort((a, b) => b.pt - a.pt || b.gd - a.gd || b.gf - a.gf);

  // Applica override salvato (se presente e coerente)
  const override = cfg.spareggio_terze || [];
  let ordered = [...terze];
  if (override.length === terze.length) {
    const byId = Object.fromEntries(terze.map(t => [t.id, t]));
    const fromOverride = override.map(id => byId[id]).filter(Boolean);
    if (fromOverride.length === terze.length) ordered = fromOverride;
  }

  _renderSparteggioTerze(ordered);

  document.getElementById('btn-salva-spareggio')?.addEventListener('click', async () => {
    const items = document.querySelectorAll('.spareggio-item');
    const newOrder = [...items].map(el => el.dataset.teamId);
    const msgEl = document.getElementById('spareggio-save-msg');
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'spareggio-save-msg'; }
    try {
      await updateSistema({ spareggio_terze: newOrder });
      // Salva anche in risultati/ufficiali: il motore punteggi legge da lì
      await patchRisultati({ spareggio_terze: newOrder });
      cfg.spareggio_terze = newOrder;
      if (msgEl) { msgEl.textContent = '✓ Ordine salvato!'; msgEl.classList.add('ssm-ok'); }
      setTimeout(() => { if (msgEl) { msgEl.textContent = ''; msgEl.className = 'spareggio-save-msg'; } }, 3000);
    } catch (e) {
      if (msgEl) { msgEl.textContent = '✗ Errore: ' + e.message; msgEl.classList.add('ssm-error'); }
    }
  });
}

function _renderSparteggioTerze(terze) {
  const container = document.getElementById('spareggio-terze-container');
  if (!container) return;

  if (!terze.length) {
    container.innerHTML = '<p class="text-muted">Nessun risultato disponibile — le terze classificate saranno visibili a gironi completati.</p>';
    return;
  }

  // Individua squadre in parità perfetta (pt + GD + GF uguali a un vicino)
  const key = t => `${t.pt}_${t.gd}_${t.gf}`;
  const tied = new Set();
  for (let i = 0; i < terze.length - 1; i++) {
    if (key(terze[i]) === key(terze[i + 1])) {
      tied.add(terze[i].id);
      tied.add(terze[i + 1].id);
    }
  }

  const rows = terze.map((t, i) => {
    const sq = DB.squadre[t.id];
    const gdStr = (t.gd >= 0 ? '+' : '') + t.gd;
    const isTied = tied.has(t.id);
    const qualBadge = i < 8
      ? '<span class="sp-q" title="Qualificata">✓</span>'
      : '<span class="sp-nq" title="Eliminata">✗</span>';
    const noData = t.g === 0 ? '<span class="sp-nodata">nessun risultato</span>' : '';
    return `
      <div class="spareggio-item${isTied ? ' spareggio-tied' : ''}" data-team-id="${t.id}">
        <div class="spareggio-pos">${qualBadge} ${i + 1}</div>
        <div class="spareggio-team">
          ${sq?.flag || ''} <strong>${t.id}</strong>
          <span class="sp-nome">${sq?.nome || ''}</span>
          <span class="sp-girone">Girone ${t.lettera}</span>
        </div>
        <div class="spareggio-stats">
          <span><strong>${t.pt}</strong> pt</span>
          <span>${gdStr} GD</span>
          <span>${t.gf} GF</span>
          ${noData}
        </div>
        <div class="spareggio-actions">
          <button type="button" class="btn-sp btn-sp-up" title="Sposta su" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="btn-sp btn-sp-down" title="Sposta giù" ${i === terze.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="spareggio-list">${rows}</div>`;

  // Bind pulsanti ▲▼ con delegazione eventi
  container.addEventListener('click', e => {
    const up   = e.target.closest('.btn-sp-up');
    const down = e.target.closest('.btn-sp-down');
    if (!up && !down) return;
    const item = (up || down).closest('.spareggio-item');
    const list = item.parentElement;
    const items = [...list.querySelectorAll('.spareggio-item')];
    const idx = items.indexOf(item);
    if (up && idx > 0) {
      list.insertBefore(item, items[idx - 1]);
    } else if (down && idx < items.length - 1) {
      list.insertBefore(items[idx + 1], item);
    }
    // Aggiorna posizioni, badge e stato pulsanti
    [...list.querySelectorAll('.spareggio-item')].forEach((el, i, arr) => {
      const q = i < 8
        ? '<span class="sp-q" title="Qualificata">✓</span>'
        : '<span class="sp-nq" title="Eliminata">✗</span>';
      el.querySelector('.spareggio-pos').innerHTML = `${q} ${i + 1}`;
      el.querySelector('.btn-sp-up').disabled   = i === 0;
      el.querySelector('.btn-sp-down').disabled = i === arr.length - 1;
    });
  });
}

// ── RICALCOLO CLASSIFICA (client-side) ────────────────
/**
 * Legge pronostici + partecipanti + risultati da Firestore,
 * calcola i punteggi e salva in classifica/snapshot.
 * Funziona senza Cloud Functions — basta che l'utente sia admin.
 */
async function _ricalcolaClassificaClient() {
  const { collection, getDocs, doc, getDoc, setDoc } = await import(
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
  );
  const fireDb = window._firebase.db;

  const [partSnap, proSnap, risSnap] = await Promise.all([
    getDocs(collection(fireDb, 'partecipanti')),
    getDocs(collection(fireDb, 'pronostici')),
    getDoc(doc(fireDb, 'risultati', 'ufficiali')),
  ]);

  const nomi = {};
  const disabilitati = new Set();
  partSnap.forEach(d => {
    const { nome, cognome, nickname, disabilitato } = d.data();
    if (disabilitato) { disabilitati.add(d.id); return; }
    nomi[d.id] = nickname || [nome, cognome].filter(Boolean).join(' ') || d.id;
  });

  const risultati = risSnap.exists() ? risSnap.data() : {};

  const lista = [];
  proSnap.forEach(d => {
    if (disabilitati.has(d.id)) return; // escludi disabilitati
    if (!nomi[d.id]) return;            // escludi utenti eliminati (pronostici orfani)
    const pr = d.data();
    const { totale, breakdown } = calcolaPunteggio(pr, risultati);
    const spareggio = calcolaSparegnio(pr, risultati);
    lista.push({
      id:        d.id,
      nome:      nomi[d.id] || d.id,
      totale,
      breakdown,
      spareggio,
    });
  });

  lista.sort((a, b) => {
    if (b.totale !== a.totale) return b.totale - a.totale;
    for (let i = 0; i < Math.max(a.spareggio.length, b.spareggio.length); i++) {
      if ((b.spareggio[i] || 0) !== (a.spareggio[i] || 0))
        return (b.spareggio[i] || 0) - (a.spareggio[i] || 0);
    }
    return (a.nome || '').localeCompare(b.nome || '', 'it');
  });

  await setDoc(doc(fireDb, 'classifica', 'snapshot'), {
    partecipanti: lista,
    updatedAt:    new Date().toISOString(),
  });

  console.log(`[ricalcolaClassifica] ${lista.length} partecipanti aggiornati`);
}
