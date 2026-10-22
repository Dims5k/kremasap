/* Kremasap — garde-robe locale + moteur de tenues (accords de couleurs, style, météo) */
"use strict";

const CATS = [
  ["haut", "T-shirts & chemises"], ["pull", "Pulls & sweats"], ["veste", "Vestes & manteaux"],
  ["pantalon", "Pantalons & jeans"], ["short", "Shorts"], ["chaussures", "Chaussures"], ["accessoire", "Accessoires"]
];
const STYLES = ["casual", "streetwear", "chic", "classique", "sport"];
const SEASONS = ["toutes", "hiver", "mi-saison", "été"];
const catLabel = Object.fromEntries(CATS);
const $ = id => document.getElementById(id);

let items = [];          // {id,name,cat,style,season,colorName,hex,photo:Blob,created}
let filter = "all";
let editing = null;      // item en cours d'édition ou null
let pendingBlob = null;
const urlCache = new Map();

/* ---------- Stockage local (IndexedDB) ---------- */
const DB_NAME = "kremasap", STORE = "items";
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
let dbp = null;
const db = () => (dbp ||= openDB());
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new DOMException("Transaction annulée", "AbortError"));
  });
}
/* Safari (iPhone) refuse souvent de stocker un Blob dans IndexedDB :
   on enregistre la photo en ArrayBuffer et on la reconvertit au chargement. */
