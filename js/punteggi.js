/**
 * MONDIALITO 2026 — punteggi.js
 * Motore di calcolo punteggi. Gira sia sul client (anteprima)
 * che nella Cloud Function (calcolo ufficiale su Firestore).
 */

import DB from '../mondialito_db.json' with { type: 'json' };
import { SEDICESIMI_BRACKET, resolveSlot, calcola3rdiSlots, getClassificaGirone } from './bracket.js';

const REG = DB.regolamento.punteggi;

/**
 * Calcola il punteggio totale e il breakdown per un partecipante.
 * @param {Object} pronostici  — scheda pronostici del partecipante
 * @param {Object} risultati   — risultati ufficiali dal Firestore
 * @returns {{ totale: number, breakdown: Object }}
 */
export function calcolaPunteggio(pronostici, risultati) {
  const bd = {
    gironi_segno:    { punti: 0, corretti: 0, totale: 0 },
    gironi_esatto:   { punti: 0, corretti: 0, totale: 0 },
    posto_griglia:   { punti: 0, corretti: 0, totale: 0 },
    sedicesimi:      { punti: 0, corretti: 0 },
    ottavi:          { punti: 0, corretti: 0 },
    quarti:          { punti: 0, corretti: 0 },
    semifinali:      { punti: 0, corretti: 0 },
    finale:          { punti: 0, corretti: 0 },
    vincitore:       { punti: 0, corretto: false },
    modalita:        { punti: 0, corretti: 0 },
    capocannoniere:  { punti: 0, dettaglio: '' },
  };

  const rGironi   = risultati?.gironi   || {};
  const rElim     = risultati?.fase_eliminatoria || {};
  const rGriglia  = risultati?.posizioni_finali_gironi || {};
  const rCannon   = risultati?.capocannoniere_finale || {};
  const pGironi   = pronostici?.gironi || {};
  const pPosiz    = pronostici?.posizioni_girone || {};
  const pElim     = pronostici?.fase_eliminatoria || {};
  const pCannon   = pronostici?.capocannoniere || {};

  // ── 1. FASE A GIRONI ──────────────────────────────────

  // Per ogni girone
  Object.entries(DB.gironi).forEach(([lettera, girone]) => {
    girone.partite.forEach(partita => {
      const r = rGironi[partita.id];
      const p = pGironi[partita.id];
      if (!r || r.gol_casa == null || r.gol_trasferta == null || !p) return;

      bd.gironi_segno.totale++;
      bd.gironi_esatto.totale++;

      // Segno 1X2
      const segnoR = r.gol_casa > r.gol_trasferta ? '1'
                   : r.gol_casa < r.gol_trasferta ? '2' : 'X';
      if (p.segno === segnoR) {
        bd.gironi_segno.punti += REG.girone.segno_1X2;
        bd.gironi_segno.corretti++;

        // Risultato esatto (bonus, solo se segno corretto)
        if (p.gol_casa == r.gol_casa && p.gol_trasferta == r.gol_trasferta) {
          bd.gironi_esatto.punti += REG.girone.risultato_esatto_bonus;
          bd.gironi_esatto.corretti++;
        }
      }
    });
  });

  // ── 2. POSTO IN GRIGLIA ───────────────────────────────
  // 10pt per ogni squadra di cui si indovina lo slot esatto nel tabellone
  // dei sedicesimi. Calcolato SOLO quando tutte le classifiche ufficiali
  // dei gironi sono disponibili in posizioni_finali_gironi.

  const standingsR = {};
  let grigliaPronta = true;
  Object.keys(DB.gironi).forEach(l => {
    if (rGriglia[l]?.length) {
      standingsR[l] = rGriglia[l];
    } else {
      grigliaPronta = false;
    }
  });

  if (grigliaPronta) {
    const terziSlotsR = calcola3rdiSlots(rGironi, DB, risultati?.spareggio_terze || null);
    const standingsP  = pPosiz;
    const terziSlotsP = calcola3rdiSlots(pGironi, DB);

    SEDICESIMI_BRACKET.forEach(slot => {
      const actualCasa  = resolveSlot(slot.casa,  standingsR, terziSlotsR);
      const actualTrasf = resolveSlot(slot.trasf, standingsR, terziSlotsR);
      const predCasa    = resolveSlot(slot.casa,  standingsP, terziSlotsP);
      const predTrasf   = resolveSlot(slot.trasf, standingsP, terziSlotsP);

      if (predCasa  && actualCasa  && predCasa  === actualCasa)  {
        bd.posto_griglia.punti += REG.posto_in_griglia.punti_per_posizione_corretta;
        bd.posto_griglia.corretti++;
      }
      if (predTrasf && actualTrasf && predTrasf === actualTrasf) {
        bd.posto_griglia.punti += REG.posto_in_griglia.punti_per_posizione_corretta;
        bd.posto_griglia.corretti++;
      }
    });
  }

  // ── 3. FASI ELIMINATORIE ──────────────────────────────
  const fasi = [
    { id: 'sedicesimi', key: 'sedicesimi', field: bd.sedicesimi, pti: REG.fasi_eliminatorie.sedicesimi },
    { id: 'ottavi',     key: 'ottavi',     field: bd.ottavi,     pti: REG.fasi_eliminatorie.ottavi },
    { id: 'quarti',     key: 'quarti',     field: bd.quarti,     pti: REG.fasi_eliminatorie.quarti },
    { id: 'semifinali', key: 'semifinali', field: bd.semifinali, pti: REG.fasi_eliminatorie.semifinali },
    { id: 'finale',     key: 'finale',     field: bd.finale,     pti: REG.fasi_eliminatorie.finale },
  ];

  fasi.forEach(({ id, key, field, pti }) => {
    const rFase = rElim[key] || {};
    const pFase = pElim[key] || {};
    // Squadre qualificate nella fase
    const squadreR = new Set(
      Object.values(rFase).flatMap(m => [m?.casa, m?.trasferta, m?.vincitore]).filter(Boolean)
    );
    const squadreP = Object.values(pFase).map(m => m?.vincitore).filter(Boolean);

    // Punti per squadra avanzata correttamente (tutte le fasi, finale inclusa)
    squadreP.forEach(sq => {
      if (squadreR.has(sq)) {
        field.punti += pti;
        field.corretti++;
      }
    });

    // Modalità passaggio turno
    Object.entries(rFase).forEach(([matchId, rMatch]) => {
      if (!rMatch?.modalita) return;
      const pMatch = pFase[matchId];
      if (!pMatch) return;
      if (pMatch.modalita === rMatch.modalita) {
        bd.modalita.punti += REG.fasi_eliminatorie.modalita_passaggio_turno.punti;
        bd.modalita.corretti++;
      }
    });
  });

  // ── 4. VINCITORE TORNEO ───────────────────────────────
  const vincitoreR = rElim.finale?.F?.vincitore;
  if (vincitoreR && pElim.finale?.F?.vincitore === vincitoreR) {
    bd.vincitore.punti = REG.fasi_eliminatorie.vincitore_torneo;
    bd.vincitore.corretto = true;
  }

  // ── 5. CAPOCANNONIERE ─────────────────────────────────
  // I punti del capocannoniere si assegnano SOLO a fine torneo,
  // quando il vincitore della finale è noto.
  if (vincitoreR) {
    const { primo: cp1, secondo: cp2, terzo: cp3 } = rCannon;
    const { primo: pp1, secondo: pp2, terzo: pp3 } = pCannon;
    const ternaP = [pp1, pp2, pp3].filter(Boolean);
    const ternaR = [cp1, cp2, cp3].filter(Boolean);

    if (cp1 && pp1 === cp1) { bd.capocannoniere.punti += REG.capocannoniere.primo_classificato; bd.capocannoniere.dettaglio += '1°✓ '; }
    if (cp2 && pp2 === cp2) { bd.capocannoniere.punti += REG.capocannoniere.secondo_classificato; bd.capocannoniere.dettaglio += '2°✓ '; }
    if (cp3 && pp3 === cp3) { bd.capocannoniere.punti += REG.capocannoniere.terzo_classificato; bd.capocannoniere.dettaglio += '3°✓ '; }
    // Bonus terna: +10 se almeno uno nella terna ma non nel posto esatto
    const nellaTerna = ternaP.filter((p, i) => {
      const exactMatch = [cp1, cp2, cp3][i];
      return ternaR.includes(p) && p !== exactMatch;
    });
    if (nellaTerna.length > 0) { bd.capocannoniere.punti += REG.capocannoniere.nella_terna; bd.capocannoniere.dettaglio += 'terna✓'; }
  }

  // ── TOTALE ────────────────────────────────────────────
  const totale = Object.values(bd).reduce((sum, v) =>
    sum + (typeof v.punti === 'number' ? v.punti : 0), 0);

  return { totale, breakdown: bd };
}

