/**
 * MONDIALITO 2026 — pronostici.js
 */

import DB from '../mondialito_db.json' with { type: 'json' };

// Mappa lookup squadre per ID (DB.squadre ha chiavi numeriche, ma ogni sq ha .id)
const SQUADRE_BY_ID = {};
Object.values(DB.squadre).forEach(sq => { SQUADRE_BY_ID[sq.id] = sq; });
import { STATE } from './app.js';
import { getPronostici, savePronostici, onSistemaSnapshot } from './db.js';
import { showToast, showSpinner } from './ui.js';

// ══════════════════════════════════════════
// SEDICESIMI: template bracket ufficiale FIFA 2026
// Slot '1'=primo, '2'=secondo, '3slot'=miglior terzo (assegnato da COMB_3I)
// ══════════════════════════════════════════
// Ordine bracket ufficiale FIFA 2026 — coppie adiacenti alimentano lo stesso ottavo
// O1(M89): S02+S05 | O2(M90): S01+S03 | O3(M93): S11+S12 | O4(M94): S09+S10
// O5(M91): S04+S06 | O6(M92): S07+S08 | O7(M95): S14+S16 | O8(M96): S13+S15
const SEDICESIMI_BRACKET = [
  { id:'S02', match:'M74', desc:'1° Girone E vs Miglior 3° (A/B/C/D/F)', casa:{t:'1',g:'E'}, trasf:{t:'3slot',slot:'E'} },
  { id:'S05', match:'M77', desc:'1° Girone I vs Miglior 3° (C/D/F/G/H)', casa:{t:'1',g:'I'}, trasf:{t:'3slot',slot:'I'} },
  { id:'S01', match:'M73', desc:'2° Girone A vs 2° Girone B', casa:{t:'2',g:'A'}, trasf:{t:'2',g:'B'} },
  { id:'S03', match:'M75', desc:'1° Girone F vs 2° Girone C', casa:{t:'1',g:'F'}, trasf:{t:'2',g:'C'} },
  { id:'S11', match:'M83', desc:'2° Girone K vs 2° Girone L', casa:{t:'2',g:'K'}, trasf:{t:'2',g:'L'} },
  { id:'S12', match:'M84', desc:'1° Girone H vs 2° Girone J', casa:{t:'1',g:'H'}, trasf:{t:'2',g:'J'} },
  { id:'S09', match:'M81', desc:'1° Girone D vs Miglior 3° (B/E/F/I/J)', casa:{t:'1',g:'D'}, trasf:{t:'3slot',slot:'D'} },
  { id:'S10', match:'M82', desc:'1° Girone G vs Miglior 3° (A/E/H/I/J)', casa:{t:'1',g:'G'}, trasf:{t:'3slot',slot:'G'} },
  { id:'S04', match:'M76', desc:'1° Girone C vs 2° Girone F', casa:{t:'1',g:'C'}, trasf:{t:'2',g:'F'} },
  { id:'S06', match:'M78', desc:'2° Girone E vs 2° Girone I', casa:{t:'2',g:'E'}, trasf:{t:'2',g:'I'} },
  { id:'S07', match:'M79', desc:'1° Girone A vs Miglior 3° (C/E/F/H/I)', casa:{t:'1',g:'A'}, trasf:{t:'3slot',slot:'A'} },
  { id:'S08', match:'M80', desc:'1° Girone L vs Miglior 3° (E/H/I/J/K)', casa:{t:'1',g:'L'}, trasf:{t:'3slot',slot:'L'} },
  { id:'S14', match:'M86', desc:'1° Girone J vs 2° Girone H', casa:{t:'1',g:'J'}, trasf:{t:'2',g:'H'} },
  { id:'S16', match:'M88', desc:'2° Girone D vs 2° Girone G', casa:{t:'2',g:'D'}, trasf:{t:'2',g:'G'} },
  { id:'S13', match:'M85', desc:'1° Girone B vs Miglior 3° (E/F/G/I/J)', casa:{t:'1',g:'B'}, trasf:{t:'3slot',slot:'B'} },
  { id:'S15', match:'M87', desc:'1° Girone K vs Miglior 3° (D/E/I/J/L)', casa:{t:'1',g:'K'}, trasf:{t:'3slot',slot:'K'} },
];