async function blobBuf(photo, id) {
  try { return await photo.arrayBuffer(); }
  catch {
    // Ancienne photo devenue illisible dans Safari : on la redessine depuis l'image affichée
    const src = urlCache.get(id) || URL.createObjectURL(photo);
    const im = await loadImage(src);
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext("2d").drawImage(im, 0, 0);
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", .85));
    if (!b) throw new Error("photo");
    return await b.arrayBuffer();
  }
}
async function toStored(it) {
  const { photo, ...rest } = it;
  if (photo instanceof Blob) {
    try { return { ...rest, photoBuf: await blobBuf(photo, it.id), photoType: "image/jpeg" }; }
    catch { return { ...rest, photo: null, photoLost: true }; }   // on garde la fiche même si la photo est perdue
  }
  return { ...rest, photo: photo || null };
}
const legacy = new Set();   // fiches encore stockées en Blob (ancien format)
function fromStored(r) {
  if (r.photo instanceof Blob) legacy.add(r.id);
  if (r.photoBuf) { const { photoBuf, photoType, ...rest } = r; return { ...rest, photo: new Blob([photoBuf], { type: photoType || "image/jpeg" }) }; }
  return r;
}
const dbAll = async () => (await tx("readonly", s => s.getAll())).map(fromStored);
const dbPut = async it => { const rec = await toStored(it); return tx("readwrite", s => s.put(rec)); };
const dbDel = id => tx("readwrite", s => s.delete(id));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Couleurs ---------- */
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(r, g, b) { return "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join(""); }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
const hsl = hex => rgbToHsl(...hexToRgb(hex || "#808080"));

/* Nuancier : noms de couleurs courants en mode */
const NAMED = [
  ["noir", "#151515"], ["anthracite", "#3A3D42"], ["gris", "#8A8D92"], ["gris clair", "#C4C6C9"], ["blanc", "#F5F5F2"],
  ["écru", "#EDE6D6"], ["crème", "#F1E7CC"], ["beige", "#D8C7A6"], ["sable", "#C9B48A"], ["taupe", "#8B7E70"],
  ["camel", "#B8874E"], ["cognac", "#9A5B2E"], ["marron", "#6B4429"], ["chocolat", "#3E2618"],
  ["kaki", "#5E6340"], ["vert olive", "#6F7A3A"], ["vert sapin", "#1F4D36"], ["vert bouteille", "#16432F"], ["vert", "#3E9B4F"],
  ["vert émeraude", "#11866A"], ["vert menthe", "#A7DCC0"], ["vert sauge", "#9CAF88"],
  ["bleu marine", "#1C2541"], ["bleu nuit", "#141C33"], ["bleu brut", "#28344D"], ["bleu jean", "#4A6A95"], ["bleu délavé", "#8EA4C2"],
  ["bleu roi", "#2B4FC2"], ["bleu électrique", "#1F6FEB"], ["bleu ciel", "#A9C8EA"], ["bleu pétrole", "#1F5866"], ["turquoise", "#2EB5B0"],
  ["bordeaux", "#6B1E2A"], ["rouge", "#C62828"], ["rouge vif", "#E0262B"], ["framboise", "#C2185B"], ["corail", "#F0625A"],
  ["saumon", "#F4A08A"], ["pêche", "#F7C2A0"], ["terracotta", "#C0583E"], ["rouille", "#A3471F"], ["orange", "#EE7A1C"],
  ["rose", "#E88BAA"], ["rose pâle", "#F2CCD6"], ["fuchsia", "#D6328A"], ["violet", "#6A3E9A"], ["prune", "#5B2A4A"], ["lavande", "#B9A7D9"],
  ["moutarde", "#C9A227"], ["jaune", "#F2D23A"], ["jaune pâle", "#F4E7A1"]
];
function rgbToLab(r, g, b) {
  const lin = v => { v /= 255; return v > .04045 ? ((v + .055) / 1.055) ** 2.4 : v / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const X = f((R * .4124 + G * .3576 + B * .1805) / .95047), Y = f(R * .2126 + G * .7152 + B * .0722), Z = f((R * .0193 + G * .1192 + B * .9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
/* Écart de couleur tel que l'œil le perçoit (CIEDE2000) */
function deltaE(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2, rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = .5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G);
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => { const h = Math.atan2(b, a) / rad; return h < 0 ? h + 360 : h; };
  const h1 = hp(b1, ap1), h2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = h2 - h1; if (Cp1 * Cp2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2 * rad);
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = h1 + h2; if (Cp1 * Cp2 !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2) : (h1 + h2) / 2;
  const T = 1 - .17 * Math.cos((hm - 30) * rad) + .24 * Math.cos(2 * hm * rad) + .32 * Math.cos((3 * hm + 6) * rad) - .2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + .015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + .045 * Cpm, SH = 1 + .015 * Cpm * T;
  const RT = -2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
const NAMED_LAB = NAMED.map(([n, h]) => [n, rgbToLab(...hexToRgb(h))]);
function colorName(hex) {
  const lab = rgbToLab(...hexToRgb(hex));
  let best = NAMED_LAB[0][0], bd = Infinity;
  for (const [n, l] of NAMED_LAB) { const d = deltaE(lab, l); if (d < bd) { bd = d; best = n; } }
  return best;
}
/* Ancien nommage (avant le nuancier élargi) : sert à repérer les noms donnés automatiquement */
const OLD_NAMED = ["noir#151515", "anthracite#3A3D42", "gris#8A8D92", "gris clair#C4C6C9", "blanc#F5F5F2", "écru#EDE6D6", "beige#D8C7A6", "camel#B8874E", "marron#6B4429", "chocolat#3E2618", "kaki#5E6340", "vert olive#6F7A3A", "vert sapin#1F4D36", "vert#3E9B4F", "vert menthe#A7DCC0", "bleu marine#1C2541", "bleu brut#28344D", "bleu jean#4A6A95", "bleu roi#2B4FC2", "bleu ciel#A9C8EA", "turquoise#2EB5B0", "bordeaux#6B1E2A", "rouge#C62828", "rose#E88BAA", "rose pâle#F2CCD6", "violet#6A3E9A", "lavande#B9A7D9", "orange#E3761F", "rouille#A3471F", "moutarde#C9A227", "jaune#F2D23A"].map(x => { const i = x.indexOf("#"); return [x.slice(0, i), x.slice(i)]; });
function oldColorName(hex) {
  const [r, g, b] = hexToRgb(hex); let best = "", bd = Infinity;
  for (const [n, h] of OLD_NAMED) { const [R, G, B] = hexToRgb(h), rm = (r + R) / 2; const d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
/* Renomme les couleurs nommées automatiquement par l'ancien nuancier ; un nom tapé à la main est gardé */
function renameAuto(it) {
  let changed = false;
  for (const c of it.colors || []) if (!c.manual && c.name === oldColorName(c.hex)) { const n = colorName(c.hex); if (n !== c.name) { c.name = n; changed = true; } }
  if (it.colors?.length) { it.colorName = it.colors[0].name; }
  else if (it.hex && it.colorName === oldColorName(it.hex)) { const n = colorName(it.hex); if (n !== it.colorName) { it.colorName = n; changed = true; } }
  return changed;
}
const vowel = w => /^[aeiouyéèêàâîôûh]/i.test(w || "");
const de = w => (vowel(w) ? "d'" : "de ") + w;
const le = w => (vowel(w) ? "l'" : "le ") + w;
/* Les neutres de la mode : noir/blanc/gris, marine, jean, beige, camel, kaki, marron */
function isNeutral(hex) {
  const [h, s, l] = hsl(hex);
  if (s < .16 || l < .16 || l > .93) return true;
  if (h >= 195 && h <= 245 && l < .34) return true;                 // marine
  if (h >= 200 && h <= 230 && s < .5 && l < .55) return true;        // jean
  if (h >= 18 && h <= 55 && s < .55 && l > .5) return true;          // beige, écru, camel
  if (h >= 15 && h <= 45 && l < .42 && s < .65) return true;         // marron, chocolat
  if (h >= 50 && h <= 95 && s < .42 && l < .55) return true;         // kaki, olive
  return false;
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/* Palette d'une photo : jusqu'à 3 couleurs avec leur proportion, en ignorant le fond */
function extractPalette(img) {
  const N = 80, c = document.createElement("canvas"); c.width = c.height = N;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  return paletteFromPixels(x.getImageData(0, 0, N, N).data, N);
}
/* Isole le vêtement du fond (lit, sol, drap…) : renvoie un masque 1 = vêtement */
function garmentMask(d, N) {
  const n = N * N;
  // 1. Flou léger pour lisser les textures (fausse fourrure, plis, grain)
  const rgb = new Float32Array(n * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let r = 0, g = 0, b = 0, c = 0;
    for (let y = Math.max(0, j - 1); y <= Math.min(N - 1, j + 1); y++) for (let x = Math.max(0, i - 1); x <= Math.min(N - 1, i + 1); x++) {
      const k = (y * N + x) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; c++;
    }
    const o = (j * N + i) * 3; rgb[o] = r / c; rgb[o + 1] = g / c; rgb[o + 2] = b / c;
  }
  const lab = new Array(n);
  for (let p = 0; p < n; p++) lab[p] = rgbToLab(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
  const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // 2. Couleurs du fond = couleurs du bord de la photo (k-means k=5)
  const bIdx = [];
  for (let i = 0; i < N; i++) bIdx.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
  const bl = bIdx.map(p => lab[p]);
  let cent = [bl[0]];
  while (cent.length < 5) { let best = bl[0], bd = -1; for (const p of bl) { const m = Math.min(...cent.map(c => dE(c, p))); if (m > bd) { bd = m; best = p; } } cent.push(best); }
  let asg = [];
  for (let it = 0; it < 6; it++) {
    asg = bl.map(p => { let bi = 0, bd = Infinity; cent.forEach((c, k) => { const v = dE(c, p); if (v < bd) { bd = v; bi = k; } }); return bi; });
    cent = cent.map((c, k) => { const m = bl.filter((_, i) => asg[i] === k); return m.length ? [0, 1, 2].map(z => m.reduce((a, p) => a + p[z], 0) / m.length) : c; });
  }
  // Une couleur n'est du fond que si elle occupe une vraie part du bord (un jean qui touche le bord ne compte pas)
  // …ni si elle domine le centre de la photo (là où est le vêtement)
  const mid = [];
  for (let y = N * .35 | 0; y < N * .65; y++) for (let x = N * .35 | 0; x < N * .65; x++) mid.push(lab[y * N + x]);
  const borderCols = cent.filter((_, k) => asg.filter(a => a === k).length / bl.length >= .1);
  const bgCols = cent.filter((c, k) => asg.filter(a => a === k).length / bl.length >= .1 && mid.filter(p => dE(c, p) < 9).length / mid.length < .3);
  // 3. Remplissage depuis le bord : tout ce qui est relié au bord et proche d'une couleur du fond est du fond
  const T = 13, bg = new Uint8Array(n), q = [];
  const near = p => bgCols.some(c => dE(c, lab[p]) < T);
  for (const p of bIdx) if (!bg[p] && near(p)) { bg[p] = 1; q.push(p); }
  while (q.length) {
    const p = q.pop(), x = p % N, y = (p / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
      const r = Y * N + X; if (bg[r]) continue;
      if (near(r) || (dE(lab[r], lab[p]) < 4 && bgCols.some(c => dE(c, lab[r]) < T * 1.6))) { bg[r] = 1; q.push(r); }
    }
  }
  // 4. Zones restantes : on garde le vêtement (grande zone, vers le centre), pas les bouts de pied ou de meuble
  const comp = new Int32Array(n).fill(-1), sizes = [], cen = [];
  for (let p = 0; p < n; p++) {
    if (bg[p] || comp[p] >= 0) continue;
    const id = sizes.length; let sz = 0, cs = 0; const st = [p]; comp[p] = id;
    while (st.length) {
      const c = st.pop(); sz++;
      const x = c % N, y = (c / N) | 0;
      if (Math.abs(x - N / 2) < N * .25 && Math.abs(y - N / 2) < N * .25) cs++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
        const r = Y * N + X; if (!bg[r] && comp[r] < 0) { comp[r] = id; st.push(r); }
      }
    }
    sizes.push(sz); cen.push(cs);
  }
  const score = sizes.map((s, i) => s * (1 + 3 * cen[i] / Math.max(1, s)));
  const best = score.indexOf(Math.max(...score));
  const mask = new Uint8Array(n);
  if (best >= 0 && sizes[best] >= n * .05) {
    for (let p = 0; p < n; p++) { const c = comp[p]; if (c >= 0 && (c === best || (cen[c] > 0 && sizes[c] >= sizes[best] * .3))) mask[p] = 1; }
  } else {
    // Rien de net : on prend le centre de la photo
    for (let y = N * .3 | 0; y < N * .7; y++) for (let x = N * .3 | 0; x < N * .7; x++) mask[y * N + x] = 1;
    return { mask, borderCols, lab };
  }
  // 5. On retire le liseré du contour (pixels mélangés vêtement/fond)
  const er = mask.slice();
  for (let p = 0; p < n; p++) if (mask[p]) { const x = p % N, y = (p / N) | 0; if (x && y && x < N - 1 && y < N - 1 && !(mask[p - 1] && mask[p + 1] && mask[p - N] && mask[p + N])) er[p] = 0; }
  return { mask: er.reduce((a, v) => a + v, 0) > n * .03 ? er : mask, borderCols, lab };
}
function paletteFromPixels(d, N) {
  const px = (i, j) => { const k = (j * N + i) * 4; return [d[k], d[k + 1], d[k + 2]]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Fond (lit, sol, drap…) retiré : on ne garde que les pixels du vêtement
  const { mask, borderCols } = garmentMask(d, N);
  const fg = [], fgPos = [];
  for (let p = 0; p < N * N; p++) if (mask[p]) { fg.push(px(p % N, (p / N) | 0)); fgPos.push(p); }
  if (fg.length < 40) { const p = px(N >> 1, N >> 1); const hex = rgbToHex(...p); return [{ hex, name: colorName(hex), share: 1 }]; }
  // k-means (k=5), départ par points les plus éloignés
  const K = Math.min(5, fg.length);
  const cent = [fg[Math.floor(fg.length / 2)]];
  while (cent.length < K) {
    let best = fg[0], bd = -1;
    for (let i = 0; i < fg.length; i += 3) { const dd = Math.min(...cent.map(c => dist(c, fg[i]))); if (dd > bd) { bd = dd; best = fg[i]; } }
    cent.push(best);
  }
  let assign = new Array(fg.length).fill(0);
  for (let it = 0; it < 8; it++) {
    for (let i = 0; i < fg.length; i++) { let bi = 0, bd = Infinity; for (let k = 0; k < K; k++) { const dd = dist(fg[i], cent[k]); if (dd < bd) { bd = dd; bi = k; } } assign[i] = bi; }
    for (let k = 0; k < K; k++) {
      const m = fg.filter((_, i) => assign[i] === k);
      if (m.length) cent[k] = [0, 1, 2].map(c => m.reduce((a, p) => a + p[c], 0) / m.length);
    }
  }
  let cl = cent.map((c, k) => ({ rgb: c, n: assign.filter(a => a === k).length })).filter(c => c.n);
  // Fusion des nuances d'une même couleur (ombres, plis)
  const same = (a, b) => {
    const ha = rgbToHex(...a.rgb), hb = rgbToHex(...b.rgb);
    if (family(ha) === family(hb)) return true;
    const na = isNeutral(ha), nb = isNeutral(hb);
    if (!na && !nb && hueDist(hsl(ha)[0], hsl(hb)[0]) < 18) return true;
    const [h1, s1] = hsl(ha), [h2, s2] = hsl(hb);
    if (s1 > .3 && s2 > .3 && hueDist(h1, h2) < 15) return true;   // même teinte, plus ou moins à l'ombre
    return dist(a.rgb, b.rgb) < 38;
  };
  cl.sort((a, b) => b.n - a.n);
  const merged = [];
  for (const c of cl) {
    const m = merged.find(x => same(x, c));
    if (m) { m.rgb = m.rgb.map((v, i) => (v * m.n + c.rgb[i] * c.n) / (m.n + c.n)); m.n += c.n; }
    else merged.push({ ...c });
  }
  // Couleur réelle : on réattribue les pixels, puis on garde ceux entre 35 % et 90 % de luminosité (ni ombre ni reflet)
  const lum = p => .2126 * p[0] + .7152 * p[1] + .0722 * p[2];
  const groups = merged.map(() => []);
  for (const p of fg) { let bi = 0, bd = Infinity; merged.forEach((m, k) => { const dd = dist(p, m.rgb); if (dd < bd) { bd = dd; bi = k; } }); groups[bi].push(p); }
  merged.forEach((m, k) => {
    const g = groups[k].sort((a, b) => lum(a) - lum(b));
    if (g.length < 8) return;
    const lit = g.slice(Math.floor(g.length * .35), Math.ceil(g.length * .9));
    m.rgb = [0, 1, 2].map(c => lit.reduce((a, p) => a + p[c], 0) / lit.length);
  });
  // Une couleur secondaire qui ressemble au fond est un reste du lit, pas une couleur du vêtement
  const isBgLike = c => { const l = rgbToLab(...c.rgb); return borderCols.some(b => Math.hypot(l[0] - b[0], l[1] - b[1], l[2] - b[2]) < 12); };
  merged.sort((a, b) => b.n - a.n);
  for (let i = merged.length - 1; i > 0; i--) if (isBgLike(merged[i])) merged.splice(i, 1);
  const total = merged.reduce((a, c) => a + c.n, 0);
  return merged.sort((a, b) => b.n - a.n)
    .map(c => { const hex = rgbToHex(...c.rgb); return { hex, name: colorName(hex), share: c.n / total }; })
    .filter((c, i) => i === 0 || c.share >= .1).slice(0, 3)
    .map((c, _, arr) => ({ ...c, share: Math.round(c.share / arr.reduce((a, x) => a + x.share, 0) * 100) / 100 }));
}
/* Couleurs d'une pièce (anciennes fiches : une seule couleur) */
function pieceColors(p) {
  const list = p.colors?.length ? p.colors : [{ hex: p.hex, name: p.colorName, share: 1 }];
  return list.filter((c, i) => i === 0 || c.share >= .1);
}

/* ---------- Images ---------- */
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("image")); im.src = src; });
}
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url);
    const max = 800, k = Math.min(1, max / Math.max(im.width, im.height));
    const c = document.createElement("canvas");
    c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .82));
    return { blob, img: im };
  } finally { URL.revokeObjectURL(url); }
}
function photoUrl(it) {
  if (!it.photo) return "";
  if (!urlCache.has(it.id)) urlCache.set(it.id, URL.createObjectURL(it.photo));
  return urlCache.get(it.id);
}
function dropUrl(id) { if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); } }
function phEl(it) {
  const d = document.createElement("div"); d.className = "ph";
  const s = photoUrl(it);
  if (s) { const im = document.createElement("img"); im.src = s; im.alt = it.name || ""; im.loading = "lazy"; d.appendChild(im); }
  else { const sw = document.createElement("div"); sw.className = "swatch"; sw.style.background = it.hex; sw.textContent = (catLabel[it.cat] || "").split(" ")[0]; d.appendChild(sw); }
  return d;
}