/**
 * Calcola i criteri di spareggio per un partecipante.
 * Restituisce un array di valori ordinati per priorità spareggio.
 */
export function calcolaSparegnio(pronostici, risultati) {
  const { breakdown: bd } = calcolaPunteggio(pronostici, risultati);
  const rElim = risultati?.fase_eliminatoria || {};
  const pElim = pronostici?.fase_eliminatoria || {};
  const rCannon = risultati?.capocannoniere_finale || {};
  const pCannon = pronostici?.capocannoniere || {};

  const vincR = rElim.finale?.F?.vincitore;
  const ternaR = [rCannon.primo, rCannon.secondo, rCannon.terzo].filter(Boolean);
  const pp1 = pCannon.primo;

  return [
    vincR && pElim.finale?.F?.vincitore === vincR ? 1 : 0,  // 1. Vincitore
    bd.finale.corretti,                                   // 2. Finaliste
    bd.semifinali.corretti,                               // 3. Semifinaliste
    bd.quarti.corretti,                                   // 4. Quarti
    bd.ottavi.corretti,                                   // 5. Ottavi
    bd.gironi_esatto.corretti,                            // 6. Risultati esatti
    vincR && pp1 === rCannon.primo ? 1 : 0,               // 7. Cannoniere 1°
    bd.posto_griglia.corretti,                            // 8. Posizioni griglia
    [pCannon.primo, pCannon.secondo, pCannon.terzo].filter(p => ternaR.includes(p)).length, // 9. Terna cannonieri
    bd.gironi_segno.corretti,                             // 10. Segni girone
    bd.modalita.corretti,                                 // 11. Modalità passaggio
  ];
}