// Tabella 495 combinazioni FIFA (Annex C del regolamento)
// Chiave: 8 lettere dei gironi qualificati come 3° classificato (ordinati)
// Valore: 8 lettere del girone del 3° assegnato a ciascuno slot
// Ordine slot: A, B, D, E, G, I, K, L
const COMB_3I = {
  'ABCDEFGH':'HGBCAFDE','ABCDEFGI':'CGBDAFEI','ABCDEFGJ':'CGBDAFEJ',
  'ABCDEFGK':'CGBDAFEK','ABCDEFGL':'CGBDAFLE','ABCDEFHI':'HEBCAFDI',
  'ABCDEFHJ':'HJBCAFDE','ABCDEFHK':'HEBCAFDK','ABCDEFHL':'HFBCADLE',
  'ABCDEFIJ':'CJBDAFEI','ABCDEFIK':'CEBDAFIK','ABCDEFIL':'CEBDAFLI',
  'ABCDEFJK':'CJBDAFEK','ABCDEFJL':'CJBDAFLE','ABCDEFKL':'CEBDAFLK',
  'ABCDEGHI':'HGBCADEI','ABCDEGHJ':'HGBCADEJ','ABCDEGHK':'HGBCADEK',
  'ABCDEGHL':'HGBCADLE','ABCDEGIJ':'EGBCADIJ','ABCDEGIK':'EGBCADIK',
  'ABCDEGIL':'EGBCADLI','ABCDEGJK':'EGBCADJK','ABCDEGJL':'EGBCADLJ',
  'ABCDEGKL':'EGBCADLK','ABCDEHIJ':'HJBCADEI','ABCDEHIK':'HEBCADIK',
  'ABCDEHIL':'HEBCADLI','ABCDEHJK':'HJBCADEK','ABCDEHJL':'HJBCADLE',
  'ABCDEHKL':'HEBCADLK','ABCDEIJK':'EJBCADIK','ABCDEIJL':'EJBCADLI',
  'ABCDEIKL':'EIBCADLK','ABCDEJKL':'EJBCADLK','ABCDFGHI':'HGBCAFDI',
  'ABCDFGHJ':'HGBCAFDJ','ABCDFGHK':'HGBCAFDK','ABCDFGHL':'CGBDAFLH',
  'ABCDFGIJ':'CGBDAFIJ','ABCDFGIK':'CGBDAFIK','ABCDFGIL':'CGBDAFLI',
  'ABCDFGJK':'CGBDAFJK','ABCDFGJL':'CGBDAFLJ','ABCDFGKL':'CGBDAFLK',
  'ABCDFHIJ':'HJBCAFDI','ABCDFHIK':'HFBCADIK','ABCDFHIL':'HFBCADLI',
  'ABCDFHJK':'HJBCAFDK','ABCDFHJL':'CJBDAFLH','ABCDFHKL':'HFBCADLK',
  'ABCDFIJK':'CJBDAFIK','ABCDFIJL':'CJBDAFLI','ABCDFIKL':'CIBDAFLK',
  'ABCDFJKL':'CJBDAFLK','ABCDGHIJ':'HGBCADIJ','ABCDGHIK':'HGBCADIK',
  'ABCDGHIL':'HGBCADLI','ABCDGHJK':'HGBCADJK','ABCDGHJL':'HGBCADLJ',
  'ABCDGHKL':'HGBCADLK','ABCDGIJK':'CJBDAGIK','ABCDGIJL':'CJBDAGLI',
  'ABCDGIKL':'IGBCADLK','ABCDGJKL':'CJBDAGLK','ABCDHIJK':'HJBCADIK',
  'ABCDHIJL':'HJBCADLI','ABCDHIKL':'HIBCADLK','ABCDHJKL':'HJBCADLK',
  'ABCDIJKL':'IJBCADLK','ABCEFGHI':'HGBCAFEI','ABCEFGHJ':'HGBCAFEJ',
  'ABCEFGHK':'HGBCAFEK','ABCEFGHL':'HGBCAFLE','ABCEFGIJ':'EGBCAFIJ',
  'ABCEFGIK':'EGBCAFIK','ABCEFGIL':'EGBCAFLI','ABCEFGJK':'EGBCAFJK',
  'ABCEFGJL':'EGBCAFLJ','ABCEFGKL':'EGBCAFLK','ABCEFHIJ':'HJBCAFEI',
  'ABCEFHIK':'HEBCAFIK','ABCEFHIL':'HEBCAFLI','ABCEFHJK':'HJBCAFEK',
  'ABCEFHJL':'HJBCAFLE','ABCEFHKL':'HEBCAFLK','ABCEFIJK':'EJBCAFIK',
  'ABCEFIJL':'EJBCAFLI','ABCEFIKL':'EIBCAFLK','ABCEFJKL':'EJBCAFLK',
  'ABCEGHIJ':'HJBCAGEI','ABCEGHIK':'EGBCAHIK','ABCEGHIL':'EGBCAHLI',
  'ABCEGHJK':'HJBCAGEK','ABCEGHJL':'HJBCAGLE','ABCEGHKL':'EGBCAHLK',
  'ABCEGIJK':'EJBCAGIK','ABCEGIJL':'EJBCAGLI','ABCEGIKL':'EGBAICLK',
  'ABCEGJKL':'EJBCAGLK','ABCEHIJK':'EJBCAHIK','ABCEHIJL':'EJBCAHLI',
  'ABCEHIKL':'EIBCAHLK','ABCEHJKL':'EJBCAHLK','ABCEIJKL':'EJBAICLK',
  'ABCFGHIJ':'HGBCAFIJ','ABCFGHIK':'HGBCAFIK','ABCFGHIL':'HGBCAFLI',
  'ABCFGHJK':'HGBCAFJK','ABCFGHJL':'HGBCAFLJ','ABCFGHKL':'HGBCAFLK',
  'ABCFGIJK':'CJBFAGIK','ABCFGIJL':'CJBFAGLI','ABCFGIKL':'IGBCAFLK',
  'ABCFGJKL':'CJBFAGLK','ABCFHIJK':'HJBCAFIK','ABCFHIJL':'HJBCAFLI',
  'ABCFHIKL':'HIBCAFLK','ABCFHJKL':'HJBCAFLK','ABCFIJKL':'IJBCAFLK',
  'ABCGHIJK':'HJBCAGIK','ABCGHIJL':'HJBCAGLI','ABCGHIKL':'IGBCAHLK',
  'ABCGHJKL':'HJBCAGLK','ABCGIJKL':'IJBCAGLK','ABCHIJKL':'IJBCAHLK',
  'ABDEFGHI':'HGBDAFEI','ABDEFGHJ':'HGBDAFEJ','ABDEFGHK':'HGBDAFEK',
  'ABDEFGHL':'HGBDAFLE','ABDEFGIJ':'EGBDAFIJ','ABDEFGIK':'EGBDAFIK',
  'ABDEFGIL':'EGBDAFLI','ABDEFGJK':'EGBDAFJK','ABDEFGJL':'EGBDAFLJ',
  'ABDEFGKL':'EGBDAFLK','ABDEFHIJ':'HJBDAFEI','ABDEFHIK':'HEBDAFIK',
  'ABDEFHIL':'HEBDAFLI','ABDEFHJK':'HJBDAFEK','ABDEFHJL':'HJBDAFLE',
  'ABDEFHKL':'HEBDAFLK','ABDEFIJK':'EJBDAFIK','ABDEFIJL':'EJBDAFLI',
  'ABDEFIKL':'EIBDAFLK','ABDEFJKL':'EJBDAFLK','ABDEGHIJ':'HJBDAGEI',
  'ABDEGHIK':'EGBDAHIK','ABDEGHIL':'EGBDAHLI','ABDEGHJK':'HJBDAGEK',
  'ABDEGHJL':'HJBDAGLE','ABDEGHKL':'EGBDAHLK','ABDEGIJK':'EJBDAGIK',
  'ABDEGIJL':'EJBDAGLI','ABDEGIKL':'EGBAIDLK','ABDEGJKL':'EJBDAGLK',
  'ABDEHIJK':'EJBDAHIK','ABDEHIJL':'EJBDAHLI','ABDEHIKL':'EIBDAHLK',
  'ABDEHJKL':'EJBDAHLK','ABDEIJKL':'EJBAIDLK','ABDFGHIJ':'HGBDAFIJ',
  'ABDFGHIK':'HGBDAFIK','ABDFGHIL':'HGBDAFLI','ABDFGHJK':'HGBDAFJK',
  'ABDFGHJL':'HGBDAFLJ','ABDFGHKL':'HGBDAFLK','ABDFGIJK':'FJBDAGIK',
  'ABDFGIJL':'FJBDAGLI','ABDFGIKL':'IGBDAFLK','ABDFGJKL':'FJBDAGLK',
  'ABDFHIJK':'HJBDAFIK','ABDFHIJL':'HJBDAFLI','ABDFHIKL':'HIBDAFLK',
  'ABDFHJKL':'HJBDAFLK','ABDFIJKL':'IJBDAFLK','ABDGHIJK':'HJBDAGIK',
  'ABDGHIJL':'HJBDAGLI','ABDGHIKL':'IGBDAHLK','ABDGHJKL':'HJBDAGLK',
  'ABDGIJKL':'IJBDAGLK','ABDHIJKL':'IJBDAHLK','ABEFGHIJ':'HJBFAGEI',
  'ABEFGHIK':'EGBFAHIK','ABEFGHIL':'EGBFAHLI','ABEFGHJK':'HJBFAGEK',
  'ABEFGHJL':'HJBFAGLE','ABEFGHKL':'EGBFAHLK','ABEFGIJK':'EJBFAGIK',
  'ABEFGIJL':'EJBFAGLI','ABEFGIKL':'EGBAIFLK','ABEFGJKL':'EJBFAGLK',
  'ABEFHIJK':'EJBFAHIK','ABEFHIJL':'EJBFAHLI','ABEFHIKL':'EIBFAHLK',
  'ABEFHJKL':'EJBFAHLK','ABEFIJKL':'EJBAIFLK','ABEGHIJK':'EJBAHGIK',
  'ABEGHIJL':'EJBAHGLI','ABEGHIKL':'EGBAIHLK','ABEGHJKL':'EJBAHGLK',
  'ABEGIJKL':'EJBAIGLK','ABEHIJKL':'EJBAIHLK','ABFGHIJK':'HJBFAGIK',
  'ABFGHIJL':'HJBFAGLI','ABFGHIKL':'HGBAIFLK','ABFGHJKL':'HJBFAGLK',
  'ABFGIJKL':'IJBFAGLK','ABFHIJKL':'HJBAIFLK','ABGHIJKL':'HJBAIGLK',
  'ACDEFGHI':'HGECAFDI','ACDEFGHJ':'HGJCAFDE','ACDEFGHK':'HGECAFDK',
  'ACDEFGHL':'HGFCADLE','ACDEFGIJ':'CGJDAFEI','ACDEFGIK':'CGEDAFIK',
  'ACDEFGIL':'CGEDAFLI','ACDEFGJK':'CGJDAFEK','ACDEFGJL':'CGJDAFLE',
  'ACDEFGKL':'CGEDAFLK','ACDEFHIJ':'HJECAFDI','ACDEFHIK':'HEFCADIK',
  'ACDEFHIL':'HEFCADLI','ACDEFHJK':'HJECAFDK','ACDEFHJL':'HJFCADLE',
  'ACDEFHKL':'HEFCADLK','ACDEFIJK':'CJEDAFIK','ACDEFIJL':'CJEDAFLI',
  'ACDEFIKL':'CEIDAFLK','ACDEFJKL':'CJEDAFLK','ACDEGHIJ':'HGJCADEI',
  'ACDEGHIK':'HGECADIK','ACDEGHIL':'HGECADLI','ACDEGHJK':'HGJCADEK',
  'ACDEGHJL':'HGJCADLE','ACDEGHKL':'HGECADLK','ACDEGIJK':'EGJCADIK',
  'ACDEGIJL':'EGJCADLI','ACDEGIKL':'EGICADLK','ACDEGJKL':'EGJCADLK',
  'ACDEHIJK':'HJECADIK','ACDEHIJL':'HJECADLI','ACDEHIKL':'HEICADLK',
  'ACDEHJKL':'HJECADLK','ACDEIJKL':'EJICADLK','ACDFGHIJ':'HGJCAFDI',
  'ACDFGHIK':'HGFCADIK','ACDFGHIL':'HGFCADLI','ACDFGHJK':'HGJCAFDK',
  'ACDFGHJL':'CGJDAFLH','ACDFGHKL':'HGFCADLK','ACDFGIJK':'CGJDAFIK',
  'ACDFGIJL':'CGJDAFLI','ACDFGIKL':'CGIDAFLK','ACDFGJKL':'CGJDAFLK',
  'ACDFHIJK':'HJFCADIK','ACDFHIJL':'HJFCADLI','ACDFHIKL':'HFICADLK',
  'ACDFHJKL':'HJFCADLK','ACDFIJKL':'CJIDAFLK','ACDGHIJK':'HGJCADIK',
  'ACDGHIJL':'HGJCADLI','ACDGHIKL':'HGICADLK','ACDGHJKL':'HGJCADLK',
  'ACDGIJKL':'IGJCADLK','ACDHIJKL':'HJICADLK','ACEFGHIJ':'HGJCAFEI',
  'ACEFGHIK':'HGECAFIK','ACEFGHIL':'HGECAFLI','ACEFGHJK':'HGJCAFEK',
  'ACEFGHJL':'HGJCAFLE','ACEFGHKL':'HGECAFLK','ACEFGIJK':'EGJCAFIK',
  'ACEFGIJL':'EGJCAFLI','ACEFGIKL':'EGICAFLK','ACEFGJKL':'EGJCAFLK',
  'ACEFHIJK':'HJECAFIK','ACEFHIJL':'HJECAFLI','ACEFHIKL':'HEICAFLK',
  'ACEFHJKL':'HJECAFLK','ACEFIJKL':'EJICAFLK','ACEGHIJK':'EGJCAHIK',
  'ACEGHIJL':'EGJCAHLI','ACEGHIKL':'EGICAHLK','ACEGHJKL':'EGJCAHLK',
  'ACEGIJKL':'EJICAGLK','ACEHIJKL':'EJICAHLK','ACFGHIJK':'HGJCAFIK',
  'ACFGHIJL':'HGJCAFLI','ACFGHIKL':'HGICAFLK','ACFGHJKL':'HGJCAFLK',
  'ACFGIJKL':'IGJCAFLK','ACFHIJKL':'HJICAFLK','ACGHIJKL':'HJICAGLK',
  'ADEFGHIJ':'HGJDAFEI','ADEFGHIK':'HGEDAFIK','ADEFGHIL':'HGEDAFLI',
  'ADEFGHJK':'HGJDAFEK','ADEFGHJL':'HGJDAFLE','ADEFGHKL':'HGEDAFLK',
  'ADEFGIJK':'EGJDAFIK','ADEFGIJL':'EGJDAFLI','ADEFGIKL':'EGIDAFLK',
  'ADEFGJKL':'EGJDAFLK','ADEFHIJK':'HJEDAFIK','ADEFHIJL':'HJEDAFLI',
  'ADEFHIKL':'HEIDAFLK','ADEFHJKL':'HJEDAFLK','ADEFIJKL':'EJIDAFLK',
  'ADEGHIJK':'EGJDAHIK','ADEGHIJL':'EGJDAHLI','ADEGHIKL':'EGIDAHLK',
  'ADEGHJKL':'EGJDAHLK','ADEGIJKL':'EJIDAGLK','ADEHIJKL':'EJIDAHLK',
  'ADFGHIJK':'HGJDAFIK','ADFGHIJL':'HGJDAFLI','ADFGHIKL':'HGIDAFLK',
  'ADFGHJKL':'HGJDAFLK','ADFGIJKL':'IGJDAFLK','ADFHIJKL':'HJIDAFLK',
  'ADGHIJKL':'HJIDAGLK','AEFGHIJK':'EGJFAHIK','AEFGHIJL':'EGJFAHLI',
  'AEFGHIKL':'EGIFAHLK','AEFGHJKL':'EGJFAHLK','AEFGIJKL':'EJIFAGLK',
  'AEFHIJKL':'EJIFAHLK','AEGHIJKL':'EJIAHGLK','AFGHIJKL':'HJIFAGLK',
  'BCDEFGHI':'CGBDHFEI','BCDEFGHJ':'HGBCJFDE','BCDEFGHK':'CGBDHFEK',
  'BCDEFGHL':'CGBDHFLE','BCDEFGIJ':'CGBDJFEI','BCDEFGIK':'CGBDEFIK',
  'BCDEFGIL':'CGBDEFLI','BCDEFGJK':'CGBDJFEK','BCDEFGJL':'CGBDJFLE',
  'BCDEFGKL':'CGBDEFLK','BCDEFHIJ':'CJBDHFEI','BCDEFHIK':'CEBDHFIK',
  'BCDEFHIL':'CEBDHFLI','BCDEFHJK':'CJBDHFEK','BCDEFHJL':'CJBDHFLE',
  'BCDEFHKL':'CEBDHFLK','BCDEFIJK':'CJBDEFIK','BCDEFIJL':'CJBDEFLI',
  'BCDEFIKL':'CEBDIFLK','BCDEFJKL':'CJBDEFLK','BCDEGHIJ':'HGBCJDEI',
  'BCDEGHIK':'EGBCHDIK','BCDEGHIL':'EGBCHDLI','BCDEGHJK':'HGBCJDEK',
  'BCDEGHJL':'HGBCJDLE','BCDEGHKL':'EGBCHDLK','BCDEGIJK':'EGBCJDIK',
  'BCDEGIJL':'EGBCJDLI','BCDEGIKL':'EGBCIDLK','BCDEGJKL':'EGBCJDLK',
  'BCDEHIJK':'EJBCHDIK','BCDEHIJL':'EJBCHDLI','BCDEHIKL':'EIBCHDLK',
  'BCDEHJKL':'EJBCHDLK','BCDEIJKL':'EJBCIDLK','BCDFGHIJ':'HGBCJFDI',
  'BCDFGHIK':'CGBDHFIK','BCDFGHIL':'CGBDHFLI','BCDFGHJK':'HGBCJFDK',
  'BCDFGHJL':'CGBDHFLJ','BCDFGHKL':'CGBDHFLK','BCDFGIJK':'CGBDJFIK',
  'BCDFGIJL':'CGBDJFLI','BCDFGIKL':'CGBDIFLK','BCDFGJKL':'CGBDJFLK',
  'BCDFHIJK':'CJBDHFIK','BCDFHIJL':'CJBDHFLI','BCDFHIKL':'CIBDHFLK',
  'BCDFHJKL':'CJBDHFLK','BCDFIJKL':'CJBDIFLK','BCDGHIJK':'HGBCJDIK',
  'BCDGHIJL':'HGBCJDLI','BCDGHIKL':'HGBCIDLK','BCDGHJKL':'HGBCJDLK',
  'BCDGIJKL':'IGBCJDLK','BCDHIJKL':'HJBCIDLK','BCEFGHIJ':'HGBCJFEI',
  'BCEFGHIK':'EGBCHFIK','BCEFGHIL':'EGBCHFLI','BCEFGHJK':'HGBCJFEK',
  'BCEFGHJL':'HGBCJFLE','BCEFGHKL':'EGBCHFLK','BCEFGIJK':'EGBCJFIK',
  'BCEFGIJL':'EGBCJFLI','BCEFGIKL':'EGBCIFLK','BCEFGJKL':'EGBCJFLK',
  'BCEFHIJK':'EJBCHFIK','BCEFHIJL':'EJBCHFLI','BCEFHIKL':'EIBCHFLK',
  'BCEFHJKL':'EJBCHFLK','BCEFIJKL':'EJBCIFLK','BCEGHIJK':'EJBCHGIK',
  'BCEGHIJL':'EJBCHGLI','BCEGHIKL':'EGBCIHLK','BCEGHJKL':'EJBCHGLK',
  'BCEGIJKL':'EJBCIGLK','BCEHIJKL':'EJBCIHLK','BCFGHIJK':'HGBCJFIK',
  'BCFGHIJL':'HGBCJFLI','BCFGHIKL':'HGBCIFLK','BCFGHJKL':'HGBCJFLK',
  'BCFGIJKL':'IGBCJFLK','BCFHIJKL':'HJBCIFLK','BCGHIJKL':'HJBCIGLK',
  'BDEFGHIJ':'HGBDJFEI','BDEFGHIK':'EGBDHFIK','BDEFGHIL':'EGBDHFLI',
  'BDEFGHJK':'HGBDJFEK','BDEFGHJL':'HGBDJFLE','BDEFGHKL':'EGBDHFLK',
  'BDEFGIJK':'EGBDJFIK','BDEFGIJL':'EGBDJFLI','BDEFGIKL':'EGBDIFLK',
  'BDEFGJKL':'EGBDJFLK','BDEFHIJK':'EJBDHFIK','BDEFHIJL':'EJBDHFLI',
  'BDEFHIKL':'EIBDHFLK','BDEFHJKL':'EJBDHFLK','BDEFIJKL':'EJBDIFLK',
  'BDEGHIJK':'EJBDHGIK','BDEGHIJL':'EJBDHGLI','BDEGHIKL':'EGBDIHLK',
  'BDEGHJKL':'EJBDHGLK','BDEGIJKL':'EJBDIGLK','BDEHIJKL':'EJBDIHLK',
  'BDFGHIJK':'HGBDJFIK','BDFGHIJL':'HGBDJFLI','BDFGHIKL':'HGBDIFLK',
  'BDFGHJKL':'HGBDJFLK','BDFGIJKL':'IGBDJFLK','BDFHIJKL':'HJBDIFLK',
  'BDGHIJKL':'HJBDIGLK','BEFGHIJK':'EJBFHGIK','BEFGHIJL':'EJBFHGLI',
  'BEFGHIKL':'EGBFIHLK','BEFGHJKL':'EJBFHGLK','BEFGIJKL':'EJBFIGLK',
  'BEFHIJKL':'EJBFIHLK','BEGHIJKL':'EJIBHGLK','BFGHIJKL':'HJBFIGLK',
  'CDEFGHIJ':'CGJDHFEI','CDEFGHIK':'CGEDHFIK','CDEFGHIL':'CGEDHFLI',
  'CDEFGHJK':'CGJDHFEK','CDEFGHJL':'CGJDHFLE','CDEFGHKL':'CGEDHFLK',
  'CDEFGIJK':'CGEDJFIK','CDEFGIJL':'CGEDJFLI','CDEFGIKL':'CGEDIFLK',
  'CDEFGJKL':'CGEDJFLK','CDEFHIJK':'CJEDHFIK','CDEFHIJL':'CJEDHFLI',
  'CDEFHIKL':'CEIDHFLK','CDEFHJKL':'CJEDHFLK','CDEFIJKL':'CJEDIFLK',
  'CDEGHIJK':'EGJCHDIK','CDEGHIJL':'EGJCHDLI','CDEGHIKL':'EGICHDLK',
  'CDEGHJKL':'EGJCHDLK','CDEGIJKL':'EGICJDLK','CDEHIJKL':'EJICHDLK',
  'CDFGHIJK':'CGJDHFIK','CDFGHIJL':'CGJDHFLI','CDFGHIKL':'CGIDHFLK',
  'CDFGHJKL':'CGJDHFLK','CDFGIJKL':'CGIDJFLK','CDFHIJKL':'CJIDHFLK',
  'CDGHIJKL':'HGICJDLK','CEFGHIJK':'EGJCHFIK','CEFGHIJL':'EGJCHFLI',
  'CEFGHIKL':'EGICHFLK','CEFGHJKL':'EGJCHFLK','CEFGIJKL':'EGICJFLK',
  'CEFHIJKL':'EJICHFLK','CEGHIJKL':'EJICHGLK','CFGHIJKL':'HGICJFLK',
  'DEFGHIJK':'EGJDHFIK','DEFGHIJL':'EGJDHFLI','DEFGHIKL':'EGIDHFLK',
  'DEFGHJKL':'EGJDHFLK','DEFGIJKL':'EGIDJFLK','DEFHIJKL':'EJIDHFLK',
  'DEGHIJKL':'EJIDHGLK','DFGHIJKL':'HGIDJFLK','EFGHIJKL':'EJIFHGLK',
};
const COMB_SLOT_ORDER = ['A','B','D','E','G','I','K','L'];

// Mappa ufficiale FIFA 2026: matchId → {casa, trasf} del turno precedente
// Fonte: Wikipedia 2026_FIFA_World_Cup_knockout_stage
const BRACKET_FEEDS = {
  // Ottavi (M89-M96) ← vincitori sedicesimi
  // O1=M89: Vin(M74/S02) vs Vin(M77/S05)
  'O1': { casa:{fase:'sedicesimi',id:'S02'}, trasf:{fase:'sedicesimi',id:'S05'} },
  // O2=M90: Vin(M73/S01) vs Vin(M75/S03)
  'O2': { casa:{fase:'sedicesimi',id:'S01'}, trasf:{fase:'sedicesimi',id:'S03'} },
  // O3=M93: Vin(M83/S11) vs Vin(M84/S12)
  'O3': { casa:{fase:'sedicesimi',id:'S11'}, trasf:{fase:'sedicesimi',id:'S12'} },
  // O4=M94: Vin(M81/S09) vs Vin(M82/S10)
  'O4': { casa:{fase:'sedicesimi',id:'S09'}, trasf:{fase:'sedicesimi',id:'S10'} },
  // O5=M91: Vin(M76/S04) vs Vin(M78/S06)
  'O5': { casa:{fase:'sedicesimi',id:'S04'}, trasf:{fase:'sedicesimi',id:'S06'} },
  // O6=M92: Vin(M79/S07) vs Vin(M80/S08)
  'O6': { casa:{fase:'sedicesimi',id:'S07'}, trasf:{fase:'sedicesimi',id:'S08'} },
  // O7=M95: Vin(M86/S14) vs Vin(M88/S16)
  'O7': { casa:{fase:'sedicesimi',id:'S14'}, trasf:{fase:'sedicesimi',id:'S16'} },
  // O8=M96: Vin(M85/S13) vs Vin(M87/S15)
  'O8': { casa:{fase:'sedicesimi',id:'S13'}, trasf:{fase:'sedicesimi',id:'S15'} },
  // Quarti (M97-M100) ← vincitori ottavi
  // Q1=M97: Vin(M89/O1) vs Vin(M90/O2)
  'Q1': { casa:{fase:'ottavi',id:'O1'}, trasf:{fase:'ottavi',id:'O2'} },
  // Q2=M98: Vin(M93/O3) vs Vin(M94/O4)
  'Q2': { casa:{fase:'ottavi',id:'O3'}, trasf:{fase:'ottavi',id:'O4'} },
  // Q3=M99: Vin(M91/O5) vs Vin(M92/O6)
  'Q3': { casa:{fase:'ottavi',id:'O5'}, trasf:{fase:'ottavi',id:'O6'} },
  // Q4=M100: Vin(M95/O7) vs Vin(M96/O8)
  'Q4': { casa:{fase:'ottavi',id:'O7'}, trasf:{fase:'ottavi',id:'O8'} },
  // Semifinali (M101-M102) ← vincitori quarti
  'SF1': { casa:{fase:'quarti',id:'Q1'}, trasf:{fase:'quarti',id:'Q2'} },
  'SF2': { casa:{fase:'quarti',id:'Q3'}, trasf:{fase:'quarti',id:'Q4'} },
  // Finale (M104) ← vincitori semifinali
  'F':   { casa:{fase:'semifinali',id:'SF1'}, trasf:{fase:'semifinali',id:'SF2'} },
};