/* ---------- Rendu garde-robe ---------- */
function fillSelect(el, opts) {
  el.innerHTML = "";
  for (const o of opts) {
    const [v, t] = Array.isArray(o) ? o : [o, o[0].toUpperCase() + o.slice(1)];
    const op = document.createElement("option"); op.value = v; op.textContent = t; el.appendChild(op);
  }
}
fillSelect($("fCat"), CATS); fillSelect($("fStyle"), STYLES); fillSelect($("fSeason"), SEASONS);

function renderChips() {
  const c = $("chips"); c.innerHTML = "";
  for (const [k, l] of [["all", "Tout"], ...CATS]) {
    const n = k === "all" ? items.length : items.filter(i => i.cat === k).length;
    if (k !== "all" && !n && filter !== k) continue;
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", filter === k);
    b.append(l + " ");
    const bb = document.createElement("b"); bb.textContent = n; b.appendChild(bb);
    b.onclick = () => { filter = k; render(); };
    c.appendChild(b);
  }
}
function render() {
  renderChips();
  $("count").textContent = items.length;
  const g = $("grid"); g.innerHTML = "";
  const list = items.filter(i => filter === "all" || i.cat === filter);
  if (!list.length) {
    g.innerHTML = items.length
      ? '<div class="empty">Aucune pièce dans cette catégorie.</div>'
      : '<div class="empty"><strong>Ta penderie est vide.</strong><br>Appuie sur « + Ajouter » et photographie un vêtement à plat ou sur un cintre, sur un fond uni. Kremasap détecte sa couleur.</div>';
  }
  for (const it of list) {
    const card = document.createElement("button"); card.className = "item";
    card.setAttribute("aria-label", "Modifier " + (it.name || "la pièce"));
    card.appendChild(phEl(it));
    const m = document.createElement("div"); m.className = "meta";
    const s = document.createElement("strong"); s.textContent = it.name || "Sans nom"; m.appendChild(s);
    const t = document.createElement("div"); t.className = "tags";
    for (const c of pieceColors(it)) { const d = document.createElement("span"); d.className = "dot"; d.style.background = c.hex; t.appendChild(d); }
    const tx = document.createElement("span"); tx.textContent = [it.brand, pieceColors(it).map(c => c.name).join("/"), it.style].filter(Boolean).join(" · ") + (it.ensemble ? " · ensemble" : ""); t.appendChild(tx);
    m.appendChild(t); card.appendChild(m);
    card.onclick = () => openSheet(it);
    g.appendChild(card);
  }
  const ms = $("must"), cur = ms.value;
  ms.innerHTML = '<option value="">Aucune</option>';
  for (const i of items) {
    const o = document.createElement("option"); o.value = i.id;
    o.textContent = (i.name || "?") + " — " + (catLabel[i.cat] || i.cat); ms.appendChild(o);
  }
  ms.value = items.some(i => i.id === cur) ? cur : "";
}

/* ---------- Onglets ---------- */
function show(v) {
  const w = v === "w";
  $("tabW").setAttribute("aria-selected", w); $("tabO").setAttribute("aria-selected", !w);
  $("viewW").hidden = !w; $("viewO").hidden = w;
}
$("tabW").onclick = () => show("w");
$("tabO").onclick = () => show("o");

/* ---------- Fiche (ajout / édition) ---------- */
$("add").onclick = () => { $("file").value = ""; $("file").click(); };
$("file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  let r;
  try { r = await shrink(f); } catch { flash("Photo illisible, essaie une autre."); return; }
  pendingBlob = r.blob;
  const colors = extractPalette(r.img);
  openSheet(null, { colors });
  if (getKey()) aiAnalyze(r.blob);
  else $("aiStatus").textContent = (colors.length > 1 ? colors.length + " couleurs détectées" : "Couleur détectée") + " automatiquement. Vérifie la catégorie et le style.";
};
function openSheet(it, guess = {}) {
  editing = it;
  $("sheetT").textContent = it ? "Modifier la pièce" : "Nouveau vêtement";
  const pv = $("pv"); pv.innerHTML = "";
  const src = it ? photoUrl(it) : URL.createObjectURL(pendingBlob);
  if (src) { const im = document.createElement("img"); im.src = src; im.alt = ""; pv.appendChild(im); if (!it) im.onload = () => URL.revokeObjectURL(src); }
  $("fName").value = it?.name || "";
  $("fCat").value = it?.cat || "haut";
  $("fStyle").value = it?.style || "casual";
  $("fSeason").value = it?.season || "toutes";
  sheetColors = (it ? pieceColors(it) : guess.colors || [{ hex: "#333333", name: "anthracite", share: 1 }]).map(c => ({ ...c }));
  renderColors();
  $("fBrand").value = it?.brand || "";
  $("fPattern").value = it?.pattern || "uni";
  if (it) $("aiStatus").textContent = "";
  $("redetect").hidden = !it;
  fillSetOptions();
  $("delete").hidden = !it; resetDelete();
  $("saveErr").hidden = true;
  $("sheet").hidden = false;
}

/* ---------- Ensembles (ex. haut + bas Halo noir) ---------- */
const SET_CATS = ["haut", "pull", "veste", "pantalon", "short"];
const isTop = c => c === "haut" || c === "pull";
const isBottom = c => c === "pantalon" || c === "short";
const setMembers = ens => ens ? items.filter(i => i.ensemble === ens) : [];
const NEUTRAL_FAMILY = { "noir": "noir", "anthracite": "noir", "gris": "gris", "gris clair": "gris", "taupe": "gris", "blanc": "blanc", "écru": "blanc", "crème": "blanc",
  "beige": "beige", "sable": "beige", "camel": "camel", "cognac": "marron", "marron": "marron", "chocolat": "marron", "kaki": "kaki", "vert olive": "kaki",
  "bleu marine": "bleu foncé", "bleu nuit": "bleu foncé", "bleu brut": "bleu foncé", "bleu jean": "bleu jean", "bleu délavé": "bleu jean" };
