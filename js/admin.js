/** WIMBLEDINO — admin.js (stub temporaneo) */
function _placeholder(id, titolo) {
  const el = document.getElementById(id);
  if (el) el.innerHTML =
    '<div style="padding:48px 20px;text-align:center;opacity:.9">' +
    '<div style="font-size:44px;line-height:1">🎾</div>' +
    '<h2 style="margin:14px 0 6px">' + titolo + '</h2>' +
    '<p style="opacity:.7">Pannello admin tennis in costruzione. Per ora approva gli utenti da Firestore (campo approvato: true).</p></div>';
}
export function initAdmin() { _placeholder('page-admin', 'Pannello admin'); }
