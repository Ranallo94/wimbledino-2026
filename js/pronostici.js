/**
 * WIMBLEDINO — pronostici.js (stub temporaneo)
 * La pagina pronostici tennis è in costruzione. Stub per non rompere l'app.
 */
function _placeholder(id, titolo) {
  const el = document.getElementById(id);
  if (el) el.innerHTML =
    '<div style="padding:48px 20px;text-align:center;opacity:.9">' +
    '<div style="font-size:44px;line-height:1">🎾</div>' +
    '<h2 style="margin:14px 0 6px">' + titolo + '</h2>' +
    '<p style="opacity:.7">Sezione in costruzione per Wimbledino. Presto disponibile.</p></div>';
}
export function initPronostici() { _placeholder('page-pronostici', 'Pronostici'); }
export function cleanupPronostici() {}