const GIOCATORI = [
  // ARGENTINA
  { cognome: 'Messi', nome: 'Lionel', squadra: 'ARG' },
  { cognome: 'Martínez', nome: 'Lautaro', squadra: 'ARG' },
  { cognome: 'Mac Allister', nome: 'Alexis', squadra: 'ARG' },
  { cognome: 'Molina', nome: 'Nahuel', squadra: 'ARG' },
  { cognome: 'Paredes', nome: 'Leandro', squadra: 'ARG' },
  { cognome: 'Álvarez', nome: 'Julián', squadra: 'ARG' },
  { cognome: 'De Paul', nome: 'Rodrigo', squadra: 'ARG' },
  { cognome: 'Fernández', nome: 'Enzo', squadra: 'ARG' },
  { cognome: 'Romero', nome: 'Cristian', squadra: 'ARG' },
  { cognome: 'Martínez', nome: 'Lisandro', squadra: 'ARG' },
  { cognome: 'Otamendi', nome: 'Nicolás', squadra: 'ARG' },
  { cognome: 'Tagliafico', nome: 'Nicolás', squadra: 'ARG' },
  { cognome: 'González', nome: 'Nicolás', squadra: 'ARG' },
  { cognome: 'Paz', nome: 'Nico', squadra: 'ARG' },
  { cognome: 'Simeone', nome: 'Giuliano', squadra: 'ARG' },
  { cognome: 'Palacios', nome: 'Exequiel', squadra: 'ARG' },
  { cognome: 'Lo Celso', nome: 'Giovani', squadra: 'ARG' },
  { cognome: 'Almada', nome: 'Thiago', squadra: 'ARG' },
  // AUSTRALIA
  { cognome: 'Hrustić', nome: 'Ajdin', squadra: 'AUS' },
  { cognome: 'Leckie', nome: 'Mathew', squadra: 'AUS' },
  { cognome: 'Irvine', nome: 'Jackson', squadra: 'AUS' },
  // AUSTRIA
  { cognome: 'Alaba', nome: 'David', squadra: 'AUT' },
  { cognome: 'Arnautović', nome: 'Marko', squadra: 'AUT' },
  { cognome: 'Gregoritsch', nome: 'Michael', squadra: 'AUT' },
  { cognome: 'Wimmer', nome: 'Patrick', squadra: 'AUT' },
  { cognome: 'Sabitzer', nome: 'Marcel', squadra: 'AUT' },
  { cognome: 'Laimer', nome: 'Konrad', squadra: 'AUT' },
  // BELGIO
  { cognome: 'Lukaku', nome: 'Romelu', squadra: 'BEL' },
  { cognome: 'De Bruyne', nome: 'Kevin', squadra: 'BEL' },
  { cognome: 'Trossard', nome: 'Leandro', squadra: 'BEL' },
  { cognome: 'Doku', nome: 'Jérémy', squadra: 'BEL' },
  { cognome: 'De Ketelaere', nome: 'Charles', squadra: 'BEL' },
  { cognome: 'Castagne', nome: 'Timothy', squadra: 'BEL' },
  { cognome: 'Witsel', nome: 'Axel', squadra: 'BEL' },
  // BOSNIA
  { cognome: 'Džeko', nome: 'Edin', squadra: 'BIH' },
  { cognome: 'Kolašinac', nome: 'Sead', squadra: 'BIH' },
  { cognome: 'Demirović', nome: 'Ermedin', squadra: 'BIH' },
  // BRASILE
  { cognome: 'Vinícius', nome: 'Jr', squadra: 'BRA' },
  { cognome: 'Neymar', nome: 'Jr', squadra: 'BRA' },
  { cognome: 'Raphinha', nome: '', squadra: 'BRA' },
  { cognome: 'Endrick', nome: '', squadra: 'BRA' },
  { cognome: 'Cunha', nome: 'Matheus', squadra: 'BRA' },
  { cognome: 'Casemiro', nome: '', squadra: 'BRA' },
  { cognome: 'Paquetà', nome: 'Lucas', squadra: 'BRA' },
  { cognome: 'Marquinhos', nome: '', squadra: 'BRA' },
  { cognome: 'Guimarães', nome: 'Bruno', squadra: 'BRA' },
  { cognome: 'Martinelli', nome: 'Gabriel', squadra: 'BRA' },
  { cognome: 'Magalhães', nome: 'Gabriel', squadra: 'BRA' },
  { cognome: 'Bremer', nome: '', squadra: 'BRA' },
  // CANADA
  { cognome: 'Davies', nome: 'Alphonso', squadra: 'CAN' },
  { cognome: 'David', nome: 'Jonathan', squadra: 'CAN' },
  { cognome: 'Eustáquio', nome: 'Stephen', squadra: 'CAN' },
  { cognome: 'Larin', nome: 'Cyle', squadra: 'CAN' },
  { cognome: 'Buchanan', nome: 'Tajon', squadra: 'CAN' },
  // COSTA D'AVORIO
  { cognome: 'Kessié', nome: 'Franck', squadra: 'CIV' },
  { cognome: 'Sangaré', nome: 'Ibrahim', squadra: 'CIV' },
  { cognome: 'Pépé', nome: 'Nicolas', squadra: 'CIV' },
  { cognome: 'Adingra', nome: 'Simon', squadra: 'CIV' },
  { cognome: 'Wahi', nome: 'Elye', squadra: 'CIV' },
  // RD CONGO
  { cognome: 'Mbemba', nome: 'Chancel', squadra: 'COD' },
  { cognome: 'Banza', nome: 'Simon', squadra: 'COD' },
  { cognome: 'Wissa', nome: 'Yoane', squadra: 'COD' },
  { cognome: 'Bakambu', nome: 'Cédric', squadra: 'COD' },
  // COLOMBIA
  { cognome: 'Díaz', nome: 'Luis', squadra: 'COL' },
  { cognome: 'Rodríguez', nome: 'James', squadra: 'COL' },
  { cognome: 'Quintero', nome: 'Juan Fernando', squadra: 'COL' },
  { cognome: 'Sánchez', nome: 'Dávinson', squadra: 'COL' },
  { cognome: 'Ríos', nome: 'Richard', squadra: 'COL' },
  { cognome: 'Suárez', nome: 'Luis', squadra: 'COL' },
  { cognome: 'Hernández', nome: 'Cucho', squadra: 'COL' },
  { cognome: 'Córdoba', nome: 'Jhon', squadra: 'COL' },
  { cognome: 'Arias', nome: 'Jhon', squadra: 'COL' },
  { cognome: 'Lerma', nome: 'Jefferson', squadra: 'COL' },
  { cognome: 'Carrascal', nome: 'Jorge', squadra: 'COL' },
  // CAPO VERDE
  { cognome: 'Pina', nome: 'Kelvin', squadra: 'CPV' },
  { cognome: 'Rodrigues', nome: 'Garry', squadra: 'CPV' },
  // CROAZIA
  { cognome: 'Modrić', nome: 'Luka', squadra: 'CRO' },
  { cognome: 'Kovačić', nome: 'Mateo', squadra: 'CRO' },
  { cognome: 'Vlašić', nome: 'Nikola', squadra: 'CRO' },
  { cognome: 'Kramarić', nome: 'Andrej', squadra: 'CRO' },
  { cognome: 'Gvardiol', nome: 'Joško', squadra: 'CRO' },
  { cognome: 'Perišić', nome: 'Ivan', squadra: 'CRO' },
  // CURAÇAO
  { cognome: 'Bacuna', nome: 'Juninho', squadra: 'CUW' },
  // REPUBBLICA CECA
  { cognome: 'Hložek', nome: 'Adam', squadra: 'CZE' },
  { cognome: 'Schick', nome: 'Patrik', squadra: 'CZE' },
  { cognome: 'Souček', nome: 'Tomáš', squadra: 'CZE' },
  // ECUADOR
  { cognome: 'Valencia', nome: 'Enner', squadra: 'ECU' },
  { cognome: 'Plata', nome: 'Gonzalo', squadra: 'ECU' },
  { cognome: 'Sarmiento', nome: 'Jeremy', squadra: 'ECU' },
  { cognome: 'Caicedo', nome: 'Moisés', squadra: 'ECU' },
  // EGITTO
  { cognome: 'Salah', nome: 'Mohamed', squadra: 'EGY' },
  { cognome: 'Marmoush', nome: 'Omar', squadra: 'EGY' },
  // INGHILTERRA
  { cognome: 'Bellingham', nome: 'Jude', squadra: 'ENG' },
  { cognome: 'Kane', nome: 'Harry', squadra: 'ENG' },
  { cognome: 'Saka', nome: 'Bukayo', squadra: 'ENG' },
  { cognome: 'Rashford', nome: 'Marcus', squadra: 'ENG' },
  { cognome: 'Rice', nome: 'Declan', squadra: 'ENG' },
  { cognome: 'Stones', nome: 'John', squadra: 'ENG' },
  { cognome: 'Mainoo', nome: 'Kobbie', squadra: 'ENG' },
  { cognome: 'Eze', nome: 'Eberechi', squadra: 'ENG' },
  { cognome: 'Watkins', nome: 'Ollie', squadra: 'ENG' },
  { cognome: 'Gordon', nome: 'Anthony', squadra: 'ENG' },
  { cognome: 'Toney', nome: 'Ivan', squadra: 'ENG' },
  { cognome: 'Madueke', nome: 'Noni', squadra: 'ENG' },
  { cognome: 'Rogers', nome: 'Morgan', squadra: 'ENG' },
  // SPAGNA
  { cognome: 'Yamal', nome: 'Lamine', squadra: 'ESP' },
  { cognome: 'Pedri', nome: '', squadra: 'ESP' },
  { cognome: 'Rodri', nome: '', squadra: 'ESP' },
  { cognome: 'Gavi', nome: '', squadra: 'ESP' },
  { cognome: 'Olmo', nome: 'Dani', squadra: 'ESP' },
  { cognome: 'Oyarzabal', nome: 'Mikel', squadra: 'ESP' },
  { cognome: 'Williams', nome: 'Nico', squadra: 'ESP' },
  { cognome: 'Zubimendi', nome: 'Martín', squadra: 'ESP' },
  { cognome: 'Fabian Ruiz', nome: 'Fabián', squadra: 'ESP' },
  { cognome: 'Merino', nome: 'Mikel', squadra: 'ESP' },
  { cognome: 'Grimaldo', nome: 'Alejandro', squadra: 'ESP' },
  { cognome: 'Ferran Torres', nome: 'Ferran', squadra: 'ESP' },
  { cognome: 'Cubarsí', nome: 'Pau', squadra: 'ESP' },
  { cognome: 'Laporte', nome: 'Aymeric', squadra: 'ESP' },
  { cognome: 'Cucurella', nome: 'Marc', squadra: 'ESP' },
  { cognome: 'Porro', nome: 'Pedro', squadra: 'ESP' },
  // FRANCIA
  { cognome: 'Mbappé', nome: 'Kylian', squadra: 'FRA' },
  { cognome: 'Dembélé', nome: 'Ousmane', squadra: 'FRA' },
  { cognome: 'Kanté', nome: "N'Golo", squadra: 'FRA' },
  { cognome: 'Thuram', nome: 'Marcus', squadra: 'FRA' },
  { cognome: 'Olise', nome: 'Michael', squadra: 'FRA' },
  { cognome: 'Koundé', nome: 'Jules', squadra: 'FRA' },
  { cognome: 'Rabiot', nome: 'Adrien', squadra: 'FRA' },
  { cognome: 'Tchouaméni', nome: 'Aurélien', squadra: 'FRA' },
  { cognome: 'Zaïre-Emery', nome: 'Warren', squadra: 'FRA' },
  { cognome: 'Koné', nome: 'Manu', squadra: 'FRA' },
  { cognome: 'Barcola', nome: 'Bradley', squadra: 'FRA' },
  { cognome: 'Cherki', nome: 'Rayan', squadra: 'FRA' },
  { cognome: 'Doué', nome: 'Désiré', squadra: 'FRA' },
  { cognome: 'Saliba', nome: 'William', squadra: 'FRA' },
  { cognome: 'Upamecano', nome: 'Dayot', squadra: 'FRA' },
  { cognome: 'Konaté', nome: 'Ibrahima', squadra: 'FRA' },
  { cognome: 'Hernandez', nome: 'Lucas', squadra: 'FRA' },
  { cognome: 'Hernandez', nome: 'Theo', squadra: 'FRA' },
  { cognome: 'Maignan', nome: 'Mike', squadra: 'FRA' },
  { cognome: 'Mateta', nome: 'Jean-Philippe', squadra: 'FRA' },
  // GERMANIA
  { cognome: 'Wirtz', nome: 'Florian', squadra: 'GER' },
  { cognome: 'Musiala', nome: 'Jamal', squadra: 'GER' },
  { cognome: 'Havertz', nome: 'Kai', squadra: 'GER' },
  { cognome: 'Kimmich', nome: 'Joshua', squadra: 'GER' },
  { cognome: 'Sané', nome: 'Leroy', squadra: 'GER' },
  { cognome: 'Rüdiger', nome: 'Antonio', squadra: 'GER' },
  { cognome: 'Goretzka', nome: 'Leon', squadra: 'GER' },
  { cognome: 'Pavlovic', nome: 'Aleksandar', squadra: 'GER' },
  { cognome: 'Stiller', nome: 'Angelo', squadra: 'GER' },
  { cognome: 'Schlotterbeck', nome: 'Nico', squadra: 'GER' },
  { cognome: 'Tah', nome: 'Jonathan', squadra: 'GER' },
  { cognome: 'Thiaw', nome: 'Malick', squadra: 'GER' },
  { cognome: 'Undav', nome: 'Deniz', squadra: 'GER' },
  { cognome: 'Woltemade', nome: 'Nick', squadra: 'GER' },
  // GHANA
  { cognome: 'Partey', nome: 'Thomas', squadra: 'GHA' },
  { cognome: 'Fatawu', nome: 'Abdul Fatawu', squadra: 'GHA' },
  { cognome: 'Ayew', nome: 'Jordan', squadra: 'GHA' },
  { cognome: 'Sulemana', nome: 'Kamaldeen', squadra: 'GHA' },
  // HAITI
  { cognome: 'Pierre', nome: 'Leverton', squadra: 'HAI' },
  { cognome: 'Bellegarde', nome: 'Jean-Ricner', squadra: 'HAI' },
  // IRAN
  { cognome: 'Taremi', nome: 'Mehdi', squadra: 'IRN' },
  // IRAQ
  { cognome: 'Ali', nome: 'Mohanad', squadra: 'IRQ' },
  { cognome: 'Iqbal', nome: 'Zidane', squadra: 'IRQ' },
  // GIAPPONE
  { cognome: 'Kubo', nome: 'Takefusa', squadra: 'JPN' },
  { cognome: 'Doan', nome: 'Ritsu', squadra: 'JPN' },
  { cognome: 'Endo', nome: 'Wataru', squadra: 'JPN' },
  { cognome: 'Ito', nome: 'Junya', squadra: 'JPN' },
  { cognome: 'Kamada', nome: 'Daichi', squadra: 'JPN' },
  { cognome: 'Ueda', nome: 'Ayase', squadra: 'JPN' },
  // GIORDANIA
  { cognome: 'Al-Taamari', nome: 'Musa', squadra: 'JOR' },
  // COREA DEL SUD
  { cognome: 'Son', nome: 'Heung-min', squadra: 'KOR' },
  { cognome: 'Lee', nome: 'Kang-in', squadra: 'KOR' },
  { cognome: 'Hwang', nome: 'Hee-chan', squadra: 'KOR' },
  { cognome: 'Hwang', nome: 'In-beom', squadra: 'KOR' },
  { cognome: 'Cho', nome: 'Gue-sung', squadra: 'KOR' },
  // ARABIA SAUDITA
  { cognome: 'Al-Dawsari', nome: 'Salem', squadra: 'KSA' },
  { cognome: 'Al-Ghannam', nome: '', squadra: 'KSA' },
  { cognome: 'Al-Shehri', nome: 'Saleh', squadra: 'KSA' },
  // MAROCCO
  { cognome: 'Hakimi', nome: 'Achraf', squadra: 'MAR' },
  { cognome: 'Mazraoui', nome: 'Noussair', squadra: 'MAR' },
  { cognome: 'Ounahi', nome: 'Azzedine', squadra: 'MAR' },
  { cognome: 'Díaz', nome: 'Brahim', squadra: 'MAR' },
  { cognome: 'El Kaabi', nome: 'Ayoub', squadra: 'MAR' },
  // MESSICO
  { cognome: 'Giménez', nome: 'Santiago', squadra: 'MEX' },
  { cognome: 'Alvarado', nome: 'Roberto', squadra: 'MEX' },
  { cognome: 'Vega', nome: 'Alexis', squadra: 'MEX' },
  { cognome: 'Jiménez', nome: 'Raúl', squadra: 'MEX' },
  // PAESI BASSI
  { cognome: 'Van Dijk', nome: 'Virgil', squadra: 'NED' },
  { cognome: 'De Jong', nome: 'Frenkie', squadra: 'NED' },
  { cognome: 'Depay', nome: 'Memphis', squadra: 'NED' },
  { cognome: 'Gakpo', nome: 'Cody', squadra: 'NED' },
  { cognome: 'Dumfries', nome: 'Denzel', squadra: 'NED' },
  { cognome: 'Weghorst', nome: 'Wout', squadra: 'NED' },
  { cognome: 'Reijnders', nome: 'Tijjani', squadra: 'NED' },
  { cognome: 'Aké', nome: 'Nathan', squadra: 'NED' },
  { cognome: 'Koopmeiners', nome: 'Teun', squadra: 'NED' },
  { cognome: 'Malen', nome: 'Donyell', squadra: 'NED' },
  { cognome: 'De Roon', nome: 'Marten', squadra: 'NED' },
  { cognome: 'Lang', nome: 'Noa', squadra: 'NED' },
  { cognome: 'Gravenberch', nome: 'Ryan', squadra: 'NED' },
  // NORVEGIA
  { cognome: 'Haaland', nome: 'Erling', squadra: 'NOR' },
  { cognome: 'Sørloth', nome: 'Alexander', squadra: 'NOR' },
  { cognome: 'Berge', nome: 'Sander', squadra: 'NOR' },
  { cognome: 'Ødegaard', nome: 'Martin', squadra: 'NOR' },
  // NUOVA ZELANDA
  { cognome: 'Bell', nome: 'Liberato', squadra: 'NZL' },
  { cognome: 'Garbett', nome: 'Matthew', squadra: 'NZL' },
  { cognome: 'Wood', nome: 'Chris', squadra: 'NZL' },
  { cognome: 'Cacace', nome: 'Liberato', squadra: 'NZL' },
  // PANAMA
  { cognome: 'Blackman', nome: 'César', squadra: 'PAN' },
  { cognome: 'Davis', nome: 'Éric', squadra: 'PAN' },
  { cognome: 'Quintero', nome: 'Alberto', squadra: 'PAN' },
  { cognome: 'Waterman', nome: 'Cecilio', squadra: 'PAN' },
  { cognome: 'Godoy', nome: 'Aníbal', squadra: 'PAN' },
  // PARAGUAY
  { cognome: 'Enciso', nome: 'Julio', squadra: 'PAR' },
  { cognome: 'Almirón', nome: 'Miguel', squadra: 'PAR' },
  { cognome: 'Sanabria', nome: 'Antonio', squadra: 'PAR' },
  // PORTOGALLO
  { cognome: 'Ronaldo', nome: 'Cristiano', squadra: 'POR' },
  { cognome: 'Fernandes', nome: 'Bruno', squadra: 'POR' },
  { cognome: 'Leão', nome: 'Rafael', squadra: 'POR' },
  { cognome: 'Neto', nome: 'Pedro', squadra: 'POR' },
  { cognome: 'Inácio', nome: 'Gonçalo', squadra: 'POR' },
  { cognome: 'Silva', nome: 'Bernardo', squadra: 'POR' },
  { cognome: 'Ramos', nome: 'Gonçalo', squadra: 'POR' },
  { cognome: 'Félix', nome: 'João', squadra: 'POR' },
  { cognome: 'Vitinha', nome: '', squadra: 'POR' },
  { cognome: 'Neves', nome: 'João', squadra: 'POR' },
  { cognome: 'Neves', nome: 'Rúben', squadra: 'POR' },
  { cognome: 'Mendes', nome: 'Nuno', squadra: 'POR' },
  { cognome: 'Cancelo', nome: 'João', squadra: 'POR' },
  { cognome: 'Dias', nome: 'Rúben', squadra: 'POR' },
  { cognome: 'Dalot', nome: 'Diogo', squadra: 'POR' },
  { cognome: 'Conceição', nome: 'Francisco', squadra: 'POR' },
  { cognome: 'Trincão', nome: '', squadra: 'POR' },
  // QATAR
  { cognome: 'Afif', nome: 'Akram', squadra: 'QAT' },
  { cognome: 'Muntari', nome: 'Almoez', squadra: 'QAT' },
  // SUDAFRICA
  { cognome: 'Foster', nome: 'Lyle', squadra: 'RSA' },
  { cognome: 'Mokoena', nome: 'Teboho', squadra: 'RSA' },
  { cognome: 'Appollis', nome: 'Oswin', squadra: 'RSA' },
  // SCOZIA
  { cognome: 'McTominay', nome: 'Scott', squadra: 'SCO' },
  { cognome: 'Robertson', nome: 'Andy', squadra: 'SCO' },
  { cognome: 'McGinn', nome: 'John', squadra: 'SCO' },
  { cognome: 'Christie', nome: 'Ryan', squadra: 'SCO' },
  { cognome: 'Shankland', nome: 'Lawrence', squadra: 'SCO' },
  { cognome: 'Adams', nome: 'Ché', squadra: 'SCO' },
  // SENEGAL
  { cognome: 'Mané', nome: 'Sadio', squadra: 'SEN' },
  { cognome: 'Gueye', nome: 'Idrissa', squadra: 'SEN' },
  { cognome: 'Diarra', nome: 'Habib', squadra: 'SEN' },
  { cognome: 'Jackson', nome: 'Nicolas', squadra: 'SEN' },
  { cognome: 'Mendy', nome: 'Antoine', squadra: 'SEN' },
  // SVIZZERA
  { cognome: 'Xhaka', nome: 'Granit', squadra: 'SUI' },
  { cognome: 'Akanji', nome: 'Manuel', squadra: 'SUI' },
  { cognome: 'Embolo', nome: 'Breel', squadra: 'SUI' },
  { cognome: 'Ndoye', nome: 'Dan', squadra: 'SUI' },
  { cognome: 'Okafor', nome: 'Noah', squadra: 'SUI' },
  { cognome: 'Amdouni', nome: 'Zeki', squadra: 'SUI' },
  { cognome: 'Vargas', nome: 'Rubén', squadra: 'SUI' },
  // SVEZIA
  { cognome: 'Isak', nome: 'Alexander', squadra: 'SWE' },
  { cognome: 'Gyökeres', nome: 'Viktor', squadra: 'SWE' },
  { cognome: 'Elanga', nome: 'Anthony', squadra: 'SWE' },
  { cognome: 'Svanberg', nome: 'Mattias', squadra: 'SWE' },
  // TUNISIA
  { cognome: 'Ben Slimane', nome: 'Anis', squadra: 'TUN' },
  { cognome: 'Mejbri', nome: 'Hannibal', squadra: 'TUN' },
  { cognome: 'Skhiri', nome: 'Ellyes', squadra: 'TUN' },
  // TURCHIA
  { cognome: 'Güler', nome: 'Arda', squadra: 'TUR' },
  { cognome: 'Demiral', nome: 'Merih', squadra: 'TUR' },
  { cognome: 'Çalhanoğlu', nome: 'Hakan', squadra: 'TUR' },
  { cognome: 'Yıldız', nome: 'Kenan', squadra: 'TUR' },
  { cognome: 'Aktürkoğlu', nome: 'Kerem', squadra: 'TUR' },
  // URUGUAY
  { cognome: 'Valverde', nome: 'Federico', squadra: 'URU' },
  { cognome: 'Núñez', nome: 'Darwin', squadra: 'URU' },
  { cognome: 'Araújo', nome: 'Ronald', squadra: 'URU' },
  { cognome: 'Pellistri', nome: 'Facundo', squadra: 'URU' },
  { cognome: 'De Arrascaeta', nome: 'Giorgian', squadra: 'URU' },
  { cognome: 'Ugarte', nome: 'Manuel', squadra: 'URU' },
  { cognome: 'Bentancur', nome: 'Rodrigo', squadra: 'URU' },
  { cognome: 'De la Cruz', nome: 'Nicolás', squadra: 'URU' },
  // UZBEKISTAN
  { cognome: 'Shomurodov', nome: 'Eldor', squadra: 'UZB' },
  { cognome: 'Fayzullayev', nome: 'Abbosbek', squadra: 'UZB' },
  // STATI UNITI
  { cognome: 'Pulisic', nome: 'Christian', squadra: 'USA' },
  { cognome: 'Reyna', nome: 'Giovanni', squadra: 'USA' },
  { cognome: 'Adams', nome: 'Tyler', squadra: 'USA' },
  { cognome: 'Balogun', nome: 'Folarin', squadra: 'USA' },
  { cognome: 'Weah', nome: 'Tim', squadra: 'USA' },
  { cognome: 'McKennie', nome: 'Weston', squadra: 'USA' },
  { cognome: 'Pepi', nome: 'Ricardo', squadra: 'USA' },
  // ALGERIA
  { cognome: 'Mahrez', nome: 'Riyad', squadra: 'ALG' },
  { cognome: 'Gouiri', nome: 'Amine', squadra: 'ALG' },
  { cognome: 'Amoura', nome: 'Mohamed', squadra: 'ALG' },
]