const family = hex => { const n = colorName(hex); return NEUTRAL_FAMILY[n] || n; };
function partnerCandidates(cat) {
  const self = editing?.id;
  return items.filter(i => i.id !== self && SET_CATS.includes(i.cat) && i.cat !== cat &&
    ((isTop(cat) && (isBottom(i.cat) || i.cat === "veste")) || (isBottom(cat) && (isTop(i.cat) || i.cat === "veste")) ||
     (cat === "veste" && (isTop(i.cat) || isBottom(i.cat)))));
}
function detectPartner() {
  const brand = $("fBrand").value.trim().toLowerCase(), cat = $("fCat").value, fam = family(sheetColors[0]?.hex || "#333333");
  if (!brand || !SET_CATS.includes(cat)) return null;
  return partnerCandidates(cat).find(i => (i.brand || "").toLowerCase() === brand && family(i.hex) === fam) || null;
}
function fillSetOptions(keepValue) {
  const sel = $("fSet"), cat = $("fCat").value, hint = $("setHint");
  const prev = keepValue ? sel.value : "";
  sel.innerHTML = '<option value="">Aucun (pièce seule)</option>';
  hint.hidden = true;
  if (!SET_CATS.includes(cat)) { sel.disabled = true; return; }
  sel.disabled = false;
  for (const i of partnerCandidates(cat)) {
    const o = document.createElement("option"); o.value = i.id;
    o.textContent = [i.name, i.brand].filter(Boolean).join(" — "); sel.appendChild(o);
  }
  let v = prev;
  if (!v && editing?.ensemble) v = setMembers(editing.ensemble).find(m => m.id !== editing.id)?.id || "";
  if (!v && !editing?.ensemble) {
    const d = detectPartner();
    if (d) { v = d.id; hint.textContent = `Ensemble détecté : même marque et même couleur que « ${d.name} ». Choisis « Aucun » si ce n'est pas le cas.`; hint.hidden = false; }
  }
  sel.value = [...sel.options].some(o => o.value === v) ? v : "";
}
["fCat", "fBrand"].forEach(id => $(id).addEventListener("change", () => fillSetOptions(id !== "fCat")));
$("fBrand").addEventListener("input", () => { if (!$("fSet").value) fillSetOptions(); });

function closeSheet() { $("sheet").hidden = true; editing = null; pendingBlob = null; }
$("cancel").onclick = closeSheet;
$("sheet").addEventListener("click", e => { if (e.target === $("sheet")) closeSheet(); });

/* ---------- Couleurs de la pièce (éditables) ---------- */
let sheetColors = [];
function renderColors() {
  const box = $("fColors"); box.innerHTML = "";
  sheetColors.forEach((c, i) => {
    const row = document.createElement("div"); row.className = "crow";
    const inp = document.createElement("input"); inp.type = "color"; inp.value = c.hex; inp.setAttribute("aria-label", "Teinte " + (i + 1));
    const nm = document.createElement("input"); nm.type = "text"; nm.value = c.name || ""; nm.maxLength = 30; nm.setAttribute("aria-label", "Nom de la couleur " + (i + 1));
    const sh = document.createElement("span"); sh.className = "share"; sh.textContent = i === 0 ? "principale" : Math.round(c.share * 100) + " %";
    inp.addEventListener("input", () => { c.hex = inp.value; c.name = colorName(inp.value); c.manual = false; nm.value = c.name; });
    inp.addEventListener("change", () => fillSetOptions(true));
    nm.addEventListener("input", () => { c.name = nm.value; c.manual = true; });
    row.append(inp, nm, sh);
    if (sheetColors.length > 1) {
      const rm = document.createElement("button"); rm.type = "button"; rm.className = "rm"; rm.textContent = "×"; rm.setAttribute("aria-label", "Retirer " + (c.name || "cette couleur"));
      rm.onclick = () => { sheetColors.splice(i, 1); normShares(); renderColors(); fillSetOptions(true); };
      row.appendChild(rm);
    }
    box.appendChild(row);
  });
  $("addColor").hidden = sheetColors.length >= 3;
}
function normShares() { const t = sheetColors.reduce((a, c) => a + (c.share || 0), 0) || 1; sheetColors.forEach(c => c.share = Math.round((c.share || 0) / t * 100) / 100); }
$("addColor").onclick = () => { sheetColors.push({ hex: "#ffffff", name: "blanc", share: .2 }); normShares(); renderColors(); };


async function saveItem(it) {
  await dbPut(it);
  const i = items.findIndex(x => x.id === it.id);
  if (i >= 0) items[i] = it; else items.unshift(it);
}
/* Un ensemble à un seul membre n'en est plus un */
async function cleanupSet(ens) {
  const m = setMembers(ens);
  if (m.length === 1) await saveItem({ ...m[0], ensemble: null });
}

$("save").onclick = async () => {
  const b = $("save"); b.disabled = true;
  try {
    const it = editing ? { ...editing } : { id: uid(), created: Date.now(), photo: pendingBlob };
    const oldEns = it.ensemble || null;
    Object.assign(it, {
      name: $("fName").value.trim() || "Sans nom", cat: $("fCat").value, style: $("fStyle").value,
      season: $("fSeason").value, colors: sheetColors.map(c => ({ hex: c.hex, name: (c.name || "").trim() || colorName(c.hex), share: c.share, ...(c.manual ? { manual: true } : {}) })),
      brand: $("fBrand").value.trim(), pattern: $("fPattern").value
    });
    it.hex = it.colors[0].hex; it.colorName = it.colors[0].name;
    const partner = items.find(i => i.id === $("fSet").value);
    if (partner) {
      const ens = partner.ensemble || (oldEns && setMembers(oldEns).length <= 2 ? oldEns : null) || uid();
      it.ensemble = ens;
      if (partner.ensemble !== ens) await saveItem({ ...partner, ensemble: ens });
    } else it.ensemble = null;
    await saveItem(it);
    if (oldEns && oldEns !== it.ensemble) await cleanupSet(oldEns);
    closeSheet(); render();
  } catch (err) {
    console.error(err);
    const full = err?.name === "QuotaExceededError";
    const e = $("saveErr");
    e.textContent = full ? "Plus d'espace pour Kremasap sur ce téléphone. Supprime quelques pièces ou fais une sauvegarde."
      : "Impossible d'enregistrer (" + (err?.name || "erreur") + (err?.message ? " : " + err.message : "") + ").";
    e.hidden = false;
  }
  b.disabled = false;
};
function resetDelete() { const d = $("delete"); d.textContent = "Supprimer"; delete d.dataset.armed; }
$("delete").onclick = async () => {
  const d = $("delete");
  if (!d.dataset.armed) { d.dataset.armed = "1"; d.textContent = "Confirmer ?"; setTimeout(() => { if (d.dataset.armed) resetDelete(); }, 3000); return; }
  const id = editing.id, ens = editing.ensemble;
  await dbDel(id); dropUrl(id);
  items = items.filter(x => x.id !== id);
  if (ens) await cleanupSet(ens);
  closeSheet(); render();
};
function flash(t) { const s = $("oStatus"); show("w"); const g = $("grid"); const p = document.createElement("div"); p.className = "empty err"; p.textContent = t; g.prepend(p); setTimeout(() => p.remove(), 4000); }

/* ---------- Moteur de tenues (règles strictes) ---------- */
const OCC = {
  quotidien: { casual: 2, streetwear: 2, classique: 1, chic: 0, sport: 0 },
  soiree: { chic: 2, streetwear: 2, casual: 1, classique: 1, sport: -3 },
  travail: { classique: 3, chic: 2, casual: 0, streetwear: -2, sport: -4 },
  rdv: { chic: 2, casual: 2, classique: 1, streetwear: 1, sport: -3 },
  sport: { sport: 3, casual: 2, streetwear: 1, chic: -4, classique: -4 },
  fete: { chic: 3, classique: 2, casual: -1, streetwear: -2, sport: -5 }
};
const CLASH = { "sport|chic": -5, "sport|classique": -5, "streetwear|classique": -2, "streetwear|chic": -0.5 };
const clash = (a, b) => CLASH[a + "|" + b] ?? CLASH[b + "|" + a] ?? 0;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

