/**
 * MONDIALITO 2026 — functions/punteggi.js
 * Motore di calcolo punteggi (CommonJS — usato dalla Cloud Function).
 * Logica identica a js/punteggi.js (ES module per il browser).
 */

'use strict';

const DB  = require('../mondialito_db.json');
const REG = DB.regolamento.punteggi;

// ── BRACKET HELPERS (inline da bracket.js — CJS non supporta ES modules) ──

const SEDICESIMI_BRACKET = [
  { id:'S02', casa:{t:'1',g:'E'}, trasf:{t:'3slot',slot:'E'} },
  { id:'S05', casa:{t:'1',g:'I'}, trasf:{t:'3slot',slot:'I'} },
  { id:'S01', casa:{t:'2',g:'A'}, trasf:{t:'2',g:'B'} },
  { id:'S03', casa:{t:'1',g:'F'}, trasf:{t:'2',g:'C'} },
  { id:'S11', casa:{t:'2',g:'K'}, trasf:{t:'2',g:'L'} },
  { id:'S12', casa:{t:'1',g:'H'}, trasf:{t:'2',g:'J'} },
  { id:'S09', casa:{t:'1',g:'D'}, trasf:{t:'3slot',slot:'D'} },
  { id:'S10', casa:{t:'1',g:'G'}, trasf:{t:'3slot',slot:'G'} },
  { id:'S04', casa:{t:'1',g:'C'}, trasf:{t:'2',g:'F'} },
  { id:'S06', casa:{t:'2',g:'E'}, trasf:{t:'2',g:'I'} },
  { id:'S07', casa:{t:'1',g:'A'}, trasf:{t:'3slot',slot:'A'} },
  { id:'S08', casa:{t:'1',g:'L'}, trasf:{t:'3slot',slot:'L'} },
  { id:'S14', casa:{t:'1',g:'J'}, trasf:{t:'2',g:'H'} },
  { id:'S16', casa:{t:'2',g:'D'}, trasf:{t:'2',g:'G'} },
  { id:'S13', casa:{t:'1',g:'B'}, trasf:{t:'3slot',slot:'B'} },
  { id:'S15', casa:{t:'1',g:'K'}, trasf:{t:'3slot',slot:'K'} },
];

// COMB_3I inline (Tabella FIFA Annex C — sincronizzata con js/bracket.js)
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

function _getClassificaGirone(lettera, pronosticiGironi) {
  const girone = DB.gironi[lettera];
  if (!girone) return [];
  const stats = {};
  girone.squadre.forEach(id => { stats[id] = { pt:0, gf:0, gs:0, gd:0, g:0 }; });
  girone.partite.forEach(p => {
    const pr = pronosticiGironi && pronosticiGironi[p.id];
    const gc = Number(pr && pr.gol_casa), gt = Number(pr && pr.gol_trasferta);
    if (!pr || pr.gol_casa == null || pr.gol_trasferta == null) return;
    stats[p.casa].g++;      stats[p.trasferta].g++;
    stats[p.casa].gf += gc; stats[p.casa].gs += gt;  stats[p.casa].gd += gc - gt;
    stats[p.trasferta].gf += gt; stats[p.trasferta].gs += gc; stats[p.trasferta].gd += gt - gc;
    if (gc > gt)        stats[p.casa].pt += 3;
    else if (gc === gt){ stats[p.casa].pt++;    stats[p.trasferta].pt++; }
    else                stats[p.trasferta].pt += 3;
  });
  return girone.squadre
    .map(id => ({ id, ...stats[id] }))
    .sort((a,b) => (b.pt-a.pt) || (b.gd-a.gd) || (b.gf-a.gf));
}