// ── CRITERI FIFA 2026 PER PARITÀ DI PUNTI ──────────────────────────────
// Criteri ufficiali (art. 20 Regolamento FIFA 2026):
//  1. Punti  2. GD generale  3. GF generale
//  4. Punti H2H  5. GD H2H  6. GF H2H
//  7. Punti disciplinari  8. Ranking FIFA  (non implementabili su pronostici)

function _calcH2H(teamIds, partite) {
  const h2h = {};
  teamIds.forEach(id => { h2h[id] = { pt:0, gf:0, gs:0, gd:0 }; });
  partite.forEach(p => {
    if (!teamIds.includes(p.casa) || !teamIds.includes(p.trasferta)) return;
    const pr = _pronostici?.gironi?.[p.id];
    const gc = pr?.gol_casa, gt = pr?.gol_trasferta;
    if (gc == null || gt == null) return;
    h2h[p.casa].gf    += gc;  h2h[p.casa].gs    += gt;  h2h[p.casa].gd    += gc - gt;
    h2h[p.trasferta].gf += gt; h2h[p.trasferta].gs += gc; h2h[p.trasferta].gd += gt - gc;
    if      (gc > gt) h2h[p.casa].pt += 3;
    else if (gc < gt) h2h[p.trasferta].pt += 3;
    else              { h2h[p.casa].pt++; h2h[p.trasferta].pt++; }
  });
  return h2h;
}

// Confronto in base a un ordine manuale scelto dall'utente (array di chiavi).
// Restituisce 0 se una delle due chiavi non è presente nella lista.
function _manualOrderCompare(lista, a, b) {
  if (!Array.isArray(lista)) return 0;
  const ia = lista.indexOf(a), ib = lista.indexOf(b);
  if (ia === -1 || ib === -1) return 0;
  return ia - ib;
}

function _sortClassificaFIFA(classifica, partite, lettera) {
  // Primo ordinamento per punti generali
  classifica.forEach(t => { delete t.tie; });
  classifica.sort((a, b) => b.pt - a.pt);
  // Raggruppa le squadre a parità di punti e applica H2H internamente
  const result = [];
  let i = 0;
  let tieId = 0;
  while (i < classifica.length) {
    let j = i;
    while (j < classifica.length && classifica[j].pt === classifica[i].pt) j++;
    const gruppo = classifica.slice(i, j);
    if (gruppo.length > 1) {
      const h2h = _calcH2H(gruppo.map(t => t.id), partite);
      // Ordine FIFA 2026: GD generale → GF generale → H2H pt → H2H GD → H2H GF
      const cmpFIFA = (a, b) =>
        (b.gd - a.gd)                    ||
        (b.gf - a.gf)                    ||
        (h2h[b.id].pt  - h2h[a.id].pt)  ||
        (h2h[b.id].gd  - h2h[a.id].gd)  ||
        (h2h[b.id].gf  - h2h[a.id].gf);
      // Parità totale: vale l'ordine manuale scelto dall'utente (spareggio)
      const manuale = lettera ? _pronostici?.spareggi?.gironi?.[lettera] : null;
      gruppo.sort((a, b) => cmpFIFA(a, b) || _manualOrderCompare(manuale, a.id, b.id));
      // Marca i sotto-gruppi ancora in parità totale (per le frecce di spareggio)
      let k = 0;
      while (k < gruppo.length) {
        let m = k;
        while (m + 1 < gruppo.length && cmpFIFA(gruppo[m], gruppo[m + 1]) === 0) m++;
        if (m > k && gruppo[k].g > 0) {
          tieId++;
          for (let x = k; x <= m; x++) gruppo[x].tie = tieId;
        }
        k = m + 1;
      }
    }
    gruppo.forEach(t => result.push(t));
    i = j;
  }
  return result;
}