function analyseColors(pieces) {
  const vivid = [], fams = new Set(), multi = [];
  for (const p of pieces) {
    const hues = [];
    for (const [ci, c] of pieceColors(p).entries()) {
      if (isNeutral(c.hex)) { if (c.share >= .2) fams.add(family(c.hex)); continue; }
      const [h] = hsl(c.hex);
      if (!hues.some(x => hueDist(x, h) < 25)) hues.push(h);
      const g = vivid.find(v => hueDist(v.h, h) < 25);
      if (g) { if (!g.pieces.has(p.id)) { g.pieces.add(p.id); g.n++; } if (ci > 0) g.accentOf = p; }
      else { vivid.push({ h, n: 1, name: c.manual ? c.name : colorName(c.hex), pieces: new Set([p.id]), accentOf: ci > 0 ? p : null }); fams.add("v" + vivid.length); }
    }
    if (hues.length >= 2) multi.push(p);
  }
  return { vivid, fams, multi };
}
/* Une pastille par famille de couleur réellement portée (mêmes règles que le comptage) */
function outfitPalette(pieces) {
  const out = [];
  for (const p of pieces) for (const [ci, c] of pieceColors(p).entries()) {
    if (ci > 0 && c.share < .2 && isNeutral(c.hex)) continue;
    const neu = isNeutral(c.hex), f = neu ? family(c.hex) : null, h = hsl(c.hex)[0];
    const g = out.find(x => neu ? x.f === f : (!x.f && hueDist(x.h, h) < 25));
    const w = c.share * (p.cat === "accessoire" ? .3 : 1);
    if (g) { if (w > g.w) { g.hex = c.hex; g.w = w; } } else out.push({ f, h, hex: c.hex, w });
  }
  return out.map(x => x.hex);
}
/* Neutres qui ne vont pas ensemble */
const BAD_NEUTRALS = [["noir", "marron"], ["noir", "bleu foncé"], ["camel", "kaki"], ["marron", "kaki"]];
const innerOk = p => isNeutral(pieceColors(p)[0].hex) && !pieceColors(p).some(c => !isNeutral(c.hex) && c.share >= .2);
/* Ensembles présents dans la tenue : complets ou cassés */
function ensembleCheck(pieces) {
  const ids = new Set(pieces.map(p => p.id)), res = { complete: [], broken: 0 };
  for (const ens of new Set(pieces.map(p => p.ensemble).filter(Boolean))) {
    const m = setMembers(ens);
    const core = m.filter(x => isTop(x.cat) || isBottom(x.cat));
    const worn = m.filter(x => ids.has(x.id));
    const coreOk = core.every(x => ids.has(x.id));
    const vestOrphan = worn.some(x => x.cat === "veste") && !core.filter(x => isBottom(x.cat)).every(x => ids.has(x.id));
    if (coreOk && !vestOrphan) res.complete.push({ ens, members: worn });
    else res.broken++;
  }
  return res;
}

function scoreOutfit(o, ctx) {
  const pieces = o.pieces; let sc = 0; const notes = [];
  const shoes = pieces.find(p => p.cat === "chaussures");
  const bottom = pieces.find(p => isBottom(p.cat));
  const veste = pieces.find(p => p.cat === "veste");

  // Superposition : la couche intérieure doit être neutre
  if (o.layered) {
    const inner = pieces.find(p => p.cat === "haut");
    if (!innerOk(inner)) return { score: -50, notes: [], theme: "clash" };
    if (inner.pattern && inner.pattern !== "uni") sc -= 3;
  }
  // Couleurs : une seule couleur forte, 2 familles de couleurs idéalement, 3 au maximum si l'accord tient
  const { vivid, fams, multi } = analyseColors(pieces);
  if (fams.size > 3) return { score: -50, notes: [], theme: "clash" };
  if (BAD_NEUTRALS.some(([a, b]) => fams.has(a) && fams.has(b))) return { score: -50, notes: [], theme: "clash" };
  if (fams.size === 3) {
    // 3 couleurs : seulement deux neutres + une couleur, ou trois neutres avec une vraie base (noir, blanc, gris, marine ou jean)
    const base = ["noir", "blanc", "gris", "bleu foncé", "bleu jean"];
    if (vivid.length > 1) return { score: -50, notes: [], theme: "clash" };
    if (!vivid.length && ![...fams].some(f => base.includes(f))) return { score: -50, notes: [], theme: "clash" };
  } else sc += 2.5;
  o.nColors = fams.size;
  let theme;
  if (multi.length > 1) return { score: -50, notes: [], theme: "clash" };
  if (multi.length === 1) {
    // Pièce multicolore : c'est la pièce forte, le reste est neutre ou reprend une de ses couleurs
    const m = multi[0];
    if (vivid.some(g => !g.pieces.has(m.id))) return { score: -50, notes: [], theme: "clash" };
    const echo = vivid.filter(g => g.n >= 2);
    sc += 3 + echo.length * 1.5; theme = "multi";
    notes.push(echo.length
      ? `${cap(m.name)} est la pièce forte, et ${echo.map(g => le(g.name)).join(" et ")} y fait écho ailleurs dans la tenue : c'est cohérent.`
      : `${cap(m.name)} est la pièce forte avec ses couleurs ; tout le reste reste neutre pour la laisser parler.`);
    o.multiName = m.name;
  } else if (vivid.length >= 2) return { score: -50, notes: [], theme: "clash" };
  else if (vivid.length === 0) {
    const ls = pieces.map(p => hsl(p.hex)[2]);
    if ([...fams].every(f => f === "noir")) { sc += 2.5; theme = "black"; notes.push("Total black : sobre, efficace, ça marche partout."); }
    else if (Math.max(...ls) - Math.min(...ls) < .15) { sc += 0.5; theme = "mono"; notes.push("Tout dans la même valeur : sobre, mais un peu plat."); }
    else { sc += 2.5; theme = "neutre"; notes.push("Uniquement des neutres avec un contraste clair/foncé : impossible de se tromper."); }
  } else {
    const v = vivid[0];
    const hero = pieces.find(p => v.pieces.has(p.id));
    if (v.n >= 2 && v.accentOf) { sc += 4.5; theme = "echo"; notes.push(`${cap(le(v.name))} reprend le détail ${v.name} de « ${v.accentOf.name} » : la tenue est pensée, pas assemblée au hasard.`); }
    else if (v.n >= 2) { sc += 3; theme = "ton"; notes.push(`Ton sur ton ${v.name} posé sur des neutres.`); }
    else { sc += 4; theme = "touche"; notes.push(`${fams.size === 2 ? "Un seul neutre" : "Deux neutres"} et une seule couleur forte, ${le(v.name)} (« ${hero.name} ») : c'est elle qui attire l'œil.`); }
  }
  if (theme !== "touche" && theme !== "black") notes.push(fams.size <= 2 ? "Deux couleurs seulement : propre et lisible." : "Trois couleurs, pas une de plus.");
  // Motifs : un seul à la fois
  const loud = pieces.filter(p => (p.pattern && p.pattern !== "uni") || multi.includes(p)).length;
  if (loud > 1) return { score: -50, notes: [], theme: "clash" };

  // Ensembles
  const ensb = ensembleCheck(pieces);
  if (ensb.broken) return { score: -50, notes: [], theme: "clash" };
  for (const e of ensb.complete) {
    sc += 6;
    const brand = e.members.find(m => m.brand)?.brand;
    notes.unshift(`Ensemble ${brand ? brand + " " : ""}porté complet : c'est la base de la tenue.`);
    o.ensembleName = brand || e.members[0].colorName;
    if (veste && !e.members.includes(veste)) {
      if (isNeutral(veste.hex)) sc += 1.5;
      if (Math.abs(hsl(veste.hex)[2] - hsl(e.members[0].hex)[2]) > .25) { sc += 1; notes.push(`La veste ${veste.colorName || ""} tranche avec l'ensemble et structure la silhouette.`); }
    }
  }
  // Chaussures : neutres, ou reprise de la couleur forte
  if (shoes) {
    if (isNeutral(shoes.hex)) sc += 1;
    else if (vivid[0]?.n >= 2) sc += 1.5;
    if (bottom) {
      if (bottom.style === "sport" && ["chic", "classique"].includes(shoes.style)) sc -= 7;
      if (["chic", "classique"].includes(bottom.style) && shoes.style === "sport") sc -= 4;
    }
  }

  // Style
  const st = pieces.map(p => p.style);
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) sc += clash(st[i], st[j]);
  if (new Set(st).size === 1) sc += 1.5;
  const occ = OCC[ctx.occ];
  sc += st.reduce((a, s) => a + (occ[s] ?? 0), 0) / st.length * 1.5;
  if (ctx.vibe) sc += st.reduce((a, s) => a + (s === ctx.vibe ? 1.5 : s === "casual" ? 0 : -0.8), 0);

  // Météo & saison
  const has = c => pieces.some(p => p.cat === c);
  const season = pieces.map(p => p.season);
  if (ctx.wx === "froid") {
    if (has("short")) sc -= 10;
    if (!has("pull") && !has("veste")) sc -= 5;
    if (has("veste")) sc += 2; if (o.layered) sc += 1.5;
    sc -= season.filter(s => s === "été").length * 2;
  } else if (ctx.wx === "chaud") {
    if (has("pull")) sc -= 3;
    if (has("veste")) sc -= 3;
    if (has("short") && !["travail", "fete"].includes(ctx.occ)) sc += 1;
    sc -= season.filter(s => s === "hiver").length * 3;
  } else if (ctx.wx === "pluie") {
    sc += has("veste") ? 3 : -3;
    if (has("short")) sc -= 3;
    sc -= season.filter(s => s === "été").length;
  } else {
    if (has("short")) sc -= 2;
    if (has("veste") || o.layered) sc += 1;
    sc -= season.filter(s => s === "hiver").length * 1.5;
  }
  if (has("short") && ["travail", "fete", "soiree"].includes(ctx.occ)) sc -= 6;

  return { score: sc, notes, theme };
}