function _calcola3rdiSlots(pronosticiGironi, overrideOrder) {
  const terzi = {};
  Object.keys(DB.gironi).forEach(lettera => {
    const cl = _getClassificaGirone(lettera, pronosticiGironi);
    if (cl.length < 3 || cl[2].g === 0) return;
    const t = cl[2];
    terzi[lettera] = { teamId: t.id, pt: t.pt, gd: t.gd, gf: t.gf };
  });
  let sorted = Object.entries(terzi).sort(([,a],[,b]) => b.pt-a.pt || b.gd-a.gd || b.gf-a.gf);
  // Override manuale (spareggio admin) — sincronizzato con js/bracket.js:
  // usato SOLO come ultimo criterio, a parità di pt/GD/GF.
  if (Array.isArray(overrideOrder) && overrideOrder.length) {
    const pos = {};
    overrideOrder.forEach((id, i) => { pos[id] = i; });
    sorted = sorted.slice().sort(([,a],[,b]) =>
      b.pt - a.pt || b.gd - a.gd || b.gf - a.gf ||
      ((pos[a.teamId] !== undefined ? pos[a.teamId] : Infinity) -
       (pos[b.teamId] !== undefined ? pos[b.teamId] : Infinity)));
  }
  if (sorted.length < 8) return null;
  const qualGroups = sorted.slice(0,8).map(([l]) => l).sort().join('');
  const comb = COMB_3I[qualGroups];
  if (!comb) return null;
  const result = {};
  COMB_SLOT_ORDER.forEach((slot, i) => {
    result[slot] = (terzi[comb[i]] && terzi[comb[i]].teamId) || null;
  });
  return result;
}

function _resolveSlot(slotDef, standings, terziSlots) {
  if (slotDef.t === '1') return (standings[slotDef.g] && standings[slotDef.g][0]) || null;
  if (slotDef.t === '2') return (standings[slotDef.g] && standings[slotDef.g][1]) || null;
  if (slotDef.t === '3slot') return terziSlots ? (terziSlots[slotDef.slot] || null) : null;
  return null;
}

/**
 * Calcola il punteggio totale e il breakdown per un partecipante.
 * @param {Object} pronostici  — scheda pronostici del partecipante
 * @param {Object} risultati   — risultati ufficiali dal Firestore
 * @returns {{ totale: number, breakdown: Object }}
 */