// ── CALCOLO CLASSIFICA PURA (senza rendering) ──────────────────────────
function _getClassificaCompleta(lettera) {
  const girone = DB.gironi[lettera];
  if (!girone) return [];
  const stats = {};
  girone.squadre.forEach(id => { stats[id] = { pt:0, gf:0, gs:0, gd:0, g:0 }; });
  girone.partite.forEach(p => {
    const pr = _pronostici?.gironi?.[p.id];
    const gc = pr?.gol_casa, gt = pr?.gol_trasferta;
    if (gc == null || gt == null) return;
    stats[p.casa].g++;       stats[p.trasferta].g++;
    stats[p.casa].gf += gc;  stats[p.casa].gs += gt;  stats[p.casa].gd += gc-gt;
    stats[p.trasferta].gf += gt; stats[p.trasferta].gs += gc; stats[p.trasferta].gd += gt-gc;
    if (gc > gt) stats[p.casa].pt += 3;
    else if (gc === gt) { stats[p.casa].pt++; stats[p.trasferta].pt++; }
    else stats[p.trasferta].pt += 3;
  });
  const classifica = girone.squadre.map(id => ({ id, ...stats[id] }));
  return _sortClassificaFIFA(classifica, girone.partite, lettera);
}

// ── CLASSIFICA DELLE TERZE (con spareggio manuale e flag parità) ────────
function _getTerzeClassifica() {
  const terze = [];
  Object.keys(DB.gironi).forEach(lettera => {
    const cl = _getClassificaCompleta(lettera);
    if (cl.length < 3) return;
    const t = cl[2];
    terze.push({ lettera, teamId: t.id, pt: t.pt, gd: t.gd, gf: t.gf, g: t.g });
  });
  const cmp = (a, b) => b.pt - a.pt || b.gd - a.gd || b.gf - a.gf;
  const manuale = _pronostici?.spareggi?.terze;
  terze.sort((a, b) => cmp(a, b) || _manualOrderCompare(manuale, a.lettera, b.lettera) || a.lettera.localeCompare(b.lettera));
  // Marca i gruppi adiacenti in parità totale (per le frecce di spareggio)
  let tieId = 0, k = 0;
  while (k < terze.length) {
    let m = k;
    while (m + 1 < terze.length && cmp(terze[m], terze[m + 1]) === 0) m++;
    if (m > k && terze[k].g > 0) {
      tieId++;
      for (let x = k; x <= m; x++) terze[x].tie = tieId;
    }
    k = m + 1;
  }
  return terze;
}

// ── DETERMINA I TERZI IN BASE ALLA TABELLA FIFA ─────────────────────────
function _calcola3rdiSlots() {
  // Calcola tutti i terzi classificati (solo gironi compilati), già ordinati
  const terze = _getTerzeClassifica().filter(t => t.g > 0);
  if (terze.length < 8) return null; // non ancora abbastanza gironi completati
  const top8 = terze.slice(0, 8);
  const qualGroups = top8.map(t => t.lettera).sort().join('');
  const combo = COMB_3I[qualGroups];
  if (!combo) return null;
  const byLettera = {};
  terze.forEach(t => { byLettera[t.lettera] = t.teamId; });
  // Mappa: slotLetter → teamId
  const result = {};
  COMB_SLOT_ORDER.forEach((slot, i) => {
    const srcGrp = combo[i];
    result[slot] = byLettera[srcGrp] || null;
  });
  return result;
}

// ── SPAREGGIO MANUALE (frecce ▲▼ su parità totale) ─────────────────────
// HTML delle frecce per una riga in parità totale. `lista` è l'array ordinato
// (classifica girone o terze), `i` l'indice della riga, `id` la chiave da
// spostare (teamId per i gironi, lettera del girone per le terze).
function _tieBtnsHtml(tipo, lettera, id, lista, i) {
  const t = lista[i];
  if (!t || !t.tie) return '';
  const su  = i > 0 && lista[i - 1].tie === t.tie;
  const giu = i < lista.length - 1 && lista[i + 1].tie === t.tie;
  const dis = !_pronosticiAperti;
  const attrs = ' data-tie-tipo="' + tipo + '" data-tie-girone="' + lettera + '" data-tie-id="' + id + '"';
  return '<span class="tie-btns" title="Parità totale: scegli tu l\'ordine">'
    + '<button type="button" class="tie-btn"' + attrs + ' data-tie-dir="-1"' + ((su && !dis) ? '' : ' disabled') + '>▲</button>'
    + '<button type="button" class="tie-btn"' + attrs + ' data-tie-dir="1"' + ((giu && !dis) ? '' : ' disabled') + '>▼</button>'
    + '</span>';
}

async function _salvaSpareggi() {
  try {
    await savePronostici(STATE.utente.id, _pronostici);
    showToast('Ordine salvato!', 'success');
  } catch (e) {
    showToast('Errore nel salvataggio dell\'ordine', 'error');
  }
}

function _spostaTieGirone(lettera, teamId, dir) {
  const cl = _getClassificaCompleta(lettera);
  const i = cl.findIndex(t => t.id === teamId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cl.length) return;
  if (!cl[i].tie || cl[j].tie !== cl[i].tie) return; // si scambia solo dentro la parità
  const ordine = cl.map(t => t.id);
  [ordine[i], ordine[j]] = [ordine[j], ordine[i]];
  if (!_pronostici.spareggi) _pronostici.spareggi = {};
  if (!_pronostici.spareggi.gironi) _pronostici.spareggi.gironi = {};
  _pronostici.spareggi.gironi[lettera] = ordine;
  _ricalcolaClassificaGirone(lettera); // aggiorna mini, badge, sedicesimi e riepilogo
  _ricalcolaBracket();
  _salvaSpareggi();
}

function _spostaTieTerze(lettera, dir) {
  const terze = _getTerzeClassifica();
  const i = terze.findIndex(t => t.lettera === lettera);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= terze.length) return;
  if (!terze[i].tie || terze[j].tie !== terze[i].tie) return;
  const ordine = terze.map(t => t.lettera);
  [ordine[i], ordine[j]] = [ordine[j], ordine[i]];
  if (!_pronostici.spareggi) _pronostici.spareggi = {};
  _pronostici.spareggi.terze = ordine;
  _ricalcolaSedicesimi();
  _ricalcolaBracket();
  _renderRiepilogoGironi();
  _salvaSpareggi();
}

function _bindTieButtons() {
  ['gironi-container', 'riepilogo-container'].forEach(cid => {
    const el = document.getElementById(cid);
    if (!el || el.dataset.tieBound) return;
    el.dataset.tieBound = '1';
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.tie-btn');
      if (!btn || btn.disabled) return;
      if (!_pronosticiAperti) { showToast('I pronostici sono chiusi!', 'error'); return; }
      const dir = parseInt(btn.dataset.tieDir, 10);
      if (btn.dataset.tieTipo === 'girone') _spostaTieGirone(btn.dataset.tieGirone, btn.dataset.tieId, dir);
      else _spostaTieTerze(btn.dataset.tieId, dir);
    });
  });
}

// ── RISOLVE UN SINGOLO SLOT → TEAM ID ──────────────────────────────────
function _resolveSlot(slotDef, standings, terziSlots) {
  if (slotDef.t === '1') return standings[slotDef.g]?.[0] || null;
  if (slotDef.t === '2') return standings[slotDef.g]?.[1] || null;
  if (slotDef.t === '3slot') return terziSlots ? (terziSlots[slotDef.slot] || null) : null;
  return null;
}

// ── HELPER: vincitore di un match già pronosticato ─────────────────────────
function _getVincitore(fase, matchId) {
  return _pronostici?.fase_eliminatoria?.[fase]?.[matchId]?.vincitore || null;
}

// Label placeholder per uno slot bracket non ancora risolto
function _feedPlaceholder(feed) {
  return 'Vince ' + feed.id;
}

// ── AGGIORNA I SEDICESIMI IN BASE AI GIRONI COMPILATI ──────────────────
function _ricalcolaSedicesimi() {
  // Calcola standings per tutti i gironi
  const standings = {};
  Object.keys(DB.gironi).forEach(l => {
    const cl = _getClassificaCompleta(l);
    standings[l] = cl.map(t => t.id);
  });
  const terziSlots = _calcola3rdiSlots();

  SEDICESIMI_BRACKET.forEach(bracket => {
    const card = document.querySelector('.elim-match-card[data-fase="sedicesimi"][data-id="' + bracket.id + '"]');
    if (!card) return;

    const casaId  = _resolveSlot(bracket.casa, standings, terziSlots);
    const trasfId = _resolveSlot(bracket.trasf, standings, terziSlots);

    // Aggiorna etichette squadre nel matchup
    const spans = card.querySelectorAll('.elim-team');
    if (spans.length >= 2) {
      const casaSq  = casaId  ? SQUADRE_BY_ID[casaId]  : null;
      const trasfSq = trasfId ? SQUADRE_BY_ID[trasfId] : null;
      spans[0].textContent = casaSq  ? (casaSq.flag  || '') + ' ' + casaSq.nome  : _slotLabel(bracket.casa);
      spans[1].textContent = trasfSq ? (trasfSq.flag || '') + ' ' + trasfSq.nome : _slotLabel(bracket.trasf);
    }

    // Aggiorna le opzioni del select vincitore
    const sel = card.querySelector('.vincitore-select');
    if (!sel) return;
    // Usa il valore salvato in _pronostici come fonte di verità, non il DOM
    const savedVal = _pronostici?.fase_eliminatoria?.sedicesimi?.[bracket.id]?.vincitore || '';
    const currVal = savedVal || sel.value;
    const teams = [casaId, trasfId].filter(Boolean);
    let opts = '<option value="">— Seleziona —</option>';
    teams.forEach(id => {
      const sq = SQUADRE_BY_ID[id];
      const selected = (currVal === id) ? ' selected' : '';
      opts += '<option value="' + id + '"' + selected + '>' + (sq?.flag || '') + ' ' + (sq?.nome || id) + '</option>';
    });
    // Aggiungi l'opzione corrente se non è più valida (slot non ancora risolto)
    if (currVal && !teams.includes(currVal)) {
      const sq = SQUADRE_BY_ID[currVal];
      if (sq) opts += '<option value="' + currVal + '" selected>' + (sq.flag || '') + ' ' + sq.nome + ' ⚠️</option>';
      // Reset se la squadra selezionata non appartiene più a questa partita
      _setElim('sedicesimi', bracket.id, 'vincitore', null);
    }
    sel.innerHTML = opts;
  });
  // Propaga i vincitori dei sedicesimi agli ottavi e oltre
  _ricalcolaBracket();
}

function _slotLabel(slotDef) {
  if (slotDef.t === '1') return '1° Girone ' + slotDef.g;
  if (slotDef.t === '2') return '2° Girone ' + slotDef.g;
  if (slotDef.t === '3slot') return 'Miglior 3°';
  return '?';
}

// ── PROPAGA I VINCITORI ATTRAVERSO IL BRACKET (ottavi → quarti → SF → F) ─
function _ricalcolaBracket() {
  const FASI_BRACKET = [
    { faseId: 'ottavi',     matches: ['O1','O2','O3','O4','O5','O6','O7','O8'] },
    { faseId: 'quarti',     matches: ['Q1','Q2','Q3','Q4'] },
    { faseId: 'semifinali', matches: ['SF1','SF2'] },
    { faseId: 'finale',     matches: ['F'] },
  ];
  FASI_BRACKET.forEach(({ faseId, matches }) => {
    matches.forEach(matchId => {
      const card = document.querySelector('.elim-match-card[data-fase="' + faseId + '"][data-id="' + matchId + '"]');
      if (!card) return;
      const feeds = BRACKET_FEEDS[matchId];
      if (!feeds) return;

      const casaId  = _getVincitore(feeds.casa.fase,  feeds.casa.id);
      const trasfId = _getVincitore(feeds.trasf.fase, feeds.trasf.id);
      const casaSq  = casaId  ? SQUADRE_BY_ID[casaId]  : null;
      const trasfSq = trasfId ? SQUADRE_BY_ID[trasfId] : null;

      // Aggiorna etichette squadre
      const spans = card.querySelectorAll('.elim-team');
      if (spans.length >= 2) {
        spans[0].textContent = casaSq  ? (casaSq.flag  || '') + ' ' + casaSq.nome  : _feedPlaceholder(feeds.casa);
        spans[1].textContent = trasfSq ? (trasfSq.flag || '') + ' ' + trasfSq.nome : _feedPlaceholder(feeds.trasf);
      }

      // Aggiorna opzioni dropdown
      const sel = card.querySelector('.vincitore-select');
      if (!sel) return;
      const savedVal = _pronostici?.fase_eliminatoria?.[faseId]?.[matchId]?.vincitore || '';
      const currVal = savedVal || sel.value;
      const teams = [casaId, trasfId].filter(Boolean);
      let opts = '<option value="">— Seleziona —</option>';
      teams.forEach(id => {
        const sq = SQUADRE_BY_ID[id];
        const selected = (currVal === id) ? ' selected' : '';
        opts += '<option value="' + id + '"' + selected + '>' + (sq?.flag||'') + ' ' + (sq?.nome||id) + '</option>';
      });
      // Se la squadra selezionata non è più valida, reset
      if (currVal && !teams.includes(currVal)) {
        _setElim(faseId, matchId, 'vincitore', null);
      }
      sel.innerHTML = opts;
    });
  });
}


let _pronostici = {};
let _sistemaUnsub = null;
let _pronosticiAperti = true;

export function cleanupPronostici() {
  if (_sistemaUnsub) { _sistemaUnsub(); _sistemaUnsub = null; }
  _pronostici = {};
  _pronosticiAperti = true;
}

export async function initPronostici() {
  showSpinner('gironi-container', 'Caricamento pronostici...');
  _sistemaUnsub = onSistemaSnapshot((cfg) => {
    _pronosticiAperti = cfg.pronostici_aperti !== false;
    STATE.pronosticiAperti = _pronosticiAperti;
    _aggiornaStatoBanner();
    _aggiornaBtnSalva();
  });
  try {
    const saved = await getPronostici(STATE.utente.id);
    _pronostici = saved || {};
  } catch (e) {
    _pronostici = {};
  }
  _renderGironi();
  _renderEliminatoria();
  _renderSpeciali();
  Object.keys(DB.gironi).forEach(l => _ricalcolaClassificaGirone(l));
  _ricalcolaSedicesimi();
  _ricalcolaBracket();
  _renderRiepilogoGironi();
  _renderTabellone();
  _initVisibilitaToggle();
  _bindTieButtons();

  // Applica lo stato aperti/chiusi ai campi ora che il form è renderizzato
  _aggiornaBtnSalva();

  // Aggiorna il tabellone ogni volta che si clicca su quel tab
  document.querySelector('.tab[data-tab="tab-tabellone"]')?.addEventListener('click', _renderTabellone);

  // Pulsante "Salva Marcatori" nella tab speciali
  document.getElementById('btn-salva-marcatori')?.addEventListener('click', async () => {
    if (!_pronosticiAperti) { showToast('I pronostici sono chiusi!', 'error'); return; }
    const btn = document.getElementById('btn-salva-marcatori');
    const msg = document.getElementById('esm-marcatori');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvataggio…'; }
    if (msg) { msg.textContent = ''; msg.className = 'elim-save-msg'; }
    try {
      _raccogliDalDOM();
      await savePronostici(STATE.utente.id, _pronostici);
      if (msg) { msg.textContent = '✅ Marcatori salvati!'; msg.className = 'elim-save-msg esm-ok'; }
      showToast('Marcatori salvati!', 'success');
    } catch (e) {
      if (msg) { msg.textContent = '❌ Errore: ' + e.message; msg.className = 'elim-save-msg esm-error'; }
      showToast('Errore: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Salva Marcatori'; }
    }
  });

  // Blocca submit accidentale da tastiera (Enter)
  document.getElementById('form-pronostici').addEventListener('submit', (e) => e.preventDefault());
}

