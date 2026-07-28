/**
 * app.js — logique principale de ColorsCode
 */

const App = (() => {

  // ---- État en mémoire du scan en cours ----
  let currentImage = null;   // HTMLImageElement
  let originalImageData = null; // ImageData brute (jamais modifiée), source de l'échantillonnage
  // Chaque point : {numero, x, y, rawRgb, match:{feutre,distance}, wasAlternative,
  //                 conflictRank, ranked:[...], manualOverride:bool}
  let currentPoints = [];
  let nextNumero = 1;
  let whiteBalance = [1, 1, 1]; // gains R,G,B issus de l'échantillon blanc (dominante)
  let wbLuminosite = 0;         // réglage fin manuel, -50..50
  let wbTemperature = 0;        // réglage fin manuel, -50..50 (négatif=froid, positif=chaud)
  let calibrating = false;      // true = le prochain tap sert à étalonner, pas à ajouter une pastille

  // ---- Références DOM ----
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const views = {
    scanner: $('#view-scanner'),
    feutres: $('#view-feutres'),
    historique: $('#view-historique'),
  };
  const navButtons = $$('.nav-btn');

  const fileInputCamera = $('#file-input-camera');
  const fileInputGallery = $('#file-input-gallery');
  const canvas = $('#capture-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const emptyState = $('#scanner-empty');
  const canvasWrap = $('#canvas-wrap');
  const canvasScroll = $('.canvas-scroll');
  const numeroPopup = $('#numero-popup');
  const numeroPopupInput = $('#numero-popup-input');
  const numeroPopupOk = $('#numero-popup-ok');
  const resultsList = $('#results-list');
  const resultsSection = $('#results-section');
  const setSelect = $('#active-set-select');
  const setWarning = $('#set-warning');
  const btnUndo = $('#btn-undo');
  const btnReset = $('#btn-reset');
  const btnSaveScan = $('#btn-save-scan');
  const btnCalibrate = $('#btn-calibrate');
  const calibrationStatus = $('#calibration-status');
  const fineTunePanel = $('#fine-tune-panel');
  const sliderLumin = $('#slider-luminosite');
  const sliderTemp = $('#slider-temperature');
  const btnResetFineTune = $('#btn-reset-finetune');

  const setsList = $('#sets-list');
  const historyList = $('#history-list');

  // ==================================================
  // Navigation
  // ==================================================
  function switchView(name) {
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle('active', key === name);
    });
    navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === name);
    });
    if (name === 'feutres') renderSets();
    if (name === 'historique') renderHistory();
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // ==================================================
  // Jeux de feutres — chargement / bibliothèque
  // ==================================================
  const BUNDLED_SETS = ['data/guangna-240.json', 'data/languo-126.json'];

  async function ensureDefaultSet() {
    for (const path of BUNDLED_SETS) {
      try {
        const res = await fetch(path);
        const bundled = await res.json();
        const existing = DB.getSet(bundled.id);
        // Met à jour un jeu intégré si absent ou si une nouvelle version est disponible
        // (ex : passage du chart digital du fabricant aux couleurs réelles mesurées à
        // partir d'un nuancier physiquement colorié). Les jeux créés par
        // l'utilisateur ne sont jamais touchés.
        if (!existing || existing.version !== bundled.version) {
          DB.saveSet(bundled);
          if (existing) toast(`Jeu "${bundled.nom}" mis à jour.`);
        }
      } catch (e) {
        console.error('Impossible de charger/mettre à jour', path, e);
      }
    }
    if (!DB.getActiveSetId()) {
      const sets = DB.getSets();
      if (sets.length) DB.setActiveSetId(sets[0].id);
    }
  }

  function refreshSetSelect() {
    const sets = DB.getSets();
    const activeId = DB.getActiveSetId();
    setSelect.innerHTML = '';
    if (sets.length === 0) {
      setSelect.innerHTML = '<option value="">Aucun jeu disponible</option>';
      setWarning.hidden = false;
      return;
    }
    setWarning.hidden = true;
    sets.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.nom} (${s.feutres.length})`;
      if (s.id === activeId) opt.selected = true;
      setSelect.appendChild(opt);
    });
  }

  setSelect.addEventListener('change', () => {
    DB.setActiveSetId(setSelect.value);
  });

  function renderSets() {
    const sets = DB.getSets();
    setsList.innerHTML = '';
    if (sets.length === 0) {
      setsList.innerHTML = '<p class="muted">Aucun jeu de feutres pour l’instant.</p>';
      return;
    }
    sets.forEach(set => {
      const card = document.createElement('div');
      card.className = 'set-card';

      const header = document.createElement('div');
      header.className = 'set-card-header';
      const isActive = set.id === DB.getActiveSetId();
      header.innerHTML = `
        <div>
          <h3>${escapeHtml(set.nom)}</h3>
          <span class="muted small">${set.feutres.length} feutres${isActive ? ' · jeu actif' : ''}</span>
        </div>
        <button class="icon-btn danger" data-action="delete" title="Supprimer ce jeu">✕</button>
      `;
      card.appendChild(header);

      const swatches = document.createElement('div');
      swatches.className = 'swatch-grid';
      set.feutres.slice(0, 60).forEach(f => {
        const hex = document.createElement('div');
        hex.className = 'hex-chip';
        hex.style.background = ColorMath.rgbToHex(f.rgb);
        hex.title = f.ref;
        swatches.appendChild(hex);
      });
      if (set.feutres.length > 60) {
        const more = document.createElement('span');
        more.className = 'muted small';
        more.textContent = `+ ${set.feutres.length - 60} autres…`;
        swatches.appendChild(more);
      }
      card.appendChild(swatches);

      header.querySelector('[data-action="delete"]').addEventListener('click', () => {
        if (confirm(`Supprimer le jeu "${set.nom}" ?`)) {
          vibrate();
          DB.deleteSet(set.id);
          renderSets();
          refreshSetSelect();
        }
      });

      setsList.appendChild(card);
    });
  }

  // Import d'un jeu personnalisé au format JSON
  $('#import-set-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.id || !Array.isArray(data.feutres)) {
        throw new Error('Format invalide');
      }
      DB.saveSet(data);
      DB.setActiveSetId(data.id);
      renderSets();
      refreshSetSelect();
      toast(`Jeu "${data.nom}" importé.`);
    } catch (err) {
      alert('Fichier JSON invalide. Attendu : { "id", "nom", "feutres": [{"ref","rgb"}, ...] }');
    }
    e.target.value = '';
  });

  // Création manuelle d'un jeu vide, à compléter feutre par feutre
  $('#btn-new-set').addEventListener('click', async () => {
    const result = await askInput('Nouveau jeu de feutres', [
      { id: 'nom', label: 'Nom du jeu', placeholder: 'ex : Staedtler 48' }
    ]);
    if (!result || !result.nom) return;
    const set = {
      id: 'custom-' + DB.uid(),
      nom: result.nom,
      source: 'Créé manuellement',
      feutres: []
    };
    DB.saveSet(set);
    DB.setActiveSetId(set.id);
    openSetEditor(set.id);
    renderSets();
    refreshSetSelect();
  });

  let editorEditingIndex = null; // index en cours d'édition dans le jeu ouvert, ou null
  let editorSearchTerm = '';

  function openSetEditor(setId) {
    const set = DB.getSet(setId);
    if (!set) return;
    $('#editor-set-name').textContent = set.nom;
    editorEditingIndex = null;
    editorSearchTerm = '';
    $('#editor-search').value = '';
    exitEditMode();
    renderEditorList(set);
    $('#set-editor-dialog').showModal();
  }

  $('#editor-search').addEventListener('input', () => {
    editorSearchTerm = $('#editor-search').value.trim().toLowerCase();
    const set = DB.getSet(DB.getActiveSetId());
    if (set) renderEditorList(set);
  });

  function renderEditorList(set) {
    const list = $('#editor-feutres-list');
    list.innerHTML = '';
    const term = editorSearchTerm;
    set.feutres.forEach((f, i) => {
      if (term && !f.ref.toLowerCase().includes(term)) return;
      const row = document.createElement('div');
      row.className = 'editor-row' + (i === editorEditingIndex ? ' editing' : '');
      row.innerHTML = `
        <span class="hex-chip small" style="background:${ColorMath.rgbToHex(f.rgb)}"></span>
        <span class="mono editor-row-ref">${escapeHtml(f.ref)}</span>
        <button class="icon-btn danger" data-i="${i}" title="Supprimer">✕</button>
      `;
      row.querySelector('.editor-row-ref').addEventListener('click', () => enterEditMode(set, i));
      row.querySelector('.hex-chip').addEventListener('click', () => enterEditMode(set, i));
      row.querySelector('button').addEventListener('click', (ev) => {
        ev.stopPropagation();
        set.feutres.splice(i, 1);
        DB.saveSet(set);
        if (editorEditingIndex === i) exitEditMode();
        renderEditorList(set);
      });
      list.appendChild(row);
    });
    if (list.children.length === 0) {
      list.innerHTML = `<p class="muted small">Aucun résultat${term ? ` pour "${escapeHtml(term)}"` : ''}.</p>`;
    }
  }

  function enterEditMode(set, index) {
    const f = set.feutres[index];
    editorEditingIndex = index;
    $('#editor-ref-input').value = f.ref;
    $('#editor-color-input').value = ColorMath.rgbToHex(f.rgb);
    $('#editor-add-feutre').textContent = 'Enregistrer';
    $('#editor-cancel-edit').hidden = false;
    $('#editor-ref-input').focus();
    renderEditorList(set);
  }

  function exitEditMode() {
    editorEditingIndex = null;
    $('#editor-ref-input').value = '';
    $('#editor-color-input').value = '#e4543f';
    $('#editor-add-feutre').textContent = 'Ajouter';
    $('#editor-cancel-edit').hidden = true;
  }

  $('#editor-cancel-edit').addEventListener('click', () => {
    const set = DB.getSet(DB.getActiveSetId());
    exitEditMode();
    if (set) renderEditorList(set);
  });

  $('#editor-add-feutre').addEventListener('click', () => {
    const setId = DB.getActiveSetId();
    const set = DB.getSet(setId);
    if (!set) return;
    const ref = $('#editor-ref-input').value.trim();
    const color = $('#editor-color-input').value; // #rrggbb
    if (!ref) { alert('Indique une référence.'); return; }
    const rgb = hexToRgb(color);

    if (editorEditingIndex !== null) {
      set.feutres[editorEditingIndex] = { ref, rgb };
      toast(`Feutre "${ref}" modifié.`);
    } else {
      set.feutres.push({ ref, rgb });
    }
    DB.saveSet(set);
    exitEditMode();
    renderEditorList(set);
  });

  $('#editor-close').addEventListener('click', () => {
    exitEditMode();
    $('#set-editor-dialog').close();
    renderSets();
    refreshSetSelect();
  });

  $('#btn-edit-active-set').addEventListener('click', () => {
    const id = DB.getActiveSetId();
    if (!id) { alert('Aucun jeu actif à modifier.'); return; }
    openSetEditor(id);
  });

  // ==================================================
  // Scanner — capture + sélection des pastilles
  // ==================================================
  $('#btn-take-photo').addEventListener('click', () => fileInputCamera.click());
  $('#btn-choose-file').addEventListener('click', () => fileInputGallery.click());

  fileInputCamera.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadImageFile(file);
    e.target.value = '';
  });

  fileInputGallery.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadImageFile(file);
    e.target.value = '';
  });

  function loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        currentImage = img;
        drawImageToCanvas(img);
        originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resetPoints();
        updateCalibrationStatus();
        emptyState.hidden = true;
        canvasWrap.hidden = false;
        resultsSection.hidden = false;
        renderCanvas();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function drawImageToCanvas(img) {
    // Limite la largeur pour rester fluide sur mobile, garde le ratio
    const maxW = 1000;
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  function resetPoints() {
    currentPoints = [];
    nextNumero = 1;
    whiteBalance = [1, 1, 1];
    wbLuminosite = 0;
    wbTemperature = 0;
    calibrating = false;
    sliderLumin.value = 0;
    sliderTemp.value = 0;
    fineTunePanel.hidden = true;
    updateCalibrationStatus();
    renderResults();
  }

  btnReset.addEventListener('click', () => {
    if (currentPoints.length && !confirm('Recommencer ce scan depuis le début ?')) return;
    currentImage = null;
    emptyState.hidden = false;
    canvasWrap.hidden = true;
    resultsSection.hidden = true;
    resetPoints();
  });

  btnUndo.addEventListener('click', () => {
    currentPoints.pop();
    recomputeAllMatches();
    renderCanvas();
    renderResults();
  });

  btnCalibrate.addEventListener('click', () => {
    calibrating = true;
    calibrationStatus.textContent = 'Touche une zone blanche du fond de la page…';
    calibrationStatus.classList.add('active');
  });

  function updateCalibrationStatus() {
    const isCalibrated = whiteBalance.some(g => Math.abs(g - 1) > 0.01);
    calibrationStatus.classList.remove('active');
    calibrationStatus.textContent = isCalibrated
      ? '✓ Couleurs étalonnées sur cette photo'
      : 'Pas encore étalonné';
  }

  canvas.addEventListener('click', async (e) => {
    const activeSet = DB.getSet(DB.getActiveSetId());
    if (!activeSet || activeSet.feutres.length === 0) {
      alert('Choisis d’abord un jeu de feutres actif (onglet Feutres).');
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    const rawRgb = sampleColor(x, y);

    if (calibrating) {
      vibrate();
      calibrateFromSample(rawRgb);
      calibrating = false;
      fineTunePanel.hidden = false;
      updateCalibrationStatus();
      recomputeAllMatches();
      renderCanvas();
      renderResults();
      toast('Étalonnage appliqué. Ajuste finement si besoin.');
      return;
    }

    vibrate();
    const numero = await askNumeroAt(e.clientX, e.clientY, nextNumero);
    if (numero === null) return; // annulé

    currentPoints.push({ numero, x, y, rawRgb });
    nextNumero = (parseInt(numero, 10) || nextNumero) + 1;

    recomputeAllMatches();
    renderCanvas();
    renderResults();
  });

  /**
   * Corrige une dominante colorée à partir d'un point censé être neutre
   * (le fond de la page). Le gain ne corrige QUE le déséquilibre entre
   * canaux R/G/B (la dominante), pas l'exposition globale : viser un
   * blanc "parfait" (ex: 250/255) quel que soit le niveau de lumière
   * capté boostait artificiellement toute la palette vers le clair,
   * écrasant les nuances. Le gain reste donc proche de 1.0.
   */
  function calibrateFromSample(rawRgb) {
    const avg = (rawRgb[0] + rawRgb[1] + rawRgb[2]) / 3;
    whiteBalance = rawRgb.map(c => c > 5 ? Math.max(0.75, Math.min(1.35, avg / c)) : 1);
  }

  function applyWhiteBalance(rawRgb) {
    // Combine le gain auto (dominante) avec les réglages fins manuels
    const luminFactor = 1 + wbLuminosite / 100;         // 0.5x .. 1.5x
    const tempFactor = [                                  // décale chaud/froid sur R et B
      1 + wbTemperature / 150,
      1,
      1 - wbTemperature / 150
    ];
    const gains = whiteBalance.map((g, i) => g * luminFactor * tempFactor[i]);
    let corrected = rawRgb.map((c, i) => c * gains[i]);
    const m = Math.max(...corrected);
    if (m > 255) corrected = corrected.map(c => c * 255 / m); // préserve la teinte au lieu d'écrêter par canal
    return corrected.map(c => Math.max(0, Math.min(255, Math.round(c))));
  }

  sliderLumin.addEventListener('input', () => {
    wbLuminosite = parseInt(sliderLumin.value, 10);
    recomputeAllMatches();
    renderCanvas();
    renderResults();
  });
  sliderTemp.addEventListener('input', () => {
    wbTemperature = parseInt(sliderTemp.value, 10);
    recomputeAllMatches();
    renderCanvas();
    renderResults();
  });
  btnResetFineTune.addEventListener('click', () => {
    wbLuminosite = 0;
    wbTemperature = 0;
    sliderLumin.value = 0;
    sliderTemp.value = 0;
    recomputeAllMatches();
    renderCanvas();
    renderResults();
  });

  /**
   * Recalcule les correspondances de TOUTES les pastilles ensemble, en
   * garantissant qu'un même feutre n'est jamais attribué à deux numéros
   * différents. Les pastilles dont le meilleur match est le plus net
   * (distance la plus faible) ont priorité ; en cas de conflit, l'autre
   * pastille reçoit son meilleur choix encore disponible.
   */
  function recomputeAllMatches() {
    const activeSet = DB.getSet(DB.getActiveSetId());
    if (!activeSet || currentPoints.length === 0) return;

    const entries = currentPoints.map(p => ({
      point: p,
      ranked: ColorMath.rankAll(applyWhiteBalance(p.rawRgb), activeSet.feutres)
    }));

    // Les points en choix manuel réservent leur feutre et ne sont pas réattribués
    const used = new Set();
    entries.forEach(e => {
      e.point.ranked = e.ranked;
      if (e.point.manualOverride && e.point.match) {
        used.add(e.point.match.feutre.ref);
      }
    });

    const free = entries.filter(e => !e.point.manualOverride);
    const order = [...free].sort((a, b) => a.ranked[0].distance - b.ranked[0].distance);

    order.forEach(entry => {
      let rank = entry.ranked.findIndex(c => !used.has(c.feutre.ref));
      if (rank === -1) rank = 0;
      const chosen = entry.ranked[rank];
      used.add(chosen.feutre.ref);
      entry.point.match = { feutre: chosen.feutre, distance: chosen.distance };
      entry.point.wasAlternative = rank > 0;
      entry.point.conflictRank = rank;
    });
  }

  /** Sélectionne manuellement une alternative pour un point donné. */
  function chooseAlternative(point, feutreRef) {
    const activeSet = DB.getSet(DB.getActiveSetId());
    if (!activeSet) return;
    const entry = point.ranked.find(c => c.feutre.ref === feutreRef);
    if (!entry) return;
    vibrate();
    point.match = { feutre: entry.feutre, distance: entry.distance };
    point.manualOverride = true;
    point.wasAlternative = false;
    recomputeAllMatches();
    renderResults();
  }

  function resetToAutomatic(point) {
    point.manualOverride = false;
    recomputeAllMatches();
    renderResults();
  }

  function sampleColor(x, y) {
    // Moyenne sur une petite zone pour limiter le bruit / compression JPEG,
    // en excluant les pixels quasi blancs ou quasi noirs (contour et chiffre
    // imprimés au centre de la pastille) pour ne garder que le vrai remplissage.
    const radius = 7;
    const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius);
    const w = Math.min(originalImageData.width - x0, radius * 2);
    const h = Math.min(originalImageData.height - y0, radius * 2);
    const data = getOriginalPixels(x0, y0, w, h);

    const kept = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isExtreme = (r > 235 && g > 235 && b > 235) || (r < 40 && g < 40 && b < 40);
      if (!isExtreme) kept.push([r, g, b]);
    }
    const pool = kept.length >= 6 ? kept : (() => {
      // repli : si presque tout a été exclu (pastille très claire ou très
      // sombre), on revient à l'ensemble complet plutôt que de renvoyer du bruit
      const all = [];
      for (let i = 0; i < data.length; i += 4) all.push([data[i], data[i+1], data[i+2]]);
      return all;
    })();

    // Médiane par canal : robuste face à une minorité de pixels aberrants
    const median = arr => {
      const s = arr.slice().sort((a,b)=>a-b);
      return s[Math.floor(s.length/2)];
    };
    return [
      median(pool.map(p=>p[0])),
      median(pool.map(p=>p[1])),
      median(pool.map(p=>p[2]))
    ];
  }

  function getOriginalPixels(x0, y0, w, h) {
    const out = new Uint8ClampedArray(w*h*4);
    let idx = 0;
    for (let yy = y0; yy < y0+h; yy++) {
      for (let xx = x0; xx < x0+w; xx++) {
        const srcIdx = (yy*originalImageData.width + xx)*4;
        out[idx++] = originalImageData.data[srcIdx];
        out[idx++] = originalImageData.data[srcIdx+1];
        out[idx++] = originalImageData.data[srcIdx+2];
        out[idx++] = originalImageData.data[srcIdx+3];
      }
    }
    return out;
  }

  function renderCanvas() {
    if (!originalImageData) return;

    const isCorrected = whiteBalance.some(g => Math.abs(g-1) > 0.005) || wbLuminosite !== 0 || wbTemperature !== 0;

    if (!isCorrected) {
      ctx.putImageData(originalImageData, 0, 0);
    } else {
      const luminFactor = 1 + wbLuminosite / 100;
      const tempFactor = [1 + wbTemperature / 150, 1, 1 - wbTemperature / 150];
      const gains = whiteBalance.map((g, i) => g * luminFactor * tempFactor[i]);

      const src = originalImageData.data;
      const out = ctx.createImageData(originalImageData.width, originalImageData.height);
      const dst = out.data;
      for (let i = 0; i < src.length; i += 4) {
        let r = src[i] * gains[0];
        let g = src[i+1] * gains[1];
        let b = src[i+2] * gains[2];
        const m = Math.max(r, g, b);
        if (m > 255) { const f = 255/m; r*=f; g*=f; b*=f; } // préserve la teinte, pas d'écrêtage par canal
        dst[i]   = Math.max(0, Math.min(255, Math.round(r)));
        dst[i+1] = Math.max(0, Math.min(255, Math.round(g)));
        dst[i+2] = Math.max(0, Math.min(255, Math.round(b)));
        dst[i+3] = src[i+3];
      }
      ctx.putImageData(out, 0, 0);
    }

    // Repères des pastilles déjà pointées, par-dessus l'image (corrigée ou non)
    currentPoints.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(228,84,63,0.9)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.numero, p.x, p.y);
    });
  }

  function renderResults() {
    resultsList.innerHTML = '';
    if (currentPoints.length === 0) {
      resultsList.innerHTML = '<p class="muted">Touche une pastille de la légende sur l’image pour commencer.</p>';
      btnSaveScan.disabled = true;
      return;
    }
    btnSaveScan.disabled = false;
    currentPoints.forEach(p => {
      const row = document.createElement('div');
      row.className = 'result-row-wrap';
      const correctedRgb = applyWhiteBalance(p.rawRgb);
      const distanceLabel = distanceToLabel(p.match.distance);
      const altTag = p.wasAlternative
        ? `<span class="conflict-tag" title="Le plus proche était déjà pris par un autre numéro">${p.conflictRank + 1}ᵉ choix</span>`
        : '';
      const manualTag = p.manualOverride
        ? `<button class="manual-tag" title="Choisi manuellement — toucher pour revenir à l'automatique">✓ manuel ↺</button>`
        : '';
      const main = document.createElement('div');
      main.className = 'result-row';
      main.innerHTML = `
        <span class="numero-badge">${escapeHtml(p.numero)}</span>
        <span class="hex-chip" style="background:${ColorMath.rgbToHex(correctedRgb)}" title="Couleur lue"></span>
        <span class="arrow">→</span>
        <span class="hex-chip" style="background:${ColorMath.rgbToHex(p.match.feutre.rgb)}" title="Feutre proposé"></span>
        <span class="feutre-ref mono">${escapeHtml(p.match.feutre.ref)}</span>
        ${altTag}${manualTag}
        <span class="confidence ${distanceLabel.cls}">${distanceLabel.text}</span>
        <button class="alt-toggle" title="Voir d'autres correspondances proches">▾</button>
      `;
      row.appendChild(main);

      const altPanel = document.createElement('div');
      altPanel.className = 'alt-panel';
      altPanel.hidden = true;
      const alternatives = (p.ranked || []).filter(c => c.feutre.ref !== p.match.feutre.ref).slice(0, 5);
      alternatives.forEach(alt => {
        const chip = document.createElement('button');
        chip.className = 'alt-chip';
        chip.innerHTML = `
          <span class="hex-chip small" style="background:${ColorMath.rgbToHex(alt.feutre.rgb)}"></span>
          <span class="mono">${escapeHtml(alt.feutre.ref)}</span>
        `;
        chip.addEventListener('click', () => chooseAlternative(p, alt.feutre.ref));
        altPanel.appendChild(chip);
      });
      row.appendChild(altPanel);

      main.querySelector('.alt-toggle').addEventListener('click', () => {
        altPanel.hidden = !altPanel.hidden;
        main.querySelector('.alt-toggle').classList.toggle('open', !altPanel.hidden);
      });
      if (p.manualOverride) {
        main.querySelector('.manual-tag').addEventListener('click', () => resetToAutomatic(p));
      }

      resultsList.appendChild(row);
    });
  }

  function distanceToLabel(d) {
    // Repères indicatifs de qualité du match (échelle CIEDE2000)
    if (d < 2) return { cls: 'good', text: 'Correspondance exacte' };
    if (d < 5) return { cls: 'good', text: 'Très proche' };
    if (d < 10) return { cls: 'medium', text: 'Proche' };
    return { cls: 'low', text: 'Approximatif' };
  }

  btnSaveScan.addEventListener('click', async () => {
    const result = await askInput('Enregistrer ce scan', [
      { id: 'livre', label: 'Titre du livre', placeholder: 'ex : Chats & Félins' },
      { id: 'page', label: 'Numéro de page', placeholder: 'ex : 28' }
    ]);
    if (!result) return; // annulé
    const { livre, page } = result;
    vibrate();
    const scan = {
      id: DB.uid(),
      livre, page,
      date: new Date().toISOString(),
      jeuId: DB.getActiveSetId(),
      jeuNom: (DB.getSet(DB.getActiveSetId()) || {}).nom || '',
      resultats: currentPoints.map(p => ({
        numero: p.numero,
        refFeutre: p.match.feutre.ref,
        rgbFeutre: p.match.feutre.rgb,
        distance: Math.round(p.match.distance * 10) / 10,
        choixAlternatif: !!p.wasAlternative
      }))
    };
    DB.saveScan(scan);
    toast('Scan enregistré dans l’historique.');
  });

  // ==================================================
  // Historique
  // ==================================================
  function renderHistory() {
    const history = DB.getHistory();
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.innerHTML = '<p class="muted">Aucun scan enregistré pour l’instant.</p>';
      return;
    }
    history.forEach(scan => {
      const card = document.createElement('div');
      card.className = 'history-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      const date = new Date(scan.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
      card.innerHTML = `
        <div class="history-header">
          <div>
            <h3>${escapeHtml(scan.livre || 'Sans titre')}${scan.page ? ' — p.' + escapeHtml(scan.page) : ''}</h3>
            <span class="muted small">${date} · ${escapeHtml(scan.jeuNom)} · ${scan.resultats.length} couleurs</span>
          </div>
        </div>
        <div class="mini-swatch-grid"></div>
      `;
      const grid = card.querySelector('.mini-swatch-grid');
      scan.resultats.forEach(r => {
        const item = document.createElement('div');
        item.className = 'mini-swatch';
        item.innerHTML = `
          <span class="hex-chip small" style="background:${ColorMath.rgbToHex(r.rgbFeutre)}"></span>
          <span class="mono tiny">${escapeHtml(r.numero)}·${escapeHtml(r.refFeutre)}</span>
        `;
        grid.appendChild(item);
      });
      card.addEventListener('click', () => openScanDetail(scan));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openScanDetail(scan); }
      });
      historyList.appendChild(card);
    });
  }

  function openScanDetail(scan) {
    $('#detail-title').textContent = scan.livre || 'Sans titre';
    const date = new Date(scan.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    $('#detail-meta').textContent = `${scan.page ? 'Page ' + scan.page + ' · ' : ''}${date} · ${scan.jeuNom}`;

    const list = $('#detail-list');
    list.innerHTML = '';
    scan.resultats.forEach(r => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const hasDistance = typeof r.distance === 'number';
      const distanceLabel = hasDistance ? distanceToLabel(r.distance) : null;
      const altTag = r.choixAlternatif
        ? `<span class="conflict-tag" title="Le plus proche était déjà pris par un autre numéro">2ᵉ choix</span>`
        : '';
      row.innerHTML = `
        <span class="numero-badge">${escapeHtml(r.numero)}</span>
        <span class="hex-chip" style="background:${ColorMath.rgbToHex(r.rgbFeutre)}"></span>
        <span class="feutre-ref mono">${escapeHtml(r.refFeutre)}</span>
        ${altTag}
        ${distanceLabel ? `<span class="confidence ${distanceLabel.cls}">${distanceLabel.text}</span>` : ''}
      `;
      list.appendChild(row);
    });

    const deleteBtn = $('#detail-delete');
    deleteBtn.onclick = () => {
      if (confirm('Supprimer ce scan de l’historique ?')) {
        vibrate();
        DB.deleteScan(scan.id);
        $('#scan-detail-dialog').close();
        renderHistory();
      }
    };
    $('#scan-detail-dialog').showModal();
  }

  $('#detail-close').addEventListener('click', () => $('#scan-detail-dialog').close());

  // ==================================================
  // Utilitaires
  // ==================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function hexToRgb(hex) {
    const m = hex.replace('#', '');
    return [
      parseInt(m.substring(0, 2), 16),
      parseInt(m.substring(2, 4), 16),
      parseInt(m.substring(4, 6), 16)
    ];
  }

  /**
   * Bulle de saisie du numéro, ancrée au point tapé sur le canvas plutôt
   * qu'une modale centrée sur la page. Contrairement à <dialog>, un élément
   * positionné en absolute dans le contenu zoome/scrolle avec la page —
   * donc reste visible même en pinch-zoom sans avoir à dézoomer.
   */
  function askNumeroAt(clientX, clientY, defaultValue) {
    return new Promise(resolve => {
      const wrapRect = canvasScroll.getBoundingClientRect();
      let left = clientX - wrapRect.left + canvasScroll.scrollLeft + 16;
      let top = clientY - wrapRect.top + canvasScroll.scrollTop - 20;
      // reste dans les limites visibles du conteneur
      left = Math.max(4, Math.min(left, canvasScroll.clientWidth - 130));
      top = Math.max(4, top);

      numeroPopup.style.left = left + 'px';
      numeroPopup.style.top = top + 'px';
      numeroPopupInput.value = String(defaultValue);
      numeroPopup.hidden = false;
      numeroPopupInput.focus();
      numeroPopupInput.select();

      let done = false;
      function finish(value) {
        if (done) return;
        done = true;
        numeroPopup.hidden = true;
        numeroPopupOk.removeEventListener('click', onOk);
        numeroPopupInput.removeEventListener('keydown', onKey);
        document.removeEventListener('pointerdown', onOutside, true);
        resolve(value);
      }
      function onOk() { finish(numeroPopupInput.value.trim() || String(defaultValue)); }
      function onKey(e) {
        if (e.key === 'Enter') onOk();
        if (e.key === 'Escape') finish(null);
      }
      function onOutside(e) {
        if (!numeroPopup.contains(e.target)) finish(null);
      }
      numeroPopupOk.addEventListener('click', onOk);
      numeroPopupInput.addEventListener('keydown', onKey);
      // léger délai pour ne pas capter le tap qui vient d'ouvrir la bulle
      setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 50);
    });
  }
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /** Retour haptique léger — silencieux si le navigateur ne le supporte pas. */
  function vibrate(ms = 12) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  /**
   * Modale de saisie générique, remplace window.prompt() par un composant
   * cohérent avec le reste de l'app. Retourne une Promise résolue avec un
   * objet {id: valeur} pour chaque champ, ou null si annulé.
   * fields: [{id, label, value, placeholder, type}]
   */
  function askInput(title, fields) {
    return new Promise(resolve => {
      const dialog = $('#input-dialog');
      $('#input-dialog-title').textContent = title;
      const container = $('#input-dialog-fields');
      container.innerHTML = '';
      fields.forEach(f => {
        const wrap = document.createElement('div');
        wrap.className = 'input-field-row';
        wrap.innerHTML = `
          <label for="field-${f.id}">${escapeHtml(f.label)}</label>
          <input type="${f.type || 'text'}" id="field-${f.id}"
                 value="${escapeHtml(f.value != null ? String(f.value) : '')}"
                 placeholder="${escapeHtml(f.placeholder || '')}">
        `;
        container.appendChild(wrap);
      });

      const okBtn = $('#input-dialog-ok');
      const cancelBtn = $('#input-dialog-cancel');
      let done = false;

      function finish(result) {
        if (done) return;
        done = true;
        dialog.close();
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onCancel);
        resolve(result);
      }
      function onOk() {
        const result = {};
        fields.forEach(f => { result[f.id] = $(`#field-${f.id}`).value.trim(); });
        finish(result);
      }
      function onCancel() { finish(null); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onCancel);
      dialog.showModal();

      const firstInput = container.querySelector('input');
      if (firstInput) { firstInput.focus(); firstInput.select(); }
      container.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') onOk(); });
      });
    });
  }

  // ==================================================
  // Initialisation
  // ==================================================
  async function init() {
    await ensureDefaultSet();
    refreshSetSelect();
    switchView('scanner');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