function tipFor(o, ctx) {
  const p = o.pieces;
  const shoes = p.find(x => x.cat === "chaussures");
  if (o.ensembleName) return "Porte l'ensemble tel quel, sans le casser : ce sont la veste et les chaussures qui font la différence.";
  if (o.layered) { const inner = p.find(x => x.cat === "haut"); return `Le ${inner.name.toLowerCase()} reste discret sous le pull : seul le col dépasse, pour une superposition propre.`; }
  if (shoes && !isNeutral(shoes.hex)) return "Les chaussures portent la couleur : garde le reste sobre et le bas bien ajusté sur la cheville.";
  if (o.theme === "mono" || o.theme === "black") return "Mélange les matières (maille, denim, cuir) pour donner du relief.";
  const top = p.find(x => isTop(x.cat)), bot = p.find(x => isBottom(x.cat));
  if (top && bot && hsl(top.hex)[2] - hsl(bot.hex)[2] > .3) return "Haut clair et bas foncé : la silhouette paraît plus élancée.";
  if (ctx.occ === "travail") return "Rentre le haut dans le pantalon et ajoute une ceinture assortie aux chaussures.";
  if (ctx.occ === "soiree" || ctx.occ === "rdv") return "Un accessoire discret (montre, chaîne fine) suffit à finir la tenue.";
  if (p.some(x => x.cat === "veste")) return "Porte la veste ouverte pour laisser voir le haut.";
  return "Fais attention à la longueur du bas : il doit tomber juste sur la chaussure, sans plis.";
}
const TITLES = {
  neutre: ["Neutre efficace", "Valeur sûre", "Basique maîtrisé"],
  black: ["Total black"],
  multi: ["Pièce forte"],
  echo: c => [`Écho ${c}`, `Rappel ${c}`],
  mono: ["Monochrome"],
  touche: c => [`Touche ${de(c)}`, `Accent ${c}`],
  ton: c => [`Ton sur ton ${c}`, `Camaïeu ${c}`],
  clash: ["Audacieux"]
};
function titleFor(theme, o, i) {
  if (o.ensembleName) return "Ensemble " + o.ensembleName;
  const { vivid } = analyseColors(o.pieces);
  let t = TITLES[theme] || TITLES.neutre;
  if (typeof t === "function") t = t(vivid[0]?.name || "couleur");
  return t[i % t.length];
}

/* La pièce qui porte la tenue : celle qui a la couleur forte, sinon le haut visible */
function heroOf(o) {
  const { vivid, multi } = analyseColors(o.pieces);
  if (multi[0]) return multi[0].id;
  if (vivid[0]) return [...vivid[0].pieces][0];
  return (o.pieces.find(p => p.cat === "pull") || o.pieces.find(p => p.cat === "haut"))?.id;
}
function generate(ctx) {
  const by = c => items.filter(i => i.cat === c);
  const hauts = by("haut"), pulls = by("pull"), vestes = by("veste"), shoes = by("chaussures"), acc = by("accessoire");
  const bottoms = [...by("pantalon"), ...by("short")];
  const tops = [...hauts.map(h => [h]), ...pulls.map(p => [p])];
  if (ctx.wx !== "chaud") for (const h of hauts) for (const p of pulls) tops.push([h, p]);
  const vOpts = [null, ...vestes];
  let combos = [];
  for (const t of tops) for (const b of bottoms) for (const s of shoes) for (const v of vOpts) {
    combos.push({ pieces: [...t, b, s, ...(v ? [v] : [])], layered: t.length === 2 });
  }
  if (ctx.must) combos = combos.filter(c => c.pieces.some(p => p.id === ctx.must));
  if (ctx.must && !combos.length) {
    const m = items.find(i => i.id === ctx.must);
    if (m?.cat === "accessoire") combos = []; // traité plus bas
  }
  if (combos.length > 30000) combos = combos.sort(() => Math.random() - .5).slice(0, 30000);
  const scored = combos.map(c => { const r = scoreOutfit(c, ctx); return { ...c, ...r, rank: r.score + Math.random() * 1.6 }; });
  scored.sort((a, b) => b.rank - a.rank);
  const picked = [];
  for (const c of scored) {
    if (picked.length === 3) break;
    if (c.score < 3) break;   // en dessous, la tenue ne tient pas la route
    const core = c.pieces.filter(p => p.cat !== "veste").map(p => p.id);
    const tooClose = picked.some(p => {
      const pc = p.pieces.map(x => x.id);
      if (core.filter(id => pc.includes(id)).length >= core.length - 1) return true;
      return !ctx.must && heroOf(p) === heroOf(c);   // même pièce forte = même tenue, en gros
    });
    if (!tooClose) picked.push(c);
  }
  // Accessoire : on ajoute le plus cohérent s'il n'abîme pas l'accord
  const mustAcc = ctx.must && items.find(i => i.id === ctx.must && i.cat === "accessoire");
  for (const o of picked) {
    let best = null, bs = o.score - (mustAcc ? 99 : 0.01);
    for (const a of (mustAcc ? [mustAcc] : acc)) {
      const r = scoreOutfit({ ...o, pieces: [...o.pieces, a] }, ctx);
      if (r.score > bs) { bs = r.score; best = a; }
    }
    if (best) { o.pieces = [...o.pieces, best]; Object.assign(o, scoreOutfit(o, ctx)); }
  }
  return picked;
}

/* ---------- Affichage des tenues ---------- */
function renderOutfits(list, ctx, extra) {
  const out = $("outfits"); out.innerHTML = "";
  list.forEach((o, i) => {
    const c = document.createElement("article"); c.className = "outfit";
    const head = document.createElement("div"); head.className = "ohead";
    const h = document.createElement("h3"); h.textContent = o.title || titleFor(o.theme, o, i); head.appendChild(h);
    const pal = document.createElement("div"); pal.className = "palette";
    for (const x of outfitPalette(o.pieces)) { const s = document.createElement("i"); s.style.background = x; pal.appendChild(s); }
    head.appendChild(pal); c.appendChild(head);
    const ps = document.createElement("div"); ps.className = "pieces";
    for (const p of o.pieces) { const d = document.createElement("div"); d.className = "piece"; d.appendChild(phEl(p)); const s = document.createElement("span"); s.textContent = p.name; d.appendChild(s); ps.appendChild(d); }
    c.appendChild(ps);
    const w = document.createElement("p"); w.className = "why"; w.textContent = o.why || o.notes.join(" "); c.appendChild(w);
    const t = document.createElement("p"); t.className = "tip"; t.textContent = o.tip || tipFor(o, ctx); c.appendChild(t);
    out.appendChild(c);
  });
  if (extra) { const m = document.createElement("p"); m.className = "note"; m.textContent = extra; out.appendChild(m); }
}
function missingAdvice() {
  const n = c => items.filter(i => i.cat === c).length;
  const neutralShoes = items.some(i => i.cat === "chaussures" && isNeutral(i.hex));
  if (!neutralShoes && n("chaussures")) return "À ajouter en priorité : une paire de baskets blanches ou de chaussures noires, elles vont avec tout.";
  if (n("pantalon") < 2) return "À ajouter en priorité : un deuxième pantalon neutre (noir, beige ou jean brut) pour multiplier les tenues.";
  if (!n("veste")) return "À ajouter en priorité : une veste neutre pour les jours frais.";
  return "";
}

$("go").onclick = async () => {
  const st = $("oStatus"); st.classList.remove("err");
  const has = c => items.some(i => i.cat === c);
  if (!(has("haut") || has("pull")) || !(has("pantalon") || has("short")) || !has("chaussures")) {
    st.textContent = "Il faut au moins un haut, un bas et une paire de chaussures."; st.classList.add("err"); return;
  }
  const ctx = { occ: $("occ").value, wx: $("wx").value, vibe: $("vibe").value, must: $("must").value };
  const go = $("go"); go.disabled = true;
  if (getKey()) {
    st.innerHTML = '<span class="spin"></span> ' + aiLabel() + ' compose tes tenues…';
    try { await aiOutfits(ctx); st.textContent = ""; }
    catch (e) { st.textContent = "L'IA n'a pas répondu (" + e.message + "). Tenues calculées par le moteur intégré."; renderLocal(ctx); }
  } else { renderLocal(ctx); }
  go.disabled = false; go.textContent = "Proposer d'autres tenues";
};
function renderLocal(ctx) {
  const st = $("oStatus");
  const list = generate(ctx);
  if (!list.length) { $("outfits").innerHTML = ""; st.textContent = "Aucune tenue convaincante pour ce contexte avec ta garde-robe actuelle. " + missingAdvice(); st.classList.add("err"); return; }
  if (!st.textContent.startsWith("L'IA")) st.textContent = list.length < 3 ? "Ta garde-robe ne permet que " + list.length + " tenue(s) correcte(s) ici." : "";
  renderOutfits(list, ctx, missingAdvice());
}