function _aggiornaStatoBanner() {
  const banner = document.getElementById('pronostici-banner');
  const status = document.getElementById('pronostici-status');
  if (_pronosticiAperti) {
    banner.style.display = 'none';
    status.textContent = '✅ Pronostici aperti';
    status.style.color = 'var(--verde-light)';
  } else {
    banner.style.display = '';
    banner.className = 'info-banner info-banner--red';
    banner.innerHTML = '<span>🔒</span><span>I pronostici sono <strong>chiusi</strong>.</span>';
    status.textContent = '🔒 Pronostici chiusi';
    status.style.color = 'var(--oro)';
  }
}

function _aggiornaBtnSalva() {
  const aperti = _pronosticiAperti;
  const form = document.getElementById('form-pronostici');
  if (!form) return;

  // Classe visiva sul form
  form.classList.toggle('form-locked', !aperti);

  // Pulsanti salva: nascosti quando chiusi
  form.querySelectorAll('.btn-salva-girone, .btn-salva-fase, #btn-salva-marcatori').forEach(btn => {
    btn.style.display = aperti ? '' : 'none';
    btn.disabled = !aperti;
  });

  // Tutti gli input e select del form
  form.querySelectorAll('input, select, textarea').forEach(el => {
    el.disabled = !aperti;
  });

  // Pulsanti interattivi non-tab (segni 1/X/2, frecce spareggio, ecc.)
  // I tab di navigazione (.tab, .girone-tab) restano cliccabili
  form.querySelectorAll('button:not(.tab):not(.girone-tab):not(.btn-salva-girone):not(.btn-salva-fase)').forEach(btn => {
    if (btn.id !== 'btn-salva-marcatori') btn.disabled = !aperti;
  });
}

function _renderGironi() {
  const container = document.getElementById('gironi-container');
  const lettere = Object.keys(DB.gironi);

  // ── Barra sub-tab ────────────────────────────────────────────────────────
  let html = '<div class="girone-subtab-bar">';
  lettere.forEach((l, i) => {
    html += '<button type="button" class="girone-tab' + (i===0?' active':'') + '" data-girone="' + l + '">'
      + '<span class="gtab-letter">Girone ' + l + '</span>'
      + '<span class="gtab-badge" id="badge-girone-' + l + '"></span>'
      + '</button>';
  });
  html += '</div>';

  // ── Pannelli girone ──────────────────────────────────────────────────────
  Object.entries(DB.gironi).forEach(([lettera, girone], i) => {
    html += '<div class="girone-panel' + (i===0?' active':'') + '" id="girone-panel-' + lettera + '">'
      + '<div class="girone-squadre">'
      + girone.squadre.map(id => {
          const sq = SQUADRE_BY_ID[id];
          return '<span class="team-chip">' + (sq?.flag||'') + ' ' + (sq?.nome||id) + '</span>';
        }).join('')
      + '</div>'
      + '<div class="partite-list">'
      + girone.partite.map(p => _renderPartitaGirone(p)).join('')
      + '</div>'
      + '<div class="girone-classifica-mini" id="classifica-girone-' + lettera + '"></div>'
      + '<div class="girone-save-row">'
      + '<span class="girone-save-msg" id="save-msg-girone-' + lettera + '"></span>'
      + '<button type="button" class="btn btn-salva-girone" data-girone="' + lettera + '">💾 Salva Girone ' + lettera + '</button>'
      + '</div>'
      + '</div>';
  });

  container.innerHTML = html;
  _bindSegniGirone();
  _bindGironeTabs();
  container.querySelectorAll('.btn-salva-girone').forEach(btn => {
    btn.addEventListener('click', () => _salvaGirone(btn.dataset.girone));
  });
}

function _bindGironeTabs() {
  document.querySelectorAll('.girone-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.girone-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.girone-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('girone-panel-' + tab.dataset.girone);
      if (panel) panel.classList.add('active');
    });
  });
}

function _aggiornaBadgeGirone(lettera) {
  const girone = DB.gironi[lettera];
  if (!girone) return;
  let completi = 0;
  girone.partite.forEach(p => {
    const d = _pronostici?.gironi?.[p.id];
    if (d?.gol_casa != null && d?.gol_trasferta != null) completi++;
  });
  const badge = document.getElementById('badge-girone-' + lettera);
  if (!badge) return;
  const tot = girone.partite.length;
  if (completi === 0) { badge.textContent = ''; badge.className = 'gtab-badge'; }
  else if (completi < tot) { badge.textContent = completi + '/' + tot; badge.className = 'gtab-badge partial'; }
  else { badge.textContent = '✓'; badge.className = 'gtab-badge complete'; }
}

// ── VALIDAZIONE GLOBALE ─────────────────────────────────────────────────

/**
 * Verifica che tutti e 72 i risultati dei gironi siano compilati
 * (gol_casa, gol_trasferta, segno 1/X/2).
 * Restituisce { ok, riepilogo } dove riepilogo è una stringa descrittiva.
 */
function _validaGironiCompleti() {
  const incompleti = [];
  Object.entries(DB.gironi).forEach(([lettera, girone]) => {
    let n = 0;
    girone.partite.forEach(p => {
      const d = _pronostici?.gironi?.[p.id];
      if (d?.gol_casa == null || d?.gol_trasferta == null || !d?.segno) n++;
    });
    if (n > 0) incompleti.push('Girone ' + lettera + ' (' + n + ' ' + (n === 1 ? 'partita' : 'partite') + ')');
  });
  return {
    ok: incompleti.length === 0,
    riepilogo: incompleti.length ? 'Gironi incompleti: ' + incompleti.join(', ') : '',
  };
}

/**
 * Verifica che tutte le fasi eliminatorie abbiano il vincitore selezionato.
 * Restituisce { ok, riepilogo }.
 */
function _validaEliminatorieComplete() {
  const incompleti = [];
  FASI_ELIM.forEach(({ id, label }) => {
    const matches = _getMatchesFase(id);
    const n = matches.filter(m => !_pronostici?.fase_eliminatoria?.[id]?.[m.id]?.vincitore).length;
    if (n > 0) incompleti.push(label + ' (' + n + ' ' + (n === 1 ? 'partita' : 'partite') + ')');
  });
  return {
    ok: incompleti.length === 0,
    riepilogo: incompleti.length ? 'Fasi incomplete: ' + incompleti.join(', ') : '',
  };
}

async function _salvaGirone(lettera) {
  if (!_pronosticiAperti) { showToast('I pronostici sono chiusi!', 'error'); return; }
  const girone = DB.gironi[lettera];
  if (!girone) return;

  const msg = document.getElementById('save-msg-girone-' + lettera);
  const btn = document.querySelector('.btn-salva-girone[data-girone="' + lettera + '"]');

  // Raccoglie prima i dati dal DOM così la validazione vede i valori aggiornati
  _raccogliDalDOM();

  // Validazione: tutti e 72 i risultati dei gironi devono essere completi
  const { ok, riepilogo } = _validaGironiCompleti();
  if (!ok) {
    if (msg) { msg.textContent = '⚠️ ' + riepilogo; msg.className = 'girone-save-msg gsm-error'; }
    showToast('Completa tutti i gironi prima di salvare', 'error');
    return;
  }

  btn.disabled = true;
  if (msg) { msg.textContent = 'Salvataggio...'; msg.className = 'girone-save-msg'; }
  try {
    await savePronostici(STATE.utente.id, _pronostici);
    if (msg) { msg.textContent = '✅ Girone ' + lettera + ' salvato!'; msg.className = 'girone-save-msg gsm-ok'; }
    _aggiornaBadgeGirone(lettera);
    showToast('Girone ' + lettera + ' salvato!', 'success');
  } catch(e) {
    if (msg) { msg.textContent = '❌ Errore nel salvataggio.'; msg.className = 'girone-save-msg gsm-error'; }
    showToast('Errore nel salvataggio', 'error');
  } finally {
    btn.disabled = false;
  }
}

function _renderPartitaGirone(p) {
  const casa      = SQUADRE_BY_ID[p.casa];
  const trasferta = SQUADRE_BY_ID[p.trasferta];
  // Pre-inizializza a 0 se non ancora compilato
  if (!_pronostici.gironi) _pronostici.gironi = {};
  if (!_pronostici.gironi[p.id]) _pronostici.gironi[p.id] = {};
  if (_pronostici.gironi[p.id].gol_casa      == null) _pronostici.gironi[p.id].gol_casa      = 0;
  if (_pronostici.gironi[p.id].gol_trasferta == null) _pronostici.gironi[p.id].gol_trasferta = 0;
  if (!_pronostici.gironi[p.id].segno) _pronostici.gironi[p.id].segno = 'X';
  const saved     = _pronostici.gironi[p.id];
  const golCasa   = saved.gol_casa;
  const golTrasf  = saved.gol_trasferta;
  const segnoCurr = saved.segno;
  const dateLabel = p.data ? '<span class="match-date">' + _fmtData(p.data) + '</span>' : '';
  return '<div class="partita-row" data-id="' + p.id + '">'
    + '<div class="partita-meta">' + dateLabel + ' <span class="match-group-label">Girone ' + p.girone + '</span></div>'
    + '<div class="partita-main">'
    + '<div class="team-name team-home">' + (casa?.flag||'') + ' ' + (casa?.nome||p.casa) + '</div>'
    + '<div class="match-center">'
    + '<div class="segni-group">'
    + ['1','X','2'].map(s => '<button type="button" class="segno-btn' + (segnoCurr===s?' active':'') + '" data-match="' + p.id + '" data-segno="' + s + '">' + s + '</button>').join('')
    + '</div>'
    + '<div class="score-inputs">'
    + '<input type="number" class="score-input" min="0" max="20" name="gol_casa_' + p.id + '" value="' + golCasa + '" placeholder="0" data-match="' + p.id + '" data-field="gol_casa">'
    + '<span class="score-sep">:</span>'
    + '<input type="number" class="score-input" min="0" max="20" name="gol_trasf_' + p.id + '" value="' + golTrasf + '" placeholder="0" data-match="' + p.id + '" data-field="gol_trasferta">'
    + '</div></div>'
    + '<div class="team-name team-away">' + (trasferta?.flag||'') + ' ' + (trasferta?.nome||p.trasferta) + '</div>'
    + '</div></div>';
}

function _bindSegniGirone() {
  document.querySelectorAll('.segno-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const matchId = btn.dataset.match;
      document.querySelectorAll('.segno-btn[data-match="' + matchId + '"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (!_pronostici.gironi) _pronostici.gironi = {};
      if (!_pronostici.gironi[matchId]) _pronostici.gironi[matchId] = {};
      _pronostici.gironi[matchId].segno = btn.dataset.segno;
    });
  });
  document.querySelectorAll('.score-input').forEach(input => {
    // Alla messa a fuoco: se il valore è 0 lo azzera subito,
    // altrimenti seleziona tutto così la digitazione sovrascrive
    input.addEventListener('focus', () => {
      if (input.value === '0') {
        input.value = '';
      } else {
        input.select();
      }
    });

    // All'uscita dal campo: se vuoto, ripristina 0 e aggiorna modello + segno
    input.addEventListener('blur', () => {
      if (input.value === '' || isNaN(parseInt(input.value, 10))) {
        input.value = '0';
        const matchId = input.dataset.match;
        if (!_pronostici.gironi) _pronostici.gironi = {};
        if (!_pronostici.gironi[matchId]) _pronostici.gironi[matchId] = {};
        _pronostici.gironi[matchId][input.dataset.field] = 0;
        // Ricalcola e aggiorna il segno 1/X/2
        const gc = _pronostici.gironi[matchId].gol_casa;
        const gt = _pronostici.gironi[matchId].gol_trasferta;
        if (gc != null && gt != null) {
          const s = gc > gt ? '1' : gc < gt ? '2' : 'X';
          _pronostici.gironi[matchId].segno = s;
          document.querySelectorAll('.segno-btn[data-match="' + matchId + '"]')
            .forEach(b => b.classList.toggle('active', b.dataset.segno === s));
        }
        const lettera = _getGironeByMatchId(matchId);
        if (lettera) _ricalcolaClassificaGirone(lettera);
      }
    });

    input.addEventListener('input', () => {
      const matchId = input.dataset.match;
      const val = parseInt(input.value, 10);
      if (!_pronostici.gironi) _pronostici.gironi = {};
      if (!_pronostici.gironi[matchId]) _pronostici.gironi[matchId] = {};
      _pronostici.gironi[matchId][input.dataset.field] = isNaN(val) ? null : val;
      const gc = _pronostici.gironi[matchId].gol_casa;
      const gt = _pronostici.gironi[matchId].gol_trasferta;
      if (gc != null && gt != null) {
        const s = gc > gt ? '1' : gc < gt ? '2' : 'X';
        _pronostici.gironi[matchId].segno = s;
        document.querySelectorAll('.segno-btn[data-match="' + matchId + '"]').forEach(b => b.classList.toggle('active', b.dataset.segno === s));
      }
      const lettera = _getGironeByMatchId(matchId);
      if (lettera) _ricalcolaClassificaGirone(lettera);
    });
  });
}

const FASI_ELIM = [
  { id: 'sedicesimi', label: 'Sedicesimi di finale' },
  { id: 'ottavi',     label: 'Ottavi di finale' },
  { id: 'quarti',     label: 'Quarti di finale' },
  { id: 'semifinali', label: 'Semifinali' },
  { id: 'finale',     label: 'Finale' },
];

function _getMatchesFase(id) {
  if (id === 'finale') {
    const p = DB.fase_eliminatoria?.finale?.partita || {};
    return [{ id: 'F', ...p }]; // sempre visibile
  }
  const fase = DB.fase_eliminatoria?.[id]?.partite || {};
  return Object.entries(fase).map(([mid, p]) => ({ id: mid, ...p }));
}

function _renderEliminatoria() {
  const container = document.getElementById('eliminatoria-container');

  // ── Barra sub-tab ────────────────────────────────────────────────────
  let tabBar = '<div class="elim-subtab-bar">';
  FASI_ELIM.forEach(({ id, label }, i) => {
    tabBar += '<button type="button" class="elim-tab' + (i === 0 ? ' active' : '') + '" data-fase="' + id + '">' + label + '</button>';
  });
  tabBar += '</div>';

  // ── Pannelli per fase ────────────────────────────────────────────────
  let panels = '';
  FASI_ELIM.forEach(({ id, label }, i) => {
    const matches = _getMatchesFase(id);
    let matchesHtml = '';
    matches.forEach(m => { matchesHtml += _renderMatchElim(id, m); });
    panels += '<div class="elim-panel' + (i === 0 ? ' active' : '') + '" data-fase="' + id + '">'
      + '<div class="fase-matches">' + matchesHtml + '</div>'
      + '<div class="elim-save-row">'
      + '<button type="button" class="btn-salva-fase" data-fase="' + id + '">💾 Salva ' + label + '</button>'
      + '<span class="elim-save-msg" id="esm-' + id + '"></span>'
      + '</div></div>';
  });

  container.innerHTML = tabBar + panels;
  _bindElimTabs();
  _bindEliminatoria();
}

