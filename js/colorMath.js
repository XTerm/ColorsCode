/**
 * colorMath.js
 * Conversion RGB -> Lab et calcul de distance perceptuelle CIEDE2000.
 * Une distance RGB brute ne correspond pas à la perception humaine des
 * couleurs (deux couleurs "proches" en RGB peuvent sembler très différentes
 * à l'œil, et inversement). CIEDE2000 est la formule de référence pour
 * comparer des couleurs comme un humain le ferait.
 */

const ColorMath = (() => {

  // sRGB -> XYZ (D65) -> Lab
  function srgbToLinear(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function rgbToXyz([r, g, b]) {
    const rl = srgbToLinear(r);
    const gl = srgbToLinear(g);
    const bl = srgbToLinear(b);
    // Matrice sRGB -> XYZ (D65)
    const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
    const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
    const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
    return [x * 100, y * 100, z * 100];
  }

  function xyzToLab([x, y, z]) {
    // Illuminant D65 de référence
    const refX = 95.047, refY = 100.0, refZ = 108.883;
    let xr = x / refX, yr = y / refY, zr = z / refZ;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116);
    const fx = f(xr), fy = f(yr), fz = f(zr);
    const L = (116 * fy) - 16;
    const a = 500 * (fx - fy);
    const bLab = 200 * (fy - fz);
    return [L, a, bLab];
  }

  function rgbToLab(rgb) {
    return xyzToLab(rgbToXyz(rgb));
  }

  function deg2rad(deg) { return deg * (Math.PI / 180); }
  function rad2deg(rad) { return rad * (180 / Math.PI); }

  /**
   * Distance perceptuelle CIEDE2000 entre deux couleurs Lab.
   * Référence : Sharma, Wu, Dalal (2005).
   */
  function deltaE00(lab1, lab2) {
    const [L1, a1, b1] = lab1;
    const [L2, a2, b2] = lab2;

    const avgL = (L1 + L2) / 2;
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const avgC = (C1 + C2) / 2;

    const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));

    const a1p = a1 * (1 + G);
    const a2p = a2 * (1 + G);

    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);
    const avgCp = (C1p + C2p) / 2;

    let h1p = Math.atan2(b1, a1p);
    h1p = h1p >= 0 ? rad2deg(h1p) : rad2deg(h1p) + 360;
    let h2p = Math.atan2(b2, a2p);
    h2p = h2p >= 0 ? rad2deg(h2p) : rad2deg(h2p) + 360;

    let deltHp;
    if (C1p * C2p === 0) deltHp = 0;
    else if (Math.abs(h2p - h1p) <= 180) deltHp = h2p - h1p;
    else if (h2p - h1p > 180) deltHp = (h2p - h1p) - 360;
    else deltHp = (h2p - h1p) + 360;

    const deltaLp = L2 - L1;
    const deltaCp = C2p - C1p;
    const deltaHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(deltHp) / 2);

    let avgHp;
    if (C1p * C2p === 0) avgHp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) avgHp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) avgHp = (h1p + h2p + 360) / 2;
    else avgHp = (h1p + h2p - 360) / 2;

    const T = 1 - 0.17 * Math.cos(deg2rad(avgHp - 30))
                + 0.24 * Math.cos(deg2rad(2 * avgHp))
                + 0.32 * Math.cos(deg2rad(3 * avgHp + 6))
                - 0.20 * Math.cos(deg2rad(4 * avgHp - 63));

    const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));

    const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
    const Sl = 1 + ((0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2)));
    const Sc = 1 + 0.045 * avgCp;
    const Sh = 1 + 0.015 * avgCp * T;
    const Rt = -Math.sin(deg2rad(2 * deltaTheta)) * Rc;

    const kL = 1, kC = 1, kH = 1;

    const dE = Math.sqrt(
      Math.pow(deltaLp / (kL * Sl), 2) +
      Math.pow(deltaCp / (kC * Sc), 2) +
      Math.pow(deltaHp / (kH * Sh), 2) +
      Rt * (deltaCp / (kC * Sc)) * (deltaHp / (kH * Sh))
    );

    return dE;
  }

  /** Distance perceptuelle directement entre deux couleurs RGB. */
  function rgbDistance(rgb1, rgb2) {
    return deltaE00(rgbToLab(rgb1), rgbToLab(rgb2));
  }

  /**
   * Classe tous les feutres d'un jeu par proximité avec une couleur cible.
   * @returns {Array<{feutre: object, distance: number}>} trié du plus proche au plus loin
   */
  function rankAll(targetRgb, feutres) {
    const targetLab = rgbToLab(targetRgb);
    const scored = feutres.map(f => ({
      feutre: f,
      distance: deltaE00(targetLab, rgbToLab(f.rgb))
    }));
    scored.sort((a, b) => a.distance - b.distance);
    return scored;
  }

  /**
   * Trouve le feutre le plus proche d'une couleur cible dans une liste.
   * @param {number[]} targetRgb - [r,g,b]
   * @param {Array<{ref:string, rgb:number[]}>} feutres
   * @returns {{feutre: object, distance: number, alternatives: Array}}
   */
  function findClosest(targetRgb, feutres) {
    const scored = rankAll(targetRgb, feutres);
    return {
      feutre: scored[0].feutre,
      distance: scored[0].distance,
      alternatives: scored.slice(1, 4) // 3 alternatives suivantes
    };
  }

  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  return { rgbToLab, deltaE00, rgbDistance, findClosest, rankAll, rgbToHex };
})();