function calcolaPunteggio(pronostici, risultati) {
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

  const rGironi  = (risultati && risultati.gironi)                    || {};
  const rElim    = (risultati && risultati.fase_eliminatoria)          || {};
  const rGriglia = (risultati && risultati.posizioni_finali_gironi)    || {};
  const rCannon  = (risultati && risultati.capocannoniere_finale)      || {};
  const pGironi  = (pronostici && pronostici.gironi)                   || {};
  const pPosiz   = (pronostici && pronostici.posizioni_girone)         || {};
  const pElim    = (pronostici && pronostici.fase_eliminatoria)        || {};
  const pCannon  = (pronostici && pronostici.capocannoniere)           || {};

  // ── 1. FASE A GIRONI ──────────────────────────────────
  Object.entries(DB.gironi).forEach(([, girone]) => {
    girone.partite.forEach(partita => {
      const r = rGironi[partita.id];
      const p = pGironi[partita.id];
      if (!r || r.gol_casa == null || r.gol_trasferta == null || !p) return;

      bd.gironi_segno.totale++;
      bd.gironi_esatto.totale++;

      const segnoR = r.gol_casa > r.gol_trasferta ? '1'
                   : r.gol_casa < r.gol_trasferta ? '2' : 'X';
      if (p.segno === segnoR) {
        bd.gironi_segno.punti += REG.girone.segno_1X2;
        bd.gironi_segno.corretti++;

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
  Object.keys(DB.gironi).forEach(function(l) {
    if (rGriglia[l] && rGriglia[l].length) {
      standingsR[l] = rGriglia[l];
    } else {
      grigliaPronta = false;
    }
  });

  if (grigliaPronta) {
    const terziSlotsR = _calcola3rdiSlots(rGironi, (risultati && risultati.spareggio_terze) || null);
    const standingsP  = pPosiz;
    const terziSlotsP = _calcola3rdiSlots(pGironi);

    SEDICESIMI_BRACKET.forEach(function(slot) {
      const actualCasa  = _resolveSlot(slot.casa,  standingsR, terziSlotsR);
      const actualTrasf = _resolveSlot(slot.trasf, standingsR, terziSlotsR);
      const predCasa    = _resolveSlot(slot.casa,  standingsP, terziSlotsP);
      const predTrasf   = _resolveSlot(slot.trasf, standingsP, terziSlotsP);

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
    { key: 'sedicesimi', field: bd.sedicesimi, pti: REG.fasi_eliminatorie.sedicesimi },
    { key: 'ottavi',     field: bd.ottavi,     pti: REG.fasi_eliminatorie.ottavi },
    { key: 'quarti',     field: bd.quarti,     pti: REG.fasi_eliminatorie.quarti },
    { key: 'semifinali', field: bd.semifinali, pti: REG.fasi_eliminatorie.semifinali },
    { key: 'finale',     field: bd.finale,     pti: REG.fasi_eliminatorie.finale },
  ];

  fasi.forEach(({ key, field, pti }) => {
    const rFase = rElim[key] || {};
    const pFase = pElim[key] || {};
    const squadreR = new Set(
      Object.values(rFase).flatMap(m => [m && m.casa, m && m.trasferta, m && m.vincitore]).filter(Boolean)
    );
    const squadreP = Object.values(pFase).map(m => m && m.vincitore).filter(Boolean);

    // Punti per squadra avanzata correttamente (tutte le fasi, finale inclusa)
    squadreP.forEach(sq => {
      if (squadreR.has(sq)) { field.punti += pti; field.corretti++; }
    });

    Object.entries(rFase).forEach(([matchId, rMatch]) => {
      if (!rMatch || !rMatch.modalita) return;
      const pMatch = pFase[matchId];
      if (!pMatch) return;
      if (pMatch.modalita === rMatch.modalita) {
        bd.modalita.punti += REG.fasi_eliminatorie.modalita_passaggio_turno.punti;
        bd.modalita.corretti++;
      }
    });
  });

  // ── 4. VINCITORE TORNEO ───────────────────────────────
  const vincitoreR = rElim.finale && rElim.finale.F && rElim.finale.F.vincitore;
  if (vincitoreR && pElim.finale && pElim.finale.F && pElim.finale.F.vincitore === vincitoreR) {
    bd.vincitore.punti = REG.fasi_eliminatorie.vincitore_torneo;
    bd.vincitore.corretto = true;
  }

  // ── 5. CAPOCANNONIERE ─────────────────────────────────
  // I punti del capocannoniere si assegnano SOLO a fine torneo,
  // quando il vincitore della finale è noto.
  if (vincitoreR) {
    const cp1 = rCannon.primo; const cp2 = rCannon.secondo; const cp3 = rCannon.terzo;
    const pp1 = pCannon.primo; const pp2 = pCannon.secondo; const pp3 = pCannon.terzo;
    const ternaR = [cp1, cp2, cp3].filter(Boolean);
    const ternaP = [pp1, pp2, pp3].filter(Boolean);

    if (cp1 && pp1 === cp1) { bd.capocannoniere.punti += REG.capocannoniere.primo_classificato;   bd.capocannoniere.dettaglio += '1°✓ '; }
    if (cp2 && pp2 === cp2) { bd.capocannoniere.punti += REG.capocannoniere.secondo_classificato; bd.capocannoniere.dettaglio += '2°✓ '; }
    if (cp3 && pp3 === cp3) { bd.capocannoniere.punti += REG.capocannoniere.terzo_classificato;   bd.capocannoniere.dettaglio += '3°✓ '; }
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
function calcolaSparegnio(pronostici, risultati) {
  const { breakdown: bd } = calcolaPunteggio(pronostici, risultati);
  const rElim   = (risultati  && risultati.fase_eliminatoria)   || {};
  const pElim   = (pronostici && pronostici.fase_eliminatoria)  || {};
  const rCannon = (risultati  && risultati.capocannoniere_finale) || {};
  const pCannon = (pronostici && pronostici.capocannoniere)     || {};

  const vincR  = rElim.finale && rElim.finale.F && rElim.finale.F.vincitore;
  const ternaR = [rCannon.primo, rCannon.secondo, rCannon.terzo].filter(Boolean);
  const pp1    = pCannon.primo;

  return [
    vincR && pElim.finale && pElim.finale.F && pElim.finale.F.vincitore === vincR ? 1 : 0,  // 1. Vincitore
    bd.finale.corretti,                                                  // 2. Finaliste
    bd.semifinali.corretti,                                              // 3. Semifinaliste
    bd.quarti.corretti,                                                  // 4. Quarti
    bd.ottavi.corretti,                                                  // 5. Ottavi
    bd.gironi_esatto.corretti,                                           // 6. Risultati esatti
    vincR && pp1 === rCannon.primo ? 1 : 0,                              // 7. Cannoniere 1°
    bd.posto_griglia.corretti,                                           // 8. Posizioni griglia
    [pCannon.primo, pCannon.secondo, pCannon.terzo]
      .filter(p => ternaR.includes(p)).length,                           // 9. Terna cannonieri
    bd.gironi_segno.corretti,                                            // 10. Segni girone
    bd.modalita.corretti,                                                // 11. Modalità passaggio
  ];
}

module.exports = { calcolaPunteggio, calcolaSparegnio };