/* ---------- IA Claude (optionnel, clé de l'utilisateur) ---------- */
const KEY = "kremasap.apikey";
function getKey() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
/* Fournisseur selon la clé : Google Gemini (gratuit, « AIza… ») ou Anthropic Claude (« sk-ant-… ») */
const isGemini = () => { const k = getKey(); return !!k && !k.startsWith("sk-ant-"); };
const aiLabel = () => isGemini() ? "Gemini" : "Claude";
const parseJson = text => { const m = (text || "").match(/\{[\s\S]*\}/); if (!m) throw new Error("réponse illisible"); return JSON.parse(m[0]); };
async function gemini(content, maxTokens) {
  const parts = (Array.isArray(content) ? content : [{ type: "text", text: content }]).map(c =>
    c.type === "image" ? { inline_data: { mime_type: c.source.media_type, data: c.source.data } } : { text: c.text });
  const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: Math.max(maxTokens, 2048), temperature: .4 } });
  let last;
  for (const model of ["gemini-flash-latest", "gemini-2.5-flash"]) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(getKey())}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (r.status === 404) { last = "modèle indisponible"; continue; }
    if (!r.ok) {
      let msg = ""; try { msg = (await r.json()).error?.message || ""; } catch { }
      if (r.status === 429) throw new Error("limite gratuite atteinte, réessaie plus tard");
      if (/api key|API_KEY|permission|PERMISSION/i.test(msg) || r.status === 403) throw new Error("clé invalide ou API non activée");
      throw new Error("erreur " + r.status + (msg ? " : " + msg.slice(0, 120) : ""));
    }
    const j = await r.json();
    return parseJson((j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join(""));
  }
  throw new Error(last || "aucun modèle");
}
async function claude(model, content, maxTokens = 1200) {
  if (isGemini()) return gemini(content, maxTokens);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-api-key": getKey(), "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] })
  });
  if (!r.ok) throw new Error(r.status === 401 ? "clé invalide" : r.status === 429 ? "trop de demandes" : "erreur " + r.status);
  const j = await r.json();
  return parseJson((j.content || []).map(c => c.text || "").join(""));
}
const blobToB64 = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(",")[1]); f.onerror = rej; f.readAsDataURL(b); });