function _bindElimTabs() {
  document.querySelectorAll('.elim-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.elim-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.elim-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector('.elim-panel[data-fase="' + tab.dataset.fase + '"]')?.classList.add('active');
    });
  });

  document.querySelectorAll('.btn-salva-fase').forEach(btn => {
    btn.addEventListener('click', () => _salvaFase(btn.dataset.fase));
  });
}

function _salvaFase(faseId) {
  const msg = document.getElementById('esm-' + faseId);
  if (msg) { msg.textContent = ''; msg.className = 'elim-save-msg'; }

  // Validazione 1: tutti i gironi devono essere completi
  const vGironi = _validaGironiCompleti();
  if (!vGironi.ok) {
    if (msg) { msg.textContent = '⚠ ' + vGironi.riepilogo; msg.classList.add('esm-error'); }
    return;
  }

  // Validazione 2: tutte le fasi eliminatorie devono avere vincitore
  const vElim = _validaEliminatorieComplete();
  if (!vElim.ok) {
    if (msg) { msg.textContent = '⚠ ' + vElim.riepilogo; msg.classList.add('esm-error'); }
    return;
  }

  // Salva su Firebase tramite savePronostici
  const uid = STATE.utente?.id;
  if (!uid) return;
  savePronostici(uid, _pronostici)
    .then(() => {
      if (msg) { msg.textContent = '✓ Salvato!'; msg.classList.add('esm-ok'); }
      setTimeout(() => { if (msg) { msg.textContent = ''; msg.className = 'elim-save-msg'; } }, 3000);
    })
    .catch(e => {
      if (msg) { msg.textContent = '✗ Errore: ' + e.message; msg.classList.add('esm-error'); }
    });
}

function _renderMatchElim(faseId, match) {
  const saved    = _pronostici?.fase_eliminatoria?.[faseId]?.[match.id] || {};
  const vincSaved = saved.vincitore || '';
  const modSaved  = saved.modalita  || '';
  const modHtml = [['90min',"90'"],['supplementari','Suppl.'],['rigori','Rigori']].map(([v,l]) =>
    '<button type="button" class="modalita-btn' + (modSaved===v?' active':'') + '" data-fase="' + faseId + '" data-match="' + match.id + '" data-mod="' + v + '">' + l + '</button>'
  ).join('');

  // ── Determina le etichette e le opzioni del dropdown ─────────────────────
  let casaDisplay = '?', trasfDisplay = '?', bracketDesc = '', sqOpts = '';

  if (faseId === 'sedicesimi') {
    // Sedicesimi: label da SEDICESIMI_BRACKET, opzioni popolate da _ricalcolaSedicesimi
    const bi = SEDICESIMI_BRACKET.find(b => b.id === match.id) || {};
    casaDisplay  = _slotLabel(bi.casa  || {});
    trasfDisplay = _slotLabel(bi.trasf || {});
    if (bi.desc) bracketDesc = '<div class="elim-bracket-desc">' + bi.match + ' · ' + bi.desc + '</div>';
    // sqOpts: vuoto, verrà popolato da _ricalcolaSedicesimi
  } else {
    // Ottavi/Quarti/Semifinali/Finale: prende i vincitori del turno precedente
    const feeds = BRACKET_FEEDS[match.id];
    if (feeds) {
      bracketDesc = '<div class="elim-bracket-desc"><span class="bracket-match-id">' + match.id + '</span> · Vince ' + feeds.casa.id + ' vs Vince ' + feeds.trasf.id + '</div>';
      const casaId  = _getVincitore(feeds.casa.fase,  feeds.casa.id);
      const trasfId = _getVincitore(feeds.trasf.fase, feeds.trasf.id);
      const casaSq  = casaId  ? SQUADRE_BY_ID[casaId]  : null;
      const trasfSq = trasfId ? SQUADRE_BY_ID[trasfId] : null;
      casaDisplay  = casaSq  ? (casaSq.flag  || '') + ' ' + casaSq.nome  : _feedPlaceholder(feeds.casa);
      trasfDisplay = trasfSq ? (trasfSq.flag || '') + ' ' + trasfSq.nome : _feedPlaceholder(feeds.trasf);
      // Opzioni: solo le 2 squadre qualificate (se note)
      const teams = [casaId, trasfId].filter(Boolean);
      teams.forEach(id => {
        const sq = SQUADRE_BY_ID[id];
        const sel = vincSaved === id ? ' selected' : '';
        sqOpts += '<option value="' + id + '"' + sel + '>' + (sq?.flag||'') + ' ' + (sq?.nome||id) + '</option>';
      });
    }
  }

  return '<div class="elim-match-card" data-fase="' + faseId + '" data-id="' + match.id + '">'
    + bracketDesc
    + '<div class="elim-matchup"><span class="elim-team">' + casaDisplay + '</span><span class="elim-vs">vs</span><span class="elim-team">' + trasfDisplay + '</span></div>'
    + '<div class="elim-pick"><label class="field-label-sm">' + (faseId === 'finale' ? '🏆 Campione del Mondo' : 'Chi passa?') + '</label>'
    + '<select class="field-input field-input-sm vincitore-select" data-fase="' + faseId + '" data-match="' + match.id + '"><option value="">— Seleziona —</option>' + sqOpts + '</select></div>'
    + '<div class="elim-modalita"><label class="field-label-sm">Come?</label><div class="modalita-group">' + modHtml + '</div></div></div>';
}

function _bindEliminatoria() {
  document.querySelectorAll('.vincitore-select').forEach(sel => {
    sel.addEventListener('change', () => {
      _setElim(sel.dataset.fase, sel.dataset.match, 'vincitore', sel.value || null);
      _ricalcolaBracket();
    });
  });
  document.querySelectorAll('.modalita-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modalita-btn[data-fase="' + btn.dataset.fase + '"][data-match="' + btn.dataset.match + '"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _setElim(btn.dataset.fase, btn.dataset.match, 'modalita', btn.dataset.mod);
    });
  });
}

function _setElim(faseId, matchId, field, value) {
  if (!_pronostici.fase_eliminatoria) _pronostici.fase_eliminatoria = {};
  if (!_pronostici.fase_eliminatoria[faseId]) _pronostici.fase_eliminatoria[faseId] = {};
  if (!_pronostici.fase_eliminatoria[faseId][matchId]) _pronostici.fase_eliminatoria[faseId][matchId] = {};
  _pronostici.fase_eliminatoria[faseId][matchId][field] = value;
}

function _renderSpeciali() {
  const container = document.getElementById('speciali-container');
  const pCannon = _pronostici?.capocannoniere || {};
  let html = '<div class="speciali-section"><h3 class="section-title">🥇 Capocannoniere</h3>'
    + '<p class="section-desc">Pronostica i <strong>3 migliori marcatori</strong> in ordine. 1° → 40pt, 2° → 20pt, 3° → 10pt. Bonus +10 nella terna.</p>'
    + '<div class="cannon-inputs">';
  ['primo','secondo','terzo'].forEach((key, i) => {
    const val = pCannon[key] || '';
    html += '<div class="field-group"><label class="field-label">' + (i+1) + '° Capocannoniere</label>'
      + '<div class="autocomplete-wrap">'
      + '<input type="text" class="field-input cannon-input" id="cannon-' + key + '" data-key="' + key + '" value="' + val + '" placeholder="Digita il cognome..." autocomplete="off">'
      + '<div class="autocomplete-dropdown" id="ac-drop-' + key + '"></div>'
      + '</div></div>';
  });
  html += '</div></div>';
  container.innerHTML = html;
  _bindSpeciali();
}

function _renderPosizioniGironi() {
  let html = '';
  Object.entries(DB.gironi).forEach(([lettera, girone]) => {
    const savedPosiz = _pronostici?.posizioni_girone?.[lettera] || [];
    html += '<div class="girone-posiz-card"><div class="girone-posiz-header">Girone ' + lettera + '</div><div class="posiz-slots" data-girone="' + lettera + '">';
    [0,1,2,3].forEach(i => {
      const currId = savedPosiz[i] || '';
      const opts = girone.squadre.map(id => {
        const sq = SQUADRE_BY_ID[id];
        return '<option value="' + id + '"' + (currId===id?' selected':'') + '>' + (sq?.flag||'') + ' ' + (sq?.nome||id) + '</option>';
      }).join('');
      html += '<div class="posiz-slot"><span class="posiz-num">' + (i+1) + '°</span>'
        + '<select class="field-input field-input-sm posiz-select" data-girone="' + lettera + '" data-pos="' + i + '"><option value="">—</option>' + opts + '</select></div>';
    });
    html += '</div></div>';
  });
  return html;
}

function _normStr(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Set globale dei valori validi per i marcatori (costruito una volta sola)
const VALORI_VALIDI_CANNON = new Set(GIOCATORI.map(g => g.cognome + ' (' + g.squadra + ')'));

function _validaCannon(input) {
  const v = input.value.trim();
  if (!v) return true; // campo vuoto: ok
  if (VALORI_VALIDI_CANNON.has(v)) return true;
  input.value = '';
  input.classList.add('input-error');
  setTimeout(() => input.classList.remove('input-error'), 1500);
  return false;
}

function _bindSpeciali() {
  document.querySelectorAll('.cannon-input').forEach(input => {
    const key  = input.dataset.key;
    const drop = document.getElementById('ac-drop-' + key);

    function _salvaValore(val) {
      if (!_pronostici.capocannoniere) _pronostici.capocannoniere = {};
      _pronostici.capocannoniere[key] = val || null;
    }

    function _chiudiDrop() { drop.innerHTML = ''; drop.style.display = 'none'; }

    function _validaEChiudi() {
      setTimeout(() => {
        _chiudiDrop();
        const v = input.value.trim();
        if (v && !VALORI_VALIDI_CANNON.has(v)) {
          input.value = '';
          _salvaValore(null);
          input.classList.add('input-error');
          setTimeout(() => input.classList.remove('input-error'), 1500);
          showToast('Seleziona un calciatore dall\'elenco', 'error');
        } else {
          _salvaValore(v || null);
        }
      }, 200);
    }

    function _mostraSuggerimenti(query) {
      const q = _normStr(query.trim());
      if (q.length < 2) { _chiudiDrop(); return; }
      const matches = GIOCATORI.filter(g =>
        _normStr(g.cognome).includes(q) || _normStr(g.nome).includes(q)
      ).slice(0, 8);
      if (!matches.length) { _chiudiDrop(); return; }
      drop.innerHTML = matches.map(g =>
        '<div class="ac-item" data-val="' + g.cognome + ' (' + g.squadra + ')">'
        + '<span class="ac-name">' + g.cognome + ' ' + g.nome + '</span>'
        + '<span class="ac-team">(' + g.squadra + ')</span>'
        + '</div>'
      ).join('');
      drop.style.display = 'block';
      drop.querySelectorAll('.ac-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value = item.dataset.val;
          _salvaValore(item.dataset.val);
          input.classList.remove('input-error');
          _chiudiDrop();
        });
      });
    }

    input.addEventListener('input', () => { input.classList.remove('input-error'); _mostraSuggerimenti(input.value); });
    input.addEventListener('blur',  _validaEChiudi);
    input.addEventListener('focus', () => { if (input.value.length >= 2) _mostraSuggerimenti(input.value); });
    input.addEventListener('keydown', e => {
      const items = drop.querySelectorAll('.ac-item');
      const active = drop.querySelector('.ac-item.active');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = active ? (active.nextElementSibling || items[0]) : items[0];
        if (active) active.classList.remove('active');
        if (next) next.classList.add('active');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = active ? (active.previousElementSibling || items[items.length-1]) : items[items.length-1];
        if (active) active.classList.remove('active');
        if (prev) prev.classList.add('active');
      } else if (e.key === 'Enter') {
        if (active) {
          e.preventDefault();
          input.value = active.dataset.val;
          _salvaValore(active.dataset.val);
          input.classList.remove('input-error');
          _chiudiDrop();
        } else if (!VALORI_VALIDI_CANNON.has(input.value.trim())) {
          // Blocca il submit del form se il valore non è valido
          e.preventDefault();
          e.stopPropagation();
          _validaEChiudi();
        }
      } else if (e.key === 'Escape') {
        _chiudiDrop();
      }
    });
  });
}

function _getGironeByMatchId(matchId) {
  for (const [lettera, girone] of Object.entries(DB.gironi)) {
    if (girone.partite.some(p => p.id === matchId)) return lettera;
  }
  return null;
}

