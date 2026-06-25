/**
 * MONDIALITO 2026 — functions/index.js
 * Firebase Cloud Functions
 *
 * Funzioni esportate:
 *   syncRisultati   — scheduled, ogni minuto (adattivo)
 *   syncManuale     — callable, forza sync immediato (solo admin)
 *   ricalcolaClassifica — triggered su cambio risultati
 *   checkApiStatus  — callable, verifica raggiungibilità API
 */

const { onSchedule }          = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError }  = require('firebase-functions/v2/https');
const { onDocumentWritten }   = require('firebase-functions/v2/firestore');
const { initializeApp }       = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth }             = require('firebase-admin/auth');
const axios                   = require('axios');

initializeApp();
const db = getFirestore();

// ── CONFIGURAZIONE ────────────────────────────────────
const API_BASE    = 'https://api.football-data.org/v4';
const API_KEY     = process.env.FOOTBALL_DATA_API_KEY; // Imposta nelle Secret Manager
const COMPETITION = 'WC';   // FIFA World Cup
const WC_SEASON   = '2026';

// Soglie per polling adattivo (ms)
const FINESTRA_LIVE  = 5  * 60 * 1000; // 5 min prima kick-off / dopo fischio finale
const FINESTRA_OGGI  = 60 * 60 * 1000; // 1 ora prima

// ── 1. SYNC SCHEDULATO ────────────────────────────────
// Gira ogni minuto. La logica adattiva decide se skippa o sincronizza.
exports.syncRisultati = onSchedule(
  { schedule: 'every 1 minutes', region: 'europe-west1', timeoutSeconds: 60 },
  async () => {
    try {
      await _sincronizza();
    } catch (e) {
      console.error('[syncRisultati] Errore:', e.message);
    }
  }
);

// ── 2. SYNC MANUALE (callable) ────────────────────────
exports.syncManuale = onCall(
  { region: 'europe-west1' },
  async (request) => {
    // Verifica che il chiamante sia admin
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Autenticazione richiesta.');

    const partSnap = await db.doc(`partecipanti/${uid}`).get();
    if (!partSnap.exists() || !partSnap.data().isAdmin) {
      throw new HttpsError('permission-denied', 'Solo gli admin possono fare sync manuale.');
    }

    await _sincronizza();
    return { ok: true, timestamp: new Date().toISOString() };
  }
);

// ── 3. RICALCOLA CLASSIFICA (triggered) ───────────────
// Si attiva ogni volta che il documento risultati/ufficiali cambia.
exports.ricalcolaClassifica = onDocumentWritten(
  { document: 'risultati/ufficiali', region: 'europe-west1' },
  async (event) => {
    try {
      const data = event.data.after?.data();
      if (!data) return; // documento eliminato, nulla da fare
      await _aggiornaClassifica(data);
    } catch (e) {
      console.error('[ricalcolaClassifica] Errore:', e.message);
    }
  }
);

// ── 4. ELIMINA UTENTE (callable, solo admin) ─────────
exports.eliminaUtente = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Autenticazione richiesta.');

    const callerSnap = await db.doc(`partecipanti/${callerUid}`).get();
    if (!callerSnap.exists() || !callerSnap.data().isAdmin) {
      throw new HttpsError('permission-denied', 'Solo gli admin possono eliminare utenti.');
    }

    const { uid } = request.data;
    if (!uid) throw new HttpsError('invalid-argument', 'uid mancante.');

    // Elimina da Firebase Auth
    await getAuth().deleteUser(uid);
    return { ok: true };
  }
);