async function aiRead(blob) {
  const data = await blobToB64(blob);
  return claude("claude-haiku-5-5", [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
      { type: "text", text: `Tu es styliste. La photo montre UN vêtement ou accessoire. Réponds UNIQUEMENT en JSON:
{"categorie": une valeur parmi ${JSON.stringify(CATS.map(c => c[0]))}, "nom": nom court en français (2 à 4 mots), "couleurs": [{"nom": couleur en français, "hex": "#rrggbb", "part": proportion de 0 à 1}] (1 à 3 couleurs de la pièce, la principale en premier, ignorer le fond; ne compter une couleur secondaire que si elle est bien visible: rayures, manches, logo imposant, colorblock), "style": une valeur parmi ${JSON.stringify(STYLES)}, "saison": une valeur parmi ${JSON.stringify(SEASONS)}, "marque": marque si un logo ou une étiquette est lisible sinon "", "motif": "uni" ou "logo" (gros logo/imprimé) ou "motif" (rayures, carreaux...)}. Pour la marque, regarde bien les logos même sans texte (virgule Nike, Jumpman Jordan, trois bandes Adidas, crocodile Lacoste, joueur de polo Ralph Lauren…).` }
  ], 300);
}
const aiColors = r => (Array.isArray(r.couleurs) ? r.couleurs : []).filter(c => /^#[0-9a-f]{6}$/i.test(c?.hex || "")).slice(0, 3);
async function aiAnalyze(blob) {
  $("aiStatus").innerHTML = '<span class="spin"></span> ' + aiLabel() + ' analyse la pièce…';
  try {
    const r = await aiRead(blob);
    if ($("sheet").hidden) return;
    if (CATS.some(c => c[0] === r.categorie)) $("fCat").value = r.categorie;
    if (STYLES.includes(r.style)) $("fStyle").value = r.style;
    if (SEASONS.includes(r.saison)) $("fSeason").value = r.saison;
    if (r.nom && !$("fName").value) $("fName").value = String(r.nom).slice(0, 60);
    const cs = aiColors(r);
    if (cs.length) {
      sheetColors = cs.map(c => ({ hex: c.hex, name: String(c.nom || colorName(c.hex)).slice(0, 30), share: Number(c.part) > 0 ? Number(c.part) : 1 / cs.length, manual: !!c.nom }));
      normShares(); renderColors();
    }
    if (r.marque && !$("fBrand").value) $("fBrand").value = String(r.marque).slice(0, 30);
    if (["uni", "logo", "motif"].includes(r.motif)) $("fPattern").value = r.motif;
    fillSetOptions(true);
    $("aiStatus").textContent = "Fiche remplie par " + aiLabel() + ". Corrige si besoin.";
  } catch (e) {
    $("aiStatus").textContent = aiLabel() + " n'a pas pu analyser la photo (" + e.message + "). Couleur détectée automatiquement.";
  }
}
/* ---------- Redétection (couleurs + marque) ---------- */
const BRANDS = ["Nike", "Jordan", "Adidas", "Puma", "New Balance", "Asics", "Reebok", "Fila", "Kappa", "Champion", "Ellesse", "Le Coq Sportif", "Sergio Tacchini", "Lacoste", "Ralph Lauren", "Tommy Hilfiger", "Calvin Klein", "Hugo Boss", "Boss", "Armani", "EA7", "Levi's", "Diesel", "Guess", "Zara", "H&M", "Uniqlo", "Pull&Bear", "Bershka", "Jack & Jones", "The North Face", "Stone Island", "Carhartt", "Napapijri", "Moncler", "Timberland", "Vans", "Converse", "Supreme", "Off-White", "Palm Angels", "Trapstar", "Corteiz", "Gucci", "Louis Vuitton", "Dior", "Balenciaga", "Prada", "Versace", "Burberry", "Kenzo", "Halo"];
/* Marque déjà écrite dans le nom de la pièce (« Sweat Jordan » → Jordan) */
function brandFromName(name) {
  const n = " " + (name || "").toLowerCase().replace(/[^a-z0-9&'éè]+/g, " ") + " ";
  return BRANDS.find(b => n.includes(" " + b.toLowerCase().replace(/[^a-z0-9&'éè]+/g, " ") + " ")) || "";
}
async function photoBlob(it) {
  if (it.photo instanceof Blob) return it.photo;
  if (it.photo) return new Blob([it.photo], { type: "image/jpeg" });
  return null;
}
/* Recalcule les couleurs depuis la photo et retrouve la marque. Ne touche ni au nom, ni à la catégorie, ni au style. */
async function redetect(it, useAI) {
  const blob = await photoBlob(it); if (!blob) throw new Error("pas de photo");
  const url = URL.createObjectURL(blob);
  let colors;
  try { colors = extractPalette(await loadImage(url)); } finally { URL.revokeObjectURL(url); }
  let brand = it.brand || brandFromName(it.name), pattern = it.pattern || "uni";
  if (useAI) {
    try {
      const r = await aiRead(blob);
      const cs = aiColors(r);
      if (cs.length) colors = cs.map(c => ({ hex: c.hex, name: String(c.nom || colorName(c.hex)).slice(0, 30), share: Number(c.part) > 0 ? Number(c.part) : 1 / cs.length }));
      if (!brand && r.marque) brand = String(r.marque).slice(0, 30);
      if (["uni", "logo", "motif"].includes(r.motif)) pattern = r.motif;
    } catch { }
  }
  const t = colors.reduce((a, c) => a + c.share, 0) || 1;
  colors = colors.map(c => ({ ...c, share: Math.round(c.share / t * 100) / 100 }));
  return { colors, brand, pattern };
}
/* Dans la fiche : redétecte sans enregistrer, on garde la main avant « Ranger » */
$("redetect").onclick = async () => {
  if (!editing) return;
  const st = $("aiStatus"), b = $("redetect"); b.disabled = true;
  st.innerHTML = '<span class="spin"></span> Nouvelle détection…';
  try {
    const r = await redetect({ ...editing, name: $("fName").value }, !!getKey());
    if ($("sheet").hidden) return;
    sheetColors = r.colors.map(c => ({ ...c })); renderColors();
    if (!$("fBrand").value && r.brand) $("fBrand").value = r.brand;
    $("fPattern").value = r.pattern;
    fillSetOptions(true);
    st.textContent = "Couleurs" + (r.brand ? " et marque" : "") + " mises à jour. Appuie sur « Ranger » pour garder.";
  } catch (e) { st.textContent = "Redétection impossible (" + e.message + ")."; }
  b.disabled = false;
};
/* Toute la garde-robe d'un coup */
$("redetectAll").onclick = async () => {
  const st = $("redetectStatus"), b = $("redetectAll"); st.className = "status";
  if (!items.length) { st.textContent = "Ta garde-robe est vide."; return; }
  const useAI = !!getKey(); b.disabled = true;
  let ok = 0, brands = 0, fail = 0;
  for (const [i, it] of items.entries()) {
    st.innerHTML = `<span class="spin"></span> ${i + 1} / ${items.length} : ${it.name}`;
    try {
      const r = await redetect(it, useAI);
      if (!it.brand && r.brand) brands++;
      const upd = { ...it, colors: r.colors, hex: r.colors[0].hex, colorName: r.colors[0].name, brand: r.brand, pattern: r.pattern };
      await saveItem(upd); ok++;
    } catch { fail++; }
    if (useAI && isGemini() && i < items.length - 1) await new Promise(r => setTimeout(r, 6500));   // limite gratuite : ~10 demandes/minute
  }
  render();
  st.textContent = `${ok} pièce(s) mises à jour, ${brands} marque(s) ajoutée(s)` + (fail ? `, ${fail} sans photo lisible` : "") + ".";
  st.className = "status okc"; b.disabled = false;
};

async function aiOutfits(ctx) {
  const inv = items.map(i => ({ id: i.id, categorie: i.cat, nom: i.name, marque: i.brand || undefined, couleurs: pieceColors(i).map(c => `${c.name} ${c.hex} ${Math.round(c.share * 100)}%`), style: i.style, saison: i.season, motif: i.pattern || "uni", ensemble: i.ensemble || undefined }));
  const occName = $("occ").selectedOptions[0].textContent, wxName = $("wx").selectedOptions[0].textContent;
  const r = await claude("claude-sonnet-5-5", `Tu es un styliste exigeant. Compose 3 tenues DIFFÉRENTES uniquement avec ces pièces (JSON):
${JSON.stringify(inv)}
Contexte: occasion = ${occName}; météo = ${wxName}; style voulu = ${ctx.vibe || "au choix"}.${ctx.must ? ` La pièce d'id "${ctx.must}" doit figurer dans chaque tenue.` : ""}
Règles STRICTES (codes vestimentaires classiques): 1 haut (haut ou pull), 1 bas, 1 paire de chaussures, veste si la météo le demande, accessoire si utile. UNE SEULE couleur forte par tenue (une pièce multicolore compte comme LA pièce forte : les autres pièces sont neutres ou reprennent exactement une de ses couleurs), le reste en neutres (noir, blanc, gris, beige, camel, marine, jean, kaki, marron); jamais deux couleurs vives ensemble. Compte TOUTES les couleurs visibles de la tenue, neutres et chaussures compris : 2 couleurs idéalement, 3 au grand maximum et seulement si l'accord est classique (deux neutres + une couleur, ou trois neutres dont noir, blanc, gris, marine ou jean). Jamais noir + marron, noir + marine, camel + kaki. Appelle chaque couleur par son vrai nom (corail n'est pas orange, bordeaux n'est pas rouge). En superposition, la couche intérieure est TOUJOURS neutre et unie. Un seul motif ou gros logo par tenue. Les pièces qui partagent la même valeur "ensemble" se portent TOUJOURS ensemble (ne jamais casser un ensemble); choisis alors la veste et les chaussures qui vont avec. Pas de noir avec des chaussures marron. Pas de chaussures de ville avec un jogging. Cohérence de style et de saison. Mieux vaut moins de tenues qu'une tenue ratée.
Réponds UNIQUEMENT en JSON: {"tenues":[{"titre":"court","pieces":["id"],"pourquoi":"1-2 phrases","astuce":"un conseil concret"}],"manque":"pièce qui manque le plus, ou chaîne vide"}`, 1500);
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const list = (r.tenues || []).map(t => ({ title: t.titre, why: t.pourquoi, tip: t.astuce, pieces: (t.pieces || []).filter(id => byId[id]).map(id => byId[id]) })).filter(t => t.pieces.length >= 2);
  if (!list.length) throw new Error("aucune tenue");
  renderOutfits(list, ctx, r.manque ? "À ajouter en priorité : " + r.manque : "");
}

/* ---------- Réglages : clé + sauvegarde ---------- */
$("openSettings").onclick = () => {
  $("apiKey").value = ""; $("keyStatus").textContent = getKey() ? "Une clé est enregistrée sur cet appareil." : "Aucune clé : moteur intégré utilisé.";
  $("backupStatus").textContent = ""; $("settings").hidden = false;
};
$("closeSettings").onclick = () => { $("settings").hidden = true; };
$("settings").addEventListener("click", e => { if (e.target === $("settings")) $("settings").hidden = true; });
$("saveKey").onclick = () => {
  // Nettoie le copier-coller : espaces, retours à la ligne, guillemets, caractères invisibles
  const k = $("apiKey").value.replace(/[\s"'«»“”‘’\u200B-\u200D\uFEFF]/g, "");
  if (k.length < 20) { $("keyStatus").textContent = "La clé semble incomplète : recopie-la en entier depuis Google AI Studio."; $("keyStatus").className = "status err"; return; }
  try { localStorage.setItem(KEY, k); $("apiKey").value = ""; }
  catch { $("keyStatus").textContent = "Impossible d'enregistrer la clé sur ce navigateur."; $("keyStatus").className = "status err"; return; }
  // Test immédiat de la clé
  const ks = $("keyStatus"); ks.className = "status"; ks.innerHTML = '<span class="spin"></span> Vérification de la clé ' + aiLabel() + '…';
  claude("claude-haiku-5-5", 'Réponds uniquement {"ok":true}', 50)
    .then(() => { ks.textContent = "Clé " + aiLabel() + " enregistrée et fonctionnelle."; ks.className = "status okc"; })
    .catch(e => { ks.textContent = "Clé enregistrée, mais " + aiLabel() + " la refuse (" + e.message + "). Vérifie-la sur Google AI Studio."; ks.className = "status err"; });
};
$("clearKey").onclick = () => { try { localStorage.removeItem(KEY); } catch { } $("keyStatus").textContent = "Clé retirée."; $("keyStatus").className = "status"; };

$("exportBtn").onclick = async () => {
  const bs = $("backupStatus"); bs.className = "status"; bs.innerHTML = '<span class="spin"></span> Préparation…';
  try {
    const out = [];
    for (const it of items) {
      const { photo, ...rest } = it;
      out.push({ ...rest, photo: photo ? "data:image/jpeg;base64," + await blobToB64(photo) : null });
    }
    const blob = new Blob([JSON.stringify({ app: "kremasap", version: 1, exported: new Date().toISOString(), items: out })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kremasap-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    bs.textContent = items.length + " pièces exportées."; bs.className = "status okc";
  } catch { bs.textContent = "L'export a échoué."; bs.className = "status err"; }
};
$("importBtn").onclick = () => { $("importFile").value = ""; $("importFile").click(); };
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const bs = $("backupStatus"); bs.className = "status";
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== "kremasap" || !Array.isArray(j.items)) throw new Error();
    let n = 0;
    for (const raw of j.items) {
      if (!raw.id || items.some(i => i.id === raw.id)) continue;
      const photo = raw.photo ? await (await fetch(raw.photo)).blob() : null;
      const it = { ...raw, photo };
      await dbPut(it); items.push(it); n++;
    }
    items.sort((a, b) => b.created - a.created); render();
    bs.textContent = n + " pièce(s) importée(s)."; bs.className = "status okc";
  } catch { bs.textContent = "Ce fichier n'est pas une sauvegarde Kremasap valide."; bs.className = "status err"; }
};

/* ---------- Démarrage ---------- */
(async () => {
  try {
    items = (await dbAll()).sort((a, b) => b.created - a.created);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
  } catch {
    $("grid").innerHTML = '<div class="empty err">Ce navigateur bloque le stockage local (navigation privée ?). Ouvre Kremasap dans une fenêtre normale.</div>';
    return;
  }
  const renamed = items.filter(renameAuto);
  render();
  for (const it of renamed) { try { await dbPut(it); } catch { } }
  // Convertit en arrière-plan les anciennes fiches au format compatible iPhone
  for (const it of items.filter(i => legacy.has(i.id))) { try { await dbPut(it); legacy.delete(it.id); } catch { } }
})();
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