function _ricalcolaClassificaGirone(lettera) {
  const girone = DB.gironi[lettera];
  if (!girone) return;
  const stats = {};
  girone.squadre.forEach(id => { stats[id] = { pt:0, gf:0, gs:0, gd:0, g:0 }; });
  girone.partite.forEach(p => {
    const pr = _pronostici?.gironi?.[p.id];
    const gc = pr?.gol_casa, gt = pr?.gol_trasferta;
    if (gc == null || gt == null) return;
    stats[p.casa].g++;       stats[p.trasferta].g++;
    stats[p.casa].gf += gc;  stats[p.casa].gs += gt;  stats[p.casa].gd += (gc-gt);
    stats[p.trasferta].gf += gt; stats[p.trasferta].gs += gc; stats[p.trasferta].gd += (gt-gc);
    if (gc > gt) stats[p.casa].pt += 3;
    else if (gc === gt) { stats[p.casa].pt++; stats[p.trasferta].pt++; }
    else stats[p.trasferta].pt += 3;
  });
  const cl = _sortClassificaFIFA(
    girone.squadre.map(id => ({ id, ...stats[id] })),
    girone.partite,
    lettera
  );
  const hasData = cl.some(t => t.g > 0);
  const miniEl = document.getElementById('classifica-girone-' + lettera);
  if (miniEl) {
    if (!hasData) { miniEl.innerHTML = ''; return; }
    let rows = '';
    cl.forEach((t, i) => {
      const sq = SQUADRE_BY_ID[t.id];
      const gd = (t.gd > 0 ? '+' : '') + t.gd;
      const gdCls = t.gd > 0 ? 'gd-pos' : t.gd < 0 ? 'gd-neg' : '';
      rows += '<tr class="' + (i<2?'qualificata':'') + '">'
        + '<td class="mini-pos">' + (i+1) + '</td>'
        + '<td class="mini-team">' + (sq?.flag||'') + ' ' + (sq?.nome||t.id) + _tieBtnsHtml('girone', lettera, t.id, cl, i) + '</td>'
        + '<td class="mini-pt"><strong>' + t.pt + '</strong></td>'
        + '<td>' + t.g + '</td><td>' + t.gf + '</td><td>' + t.gs + '</td>'
        + '<td class="' + gdCls + '">' + gd + '</td></tr>';
    });
    miniEl.innerHTML = '<table class="girone-mini-table"><thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>G</th><th>GF</th><th>GS</th><th>GD</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  const slots = document.querySelector('.posiz-slots[data-girone="' + lettera + '"]');
  if (slots && hasData) {
    cl.forEach((team, i) => {
      const sel = slots.querySelector('.posiz-select[data-pos="' + i + '"]');
      if (sel) {
        sel.value = team.id;
        if (!_pronostici.posizioni_girone) _pronostici.posizioni_girone = {};
        if (!_pronostici.posizioni_girone[lettera]) _pronostici.posizioni_girone[lettera] = [];
        _pronostici.posizioni_girone[lettera][i] = team.id;
      }
    });
  }
  // Aggiorna il badge sul tab del girone
  _aggiornaBadgeGirone(lettera);
  // Ricalcola sedicesimi e riepilogo
  _ricalcolaSedicesimi();
  _renderRiepilogoGironi();
}


// ── TABELLONE ELIMINATORIE ──────────────────────────────────────────────
function _renderTabellone() {
  const container = document.getElementById('tabellone-container');
  if (!container) return;

  // Calcola standings e terzi slot per risolvere i sedicesimi
  const standings = {};
  Object.keys(DB.gironi).forEach(l => {
    const cl = _getClassificaCompleta(l);
    standings[l] = cl.map(t => t.id);
  });
  const terziSlots = _calcola3rdiSlots();

  // ── Helpers ──────────────────────────────────────────────────────────

  // Risolve un team ID da uno slot di sedicesimi o da un feed bracket
  function teamId(slotOrFeed, fromFase) {
    if (!slotOrFeed) return null;
    if (fromFase) {
      // Feed da fase precedente → prende il vincitore pronosticato
      return _getVincitore(fromFase, slotOrFeed) || null;
    }
    // Slot da classifica gironi
    return _resolveSlot(slotOrFeed, standings, terziSlots) || null;
  }

  // Renderizza una cella del bracket
  const _MODALITA_LABEL = { '90min':'90', 'supplementari':'S', 'rigori':'R' };
  function _getModalita(fase, matchId) {
    return _pronostici?.fase_eliminatoria?.[fase]?.[matchId]?.modalita || null;
  }

  function cell(id, rowStart, rowEnd, casaId, trasfId, vincitoreId, faseId, matchId) {
    const casa = casaId ? SQUADRE_BY_ID[casaId] : null;
    const trasf = trasfId ? SQUADRE_BY_ID[trasfId] : null;
    const modalita = _getModalita(faseId, matchId);
    const badgeLabel = vincitoreId && modalita ? _MODALITA_LABEL[modalita] : null;
    const mkTeam = (tid, sq) => {
      if (!tid) return '<div class="tb-team tb-unknown">?</div>';
      const w = vincitoreId === tid ? ' tb-winner' : '';
      const badge = (w && badgeLabel) ? ' <span class="tb-modalita tb-modalita-' + modalita + '">' + badgeLabel + '</span>' : '';
      return '<div class="tb-team' + w + '">' + (sq?.flag || '') + ' <span>' + tid + '</span>' + badge + '</div>';
    };
    return '<div class="tb-cell" style="grid-row:' + rowStart + '/' + rowEnd + ';grid-column:' + _colOf(faseId) + '">'
      + mkTeam(casaId, casa)
      + '<div class="tb-sep"></div>'
      + mkTeam(trasfId, trasf)
      + '</div>';
  }

  function _colOf(fase) {
    return { sedicesimi:1, ottavi:2, quarti:3, semifinali:4, finale:5 }[fase] || 1;
  }

  // ── Costruzione match per fase ────────────────────────────────────────
  let html = '<div class="tb-wrapper"><div class="tb-header">';
  ['Sedicesimi','Ottavi','Quarti','Semifinali','Finale'].forEach((l,i) => {
    html += '<div class="tb-col-label" style="grid-column:' + (i+1) + '">' + l + '</div>';
  });
  html += '</div><div class="tb-grid">';

  // SEDICESIMI (righe 1-16, una per match)
  SEDICESIMI_BRACKET.forEach((b, i) => {
    const row = i + 1;
    const casaId  = teamId(b.casa,  null);
    const trasfId = teamId(b.trasf, null);
    const vinc    = _getVincitore('sedicesimi', b.id);
    html += cell(b.id, row, row + 1, casaId, trasfId, vinc, 'sedicesimi', b.id);
  });

  // OTTAVI → O1-O8 (righe 1-2, 3-4 ... 15-16)
  const ottaviIds = ['O1','O2','O3','O4','O5','O6','O7','O8'];
  ottaviIds.forEach((oid, i) => {
    const rowStart = i * 2 + 1;
    const feed = BRACKET_FEEDS[oid];
    const casaId  = _getVincitore('sedicesimi', feed.casa.id);
    const trasfId = _getVincitore('sedicesimi', feed.trasf.id);
    const vinc    = _getVincitore('ottavi', oid);
    html += cell(oid, rowStart, rowStart + 2, casaId, trasfId, vinc, 'ottavi', oid);
  });

  // QUARTI → Q1-Q4 (righe 1-4, 5-8, 9-12, 13-16)
  const quartiIds = ['Q1','Q2','Q3','Q4'];
  quartiIds.forEach((qid, i) => {
    const rowStart = i * 4 + 1;
    const feed = BRACKET_FEEDS[qid];
    const casaId  = _getVincitore('ottavi', feed.casa.id);
    const trasfId = _getVincitore('ottavi', feed.trasf.id);
    const vinc    = _getVincitore('quarti', qid);
    html += cell(qid, rowStart, rowStart + 4, casaId, trasfId, vinc, 'quarti', qid);
  });

  // SEMIFINALI → SF1 (righe 1-8), SF2 (righe 9-16)
  [['SF1',1],['SF2',9]].forEach(([sfid, rowStart]) => {
    const feed = BRACKET_FEEDS[sfid];
    const casaId  = _getVincitore('quarti', feed.casa.id);
    const trasfId = _getVincitore('quarti', feed.trasf.id);
    const vinc    = _getVincitore('semifinali', sfid);
    html += cell(sfid, rowStart, rowStart + 8, casaId, trasfId, vinc, 'semifinali', sfid);
  });

  // FINALE (righe 1-16)
  {
    const feed = BRACKET_FEEDS['F'];
    const casaId  = _getVincitore('semifinali', feed.casa.id);
    const trasfId = _getVincitore('semifinali', feed.trasf.id);
    const vinc    = _getVincitore('finale', 'F');
    html += cell('F', 1, 17, casaId, trasfId, vinc, 'finale', 'F');
  }

  html += '</div>';

  // Banner campione
  const campione = _getVincitore('finale', 'F');
  if (campione) {
    const sq = SQUADRE_BY_ID[campione];
    html += '<div class="tb-campione">🏆 ' + (sq?.flag || '') + ' ' + (sq?.nome || campione) + '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

// ── RIEPILOGO GIRONI ────────────────────────────────────────────────────
function _renderRiepilogoGironi() {
  const container = document.getElementById('riepilogo-container');
  if (!container) return;

  const lettere = Object.keys(DB.gironi);
  const allClassifiche = {};
  lettere.forEach(l => { allClassifiche[l] = _getClassificaCompleta(l); });

  // ── Griglia classifiche per girone ──
  let gridHtml = '<div class="riepilogo-grid">';
  lettere.forEach(lettera => {
    const cl = allClassifiche[lettera];
    const hasData = cl.some(t => t.g > 0);
    gridHtml += '<div class="riepilogo-card">'
      + '<div class="riepilogo-card-header">Girone ' + lettera + '</div>'
      + '<table class="riepilogo-table">'
      + '<thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>GD</th></tr></thead>'
      + '<tbody>';
    cl.forEach((t, i) => {
      const sq = SQUADRE_BY_ID[t.id];
      const gdStr = t.gd > 0 ? '+' + t.gd : '' + t.gd;
      const gdCls = t.gd > 0 ? 'gd-pos' : t.gd < 0 ? 'gd-neg' : '';
      const rowCls = i < 2 ? 'qualificata' : i === 2 ? 'terza' : '';
      const ptDisp = hasData ? t.pt : '—';
      const gdDisp = hasData ? '<span class="' + gdCls + '">' + gdStr + '</span>' : '—';
      gridHtml += '<tr class="' + rowCls + '">'
        + '<td class="riepilogo-pos">' + (i + 1) + '</td>'
        + '<td class="riepilogo-team" title="' + (sq?.nome || t.id) + '">' + (sq?.flag || '') + ' ' + t.id + _tieBtnsHtml('girone', lettera, t.id, cl, i) + '</td>'
        + '<td class="riepilogo-pt">' + ptDisp + '</td>'
        + '<td class="riepilogo-gd">' + gdDisp + '</td>'
        + '</tr>';
    });
    gridHtml += '</tbody></table></div>';
  });
  gridHtml += '</div>';

  // ── Classifica migliori terze ──
  const terziData = _getTerzeClassifica();
  const hasTie = terziData.some(t => t.tie);

  let terziHtml = '<div class="riepilogo-terze-wrap">'
    + '<h3 class="riepilogo-terze-title">🏅 Migliori terze classificate</h3>'
    + '<p class="riepilogo-terze-desc">Le 8 migliori terze si qualificano per i sedicesimi. L\'ordine qui determina la loro posizione nel bracket.</p>'
    + (hasTie ? '<p class="riepilogo-terze-desc tie-hint">⚖️ Alcune squadre sono in parità totale: usa le frecce ▲▼ per scegliere tu l\'ordine.</p>' : '')
    + '<table class="riepilogo-table riepilogo-terze-table">'
    + '<thead><tr><th>#</th><th>Squadra</th><th>Girone</th><th>Pt</th><th>GD</th><th>GF</th></tr></thead>'
    + '<tbody>';

  terziData.forEach((t, i) => {
    const sq = SQUADRE_BY_ID[t.teamId];
    const gdStr = t.gd > 0 ? '+' + t.gd : '' + t.gd;
    const gdCls = t.gd > 0 ? 'gd-pos' : t.gd < 0 ? 'gd-neg' : '';
    const qualif = i < 8;
    const rowCls = qualif ? 'qualificata' : '';
    const hasData = t.g > 0;
    const icon = i === 7 && qualif ? '<span class="terza-cutoff" title="Ultimo posto qualificato">✂️ </span>' : '';
    terziHtml += '<tr class="' + rowCls + '">'
      + '<td class="riepilogo-pos">' + icon + (i + 1) + '</td>'
      + '<td class="riepilogo-team" title="' + (sq?.nome || t.teamId) + '">' + (sq?.flag || '') + ' ' + t.teamId + _tieBtnsHtml('terze', t.lettera, t.lettera, terziData, i) + '</td>'
      + '<td class="riepilogo-girone">Girone ' + t.lettera + '</td>'
      + '<td class="riepilogo-pt">' + (hasData ? t.pt : '—') + '</td>'
      + '<td class="riepilogo-gd"><span class="' + gdCls + '">' + (hasData ? gdStr : '—') + '</span></td>'
      + '<td class="riepilogo-gf">' + (hasData ? t.gf : '—') + '</td>'
      + '</tr>';
  });

  terziHtml += '</tbody></table>'
    + '<div class="riepilogo-terze-note">Le squadre sopra la riga ✂️ si qualificano per i sedicesimi di finale.</div>'
    + '</div>';

  container.innerHTML = gridHtml + terziHtml;
}

// ── RACCOLTA DATI DAL DOM ───────────────────────────────────────────────
function _raccogliDalDOM() {
  // Gironi
  document.querySelectorAll('.score-input').forEach(input => {
    const matchId = input.dataset.match;
    const field   = input.dataset.field;
    if (!matchId || !field) return;
    if (!_pronostici.gironi) _pronostici.gironi = {};
    if (!_pronostici.gironi[matchId]) _pronostici.gironi[matchId] = {};
    const v = parseInt(input.value, 10);
    _pronostici.gironi[matchId][field] = isNaN(v) ? 0 : v;
  });
  document.querySelectorAll('.segno-btn.active').forEach(btn => {
    const matchId = btn.dataset.match;
    if (!matchId) return;
    if (!_pronostici.gironi) _pronostici.gironi = {};
    if (!_pronostici.gironi[matchId]) _pronostici.gironi[matchId] = {};
    _pronostici.gironi[matchId].segno = btn.dataset.segno;
  });
  // Capocannoniere
  if (!_pronostici.capocannoniere) _pronostici.capocannoniere = {};
  document.querySelectorAll('.cannon-input').forEach(input => {
    const key = input.dataset.key;
    if (!key) return;
    const v = input.value.trim();
    if (!v || VALORI_VALIDI_CANNON.has(v)) {
      _pronostici.capocannoniere[key] = v || null;
    } else {
      input.value = '';
      _pronostici.capocannoniere[key] = null;
    }
  });
}

// ── SALVA PRONOSTICI ────────────────────────────────────────────────────
async function _salvaPronostici() {
  const btn = document.getElementById('btn-salva-prono');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  try {
    _raccogliDalDOM();
    _pronostici.ts_modifica = Date.now();
    const uid = STATE.utente?.id;
    if (!uid) throw new Error('Non autenticato');
    await savePronostici(uid, _pronostici);
    if (btn) { btn.textContent = '✓ Salvato!'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Salva pronostici'; }, 2000); }
  } catch (e) {
    console.error('Errore salvataggio:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Salva pronostici'; }
    alert('Errore durante il salvataggio: ' + e.message);
  }
}

// ── FORMATTAZIONE DATA ──────────────────────────────────────────────────
function _fmtData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── TOGGLE VISIBILITÀ SCHEDA ────────────────────────────────────────────
function _initVisibilitaToggle() {
  // Inserisce il contenitore del toggle dopo il banner, se non già presente
  const bannerEl = document.getElementById('pronostici-banner');
  if (bannerEl && !document.getElementById('pronostici-visibility-toggle')) {
    const div = document.createElement('div');
    div.id = 'pronostici-visibility-toggle';
    bannerEl.insertAdjacentElement('afterend', div);
  }
  _renderVisibilitaToggle();
}

function _renderVisibilitaToggle() {
  const el = document.getElementById('pronostici-visibility-toggle');
  if (!el) return;
  const nascosto = !!_pronostici.pronostico_nascosto;
  el.innerHTML = `
    <div class="visibility-toggle-bar">
      <div class="vt-info">
        <span class="vt-icon">${nascosto ? '🔒' : '👁️'}</span>
        <span class="vt-text">La tua scheda è <strong>${nascosto ? 'nascosta' : 'visibile'}</strong> agli altri partecipanti</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-visibilita">
        ${nascosto ? '👁️ Rendi visibile' : '🔒 Nascondi scheda'}
      </button>
    </div>`;

  document.getElementById('btn-toggle-visibilita')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-toggle-visibilita');
    if (btn) btn.disabled = true;
    const nuovoValore = !_pronostici.pronostico_nascosto;
    _pronostici.pronostico_nascosto = nuovoValore;
    try {
      await savePronostici(STATE.utente.id, _pronostici);
      showToast(nuovoValore ? '🔒 Scheda nascosta agli altri' : '👁️ Scheda ora visibile', 'success');
    } catch (e) {
      _pronostici.pronostico_nascosto = !nuovoValore; // rollback
      showToast('Errore: ' + e.message, 'error');
    }
    _renderVisibilitaToggle();
  });
}

export { _salvaPronostici };
