/**
 * MONDIALITO 2026 — db.js
 * Astrazione Firestore: tutte le operazioni di lettura/scrittura
 * passano da qui, così il resto del codice non tocca mai Firestore direttamente.
 */

import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, getDocs, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const db = () => window._firebase.db;

// ── PRONOSTICI ────────────────────────────────────────

/**
 * Carica i pronostici di un partecipante.
 * @param {string} uid
 * @returns {Object|null}
 */
export async function getPronostici(uid) {
  const snap = await getDoc(doc(db(), 'pronostici', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Carica i pronostici di TUTTI i partecipanti (per il ricalcolo classifica).
 * @returns {Array} [{ id, ...dati }]
 */
export async function getTuttiPronostici() {
  const snap = await getDocs(collection(db(), 'pronostici'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Salva (sovrascrive) i pronostici di un partecipante.
 * @param {string} uid
 * @param {Object} dati
 */
export async function savePronostici(uid, dati) {
  await setDoc(doc(db(), 'pronostici', uid), {
    ...dati,
    updatedAt: serverTimestamp(),
  });
}

// ── RISULTATI ─────────────────────────────────────────

/**
 * Carica i risultati ufficiali (documento singleton).
 * @returns {Object}
 */
export async function getRisultati() {
  const snap = await getDoc(doc(db(), 'risultati', 'ufficiali'));
  return snap.exists() ? snap.data() : {};
}

/**
 * Ascolta i risultati in real-time.
 * @param {Function} callback  fn(risultati)
 * @returns unsubscribe function
 */
export function onRisultatiSnapshot(callback) {
  return onSnapshot(doc(db(), 'risultati', 'ufficiali'), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
}

/**
 * Aggiorna parzialmente i risultati (solo admin).
 * @param {Object} patch  Oggetto con i campi da aggiornare (dot-notation Firestore)
 */
export async function patchRisultati(patch) {
  await updateDoc(doc(db(), 'risultati', 'ufficiali'), patch);
}

/**
 * Scrive i risultati ufficiali in modalità merge (crea il documento se non esiste).
 * Più sicuro di patchRisultati quando il documento potrebbe non esistere ancora.
 * @param {Object} dati
 */
export async function setRisultati(dati) {
  await setDoc(doc(db(), 'risultati', 'ufficiali'), {
    ...dati,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ── CLASSIFICA ────────────────────────────────────────

/**
 * Carica la classifica pre-calcolata (documento singleton, aggiornato dalla Cloud Function).
 * @returns {Array} Array di { uid, nome, totale, breakdown, spareggio }
 */
export async function getClassifica() {
  const snap = await getDoc(doc(db(), 'classifica', 'snapshot'));
  return snap.exists() ? (snap.data().partecipanti || []) : [];
}

/**
 * Ascolta la classifica in real-time.
 * @param {Function} callback  fn(array)
 * @returns unsubscribe function
 */
export function onClassificaSnapshot(callback) {
  return onSnapshot(doc(db(), 'classifica', 'snapshot'), (snap) => {
    callback(snap.exists() ? (snap.data().partecipanti || []) : []);
  });
}

/**
 * Salva (sovrascrive) la classifica pre-calcolata. Usato dal ricalcolo manuale admin.
 * @param {Array} partecipanti  [{ id, nome, totale, breakdown, spareggio }]
 */
export async function saveClassifica(partecipanti) {
  await setDoc(doc(db(), 'classifica', 'snapshot'), {
    partecipanti,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Salva il timestamp dell'ultimo aggiornamento classifica (scritto dalla Cloud Function).
 */
export async function getClassificaUpdatedAt() {
  const snap = await getDoc(doc(db(), 'classifica', 'snapshot'));
  if (!snap.exists()) return null;
  const ts = snap.data().updatedAt;
  return ts ? ts.toDate() : null;
}

// ── PARTECIPANTI ──────────────────────────────────────

/**
 * Carica tutti i partecipanti.
 * @returns {Array} [{ id, nome, isAdmin }]
 */
export async function getPartecipanti() {
  const snap = await getDocs(collection(db(), 'partecipanti'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Aggiorna i dati di un partecipante (solo admin).
 */
export async function updatePartecipante(uid, patch) {
  await updateDoc(doc(db(), 'partecipanti', uid), patch);
}

// ── SISTEMA ───────────────────────────────────────────

/**
 * Legge la configurazione di sistema (es. pronostici aperti/chiusi, stato API).
 */
export async function getSistema() {
  const snap = await getDoc(doc(db(), 'sistema', 'config'));
  return snap.exists() ? snap.data() : {};
}

/**
 * Aggiorna la configurazione di sistema (solo admin).
 */
export async function updateSistema(patch) {
  await setDoc(doc(db(), 'sistema', 'config'), patch, { merge: true });
}

/**
 * Ascolta la configurazione di sistema in real-time.
 */
export function onSistemaSnapshot(callback) {
  return onSnapshot(doc(db(), 'sistema', 'config'), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
}

// ── LIVE / PARTITE ────────────────────────────────────

/**
 * Carica i dati live (partite in corso / oggi / prossime).
 * @returns {Object}
 */
export async function getLive() {
  const snap = await getDoc(doc(db(), 'live', 'oggi'));
  return snap.exists() ? snap.data() : {};
}

/**
 * Ascolta i dati live in real-time.
 */
export function onLiveSnapshot(callback) {
  return onSnapshot(doc(db(), 'live', 'oggi'), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
}

/**
 * Ascolta la classifica marcatori in real-time.
 */
export function onMarcatoriSnapshot(callback) {
  return onSnapshot(doc(db(), 'live', 'marcatori'), (snap) => {
    callback(snap.exists() ? (snap.data().lista || []) : []);
  });
}