// ── 5. CHECK API (callable) ───────────────────────────
exports.checkApiStatus = onCall(
  { region: 'europe-west1' },
  async (request) => {
    try {
      const res = await axios.get(`${API_BASE}/competitions/${COMPETITION}`, {
        headers: { 'X-Auth-Token': API_KEY },
        timeout: 8000,
      });
      return { ok: true, status: res.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
);

// ── 6. SYNC MARCATORI (callable, solo admin) ──────────
// Pesca la classifica marcatori dall'API e scrive live/marcatori.
// Usato dal bottone "Sync automatico da API" nel pannello admin.
exports.syncMarcatori = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Autenticazione richiesta.');

    const partSnap = await db.doc(`partecipanti/${uid}`).get();
    if (!partSnap.exists() || !partSnap.data().isAdmin) {
      throw new HttpsError('permission-denied', 'Solo gli admin possono sincronizzare i marcatori.');
    }

    const marcatori = await _fetchMarcatori();
    if (marcatori.length > 0) {
      await db.doc('live/marcatori').set({
        lista: marcatori,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { ok: true, count: marcatori.length };
  }
);

// ══════════════════════════════════════════════════════
// LOGICA INTERNA
// ══════════════════════════════════════════════════════

/**
 * Decisione adattiva: sincronizza solo se è il momento giusto.
 */
async function _sincronizza() {
  const now = Date.now();

  // Leggi il documento sistema per capire se ci sono partite imminenti
  const cfgSnap = await db.doc('sistema/config').get();
  const cfg = cfgSnap.exists() ? cfgSnap.data() : {};

  // Window live: true se una partita è in corso o inizia/finisce entro FINESTRA_LIVE
  const inFinestraLive = _isInFinestraLive(cfg.prossima_partita, cfg.ultima_partita_fine, now);

  if (!inFinestraLive) {
    // Fuori finestra: controlla se siamo nella finestra "oggi"
    const inFinestraOggi = _isInFinestraOggi(cfg.prossima_partita, now);
    if (!inFinestraOggi) {
      // Niente da fare — risparmia le quote API
      return;
    }
  }

  // Fetch risultati dall'API
  const [gironi, live, marcatori] = await Promise.all([
    _fetchRisultatiGironi(),
    _fetchLive(),
    _fetchMarcatori(),
  ]);

  // Aggiorna Firestore
  const batch = db.batch();

  // Risultati ufficiali
  if (Object.keys(gironi).length > 0) {
    batch.set(db.doc('risultati/ufficiali'), { gironi, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  // Live data
  batch.set(db.doc('live/oggi'), { ...live, updatedAt: FieldValue.serverTimestamp() });

  // Marcatori
  if (marcatori.length > 0) {
    batch.set(db.doc('live/marcatori'), { lista: marcatori, updatedAt: FieldValue.serverTimestamp() });
  }

  // Aggiorna config sistema con info prossima partita
  const prossimaPartita = live.prossime?.[0]?.orario || null;
  const ultimaFine      = live.risultati?.[live.risultati.length - 1]?.orario || null;
  batch.set(db.doc('sistema/config'), {
    prossima_partita: prossimaPartita,
    ultima_partita_fine: ultimaFine,
    ultimo_sync: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
  console.log(`[syncRisultati] Sync completato alle ${new Date().toISOString()}`);
}

/**
 * Fetch dei risultati delle partite di girone da football-data.org
 */
async function _fetchRisultatiGironi() {
  try {
    const res = await axios.get(
      `${API_BASE}/competitions/${COMPETITION}/matches?season=${WC_SEASON}&stage=GROUP_STAGE`,
      { headers: { 'X-Auth-Token': API_KEY }, timeout: 10000 }
    );

    const gironi = {};
    for (const match of res.data.matches || []) {
      if (match.status !== 'FINISHED' && match.status !== 'IN_PLAY' && match.status !== 'PAUSED') continue;

      // Mappa l'ID API → ID interno (usando il nome delle squadre)
      const matchId = _trovaMatchId(match);
      if (!matchId) continue;

      gironi[matchId] = {
        gol_casa:       match.score?.fullTime?.home ?? null,
        gol_trasferta:  match.score?.fullTime?.away ?? null,
        stato:          match.status,
        fonte:          'api_automatica',
        api_id:         match.id,
        updatedAt:      new Date().toISOString(),
      };
    }
    return gironi;
  } catch (e) {
    console.error('[_fetchRisultatiGironi]', e.message);
    return {};
  }
}

/**
 * Fetch partite live/oggi/prossime per la sezione Live dell'app
 */
async function _fetchLive() {
  try {
    const oggi = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const domani = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const res = await axios.get(
      `${API_BASE}/competitions/${COMPETITION}/matches?season=${WC_SEASON}&dateFrom=${oggi}&dateTo=${domani}`,
      { headers: { 'X-Auth-Token': API_KEY }, timeout: 10000 }
    );

    const tutteOggi = res.data.matches || [];

    const live      = tutteOggi.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
    const prossime  = tutteOggi.filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED');

    // Risultati recenti: ultime 5 partite finite
    const resRecenti = await axios.get(
      `${API_BASE}/competitions/${COMPETITION}/matches?season=${WC_SEASON}&status=FINISHED`,
      { headers: { 'X-Auth-Token': API_KEY }, timeout: 10000 }
    );
    const recenti = (resRecenti.data.matches || []).slice(-5);

    return {
      oggi:      [...live, ...prossime].map(_mapMatchLive),
      prossime:  prossime.map(_mapMatchLive),
      risultati: recenti.map(_mapMatchLive),
    };
  } catch (e) {
    console.error('[_fetchLive]', e.message);
    return { oggi: [], prossime: [], risultati: [] };
  }
}

/**
 * Fetch classifica marcatori dal torneo.
 */
async function _fetchMarcatori() {
  try {
    const res = await axios.get(
      `${API_BASE}/competitions/${COMPETITION}/scorers?season=${WC_SEASON}&limit=20`,
      { headers: { 'X-Auth-Token': API_KEY }, timeout: 10000 }
    );
    return (res.data.scorers || []).map((s, i) => ({
      pos:          i + 1,
      nome:         s.player?.name || '—',
      squadra_id:   _teamNameToId(s.team?.name),
      squadra_nome: s.team?.name || '—',
      gol:          s.goals ?? 0,
      assist:       s.assists ?? 0,
      rigori:       s.penalties ?? 0,
    }));
  } catch (e) {
    console.error('[_fetchMarcatori]', e.message);
    return [];
  }
}

/**
 * Mappa un match dell'API nel formato usato dal frontend.
 */
function _mapMatchLive(m) {
  return {
    api_id:         m.id,
    casa:           _teamNameToId(m.homeTeam?.name),
    trasferta:      _teamNameToId(m.awayTeam?.name),
    orario:         m.utcDate,
    stato:          m.status,
    minuto:         m.minute || null,
    gol_casa:       m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null,
    gol_trasferta:  m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null,
    modalita:       _mapModalita(m.score?.duration),
    fase:           _mapFase(m.stage),
  };
}

/**
 * Ricalcola la classifica da tutti i pronostici e i risultati ufficiali.
 */
async function _aggiornaClassifica(risultati) {
  const { calcolaPunteggio, calcolaSparegnio } = require('./punteggi.js');

  const [pronSnap, partSnap] = await Promise.all([
    db.collection('pronostici').get(),
    db.collection('partecipanti').get(),
  ]);

  const nomi = {};
  const disabilitati = new Set();
  partSnap.docs.forEach(d => {
    const { nome, cognome, nickname, disabilitato } = d.data();
    if (disabilitato) { disabilitati.add(d.id); return; }
    nomi[d.id] = nickname || [nome, cognome].filter(Boolean).join(' ') || d.id;
  });

  const partecipanti = pronSnap.docs.filter(d => !disabilitati.has(d.id) && !!nomi[d.id]).map(d => {
    const pr = d.data();
    const { totale, breakdown } = calcolaPunteggio(pr, risultati);
    const spareggio = calcolaSparegnio(pr, risultati);
    return {
      id:        d.id,
      nome:      nomi[d.id] || d.id,
      totale,
      breakdown,
      spareggio,
    };
  });

  // Ordina e salva
  partecipanti.sort((a, b) => {
    if (b.totale !== a.totale) return b.totale - a.totale;
    for (let i = 0; i < Math.max(a.spareggio.length, b.spareggio.length); i++) {
      if ((b.spareggio[i] || 0) !== (a.spareggio[i] || 0)) return (b.spareggio[i] || 0) - (a.spareggio[i] || 0);
    }
    return 0;
  });

  await db.doc('classifica/snapshot').set({
    partecipanti,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log(`[ricalcolaClassifica] Classifica aggiornata — ${partecipanti.length} partecipanti`);
}

// ══════════════════════════════════════════════════════
// HELPERS POLLING ADATTIVO
// ══════════════════════════════════════════════════════

function _isInFinestraLive(prossimaPartita, ultimaFine, now) {
  if (prossimaPartita) {
    const t = new Date(prossimaPartita).getTime();
    if (now >= t - FINESTRA_LIVE && now <= t + 120 * 60 * 1000) return true; // entro 2h da kick-off
  }
  if (ultimaFine) {
    const t = new Date(ultimaFine).getTime();
    if (now <= t + FINESTRA_LIVE) return true;
  }
  return false;
}

function _isInFinestraOggi(prossimaPartita, now) {
  if (!prossimaPartita) return false;
  const t = new Date(prossimaPartita).getTime();
  return now >= t - FINESTRA_OGGI && now <= t + 4 * 60 * 60 * 1000; // 4h dopo kick-off previsto
}

// ══════════════════════════════════════════════════════
// HELPERS MAPPING API → DB INTERNO
// ══════════════════════════════════════════════════════

// Mappa nomi squadre API → ID interno mondialito_db.json
// (Completare con tutti i 48 nomi esatti che restituisce l'API)
const NOME_API_TO_ID = {
  'Mexico':           'mex', 'South Africa':     'rsa', 'South Korea':     'kor',
  'Czech Republic':   'cze', 'Canada':            'can', 'Bosnia and Herzegovina': 'bih',
  'Qatar':            'qat', 'Switzerland':       'sui', 'Brazil':           'bra',
  'Morocco':          'mar', 'Haiti':             'hai', 'Scotland':         'sco',
  'United States':    'usa', 'Paraguay':          'par', 'Australia':        'aus',
  'Türkiye':          'tur', 'Germany':           'ger', "Côte d'Ivoire":    'civ',
  'Ecuador':          'ecu', 'Curaçao':           'cur', 'Netherlands':      'ned',
  'Japan':            'jpn', 'Sweden':            'swe', 'Tunisia':          'tun',
  'Belgium':          'bel', 'Egypt':             'egy', 'IR Iran':          'irn',
  'New Zealand':      'nzl', 'Spain':             'esp', 'Cape Verde':       'cpv',
  'Saudi Arabia':     'ksa', 'Uruguay':           'uru', 'France':           'fra',
  'Senegal':          'sen', 'Iraq':              'irq', 'Norway':           'nor',
  'Argentina':        'arg', 'Algeria':           'alg', 'Austria':          'aut',
  'Jordan':           'jor',
  'Portugal':          'por', 'DR Congo':         'cod', 'Uzbekistan':       'uzb',
  'Colombia':          'col', 'England':           'eng', 'Croatia':          'cro',
  'Ghana':             'gha', 'Panama':            'pan',
};

function _teamNameToId(name) {
  return NOME_API_TO_ID[name] || (name || '').toLowerCase().replace(/\s+/g, '_');
}

const DB_LOCAL = require('../mondialito_db.json');

function _trovaMatchId(apiMatch) {
  const casaId  = _teamNameToId(apiMatch.homeTeam?.name);
  const trasfId = _teamNameToId(apiMatch.awayTeam?.name);

  for (const [, girone] of Object.entries(DB_LOCAL.gironi)) {
    const p = girone.partite.find(
      p => (p.casa === casaId && p.trasferta === trasfId) ||
           (p.casa === trasfId && p.trasferta === casaId)
    );
    if (p) return p.id;
  }
  return null;
}

function _mapModalita(duration) {
  if (!duration || duration === 'REGULAR') return '90min';
  if (duration === 'EXTRA_TIME')           return 'supplementari';
  if (duration === 'PENALTY_SHOOTOUT')     return 'rigori';
  return '90min';
}

function _mapFase(stage) {
  const map = {
    'GROUP_STAGE':    'gironi',
    'ROUND_OF_32':    'sedicesimi',
    'ROUND_OF_16':    'ottavi',
    'QUARTER_FINALS': 'quarti',
    'SEMI_FINALS':    'semifinali',
    'FINAL':          'finale',
  };
  return map[stage] || stage?.toLowerCase() || 'gironi';
}
