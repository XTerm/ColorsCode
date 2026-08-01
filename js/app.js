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
  const resultsList = $('#results-list');
  const resultsSection = $('#results-section');
  const fullcolorSection = $('#fullcolor-section');
  const btnFullcolor = $('#btn-fullcolor');
  const fullcolorFileInput = $('#fullcolor-file-input');
  const fullcolorProgress = $('#fullcolor-progress');
  const fullcolorCanvasWrap = $('#fullcolor-canvas-wrap');
  const fullcolorCanvas = $('#fullcolor-canvas');
  const fullcolorSummary = $('#fullcolor-summary');
  let fullcolorSeg = null, fullcolorImgData = null, fullcolorZoneColor = null, pendingRecolorZoneId = null;
  const setSelect = $('#active-set-select');
  const setWarning = $('#set-warning');
  const btnUndo = $('#btn-undo');
  const btnReset = $('#btn-reset');
  const btnDetect = $('#btn-detect');
  const ocrToggle = $('#ocr-toggle-input');
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
    // Sans ça, changer de jeu après avoir déjà pointé des pastilles laissait
    // les résultats affichés sur l'ancien jeu — recalcul immédiat nécessaire.
    if (currentPoints.length) {
      recomputeAllMatches();
      renderCanvas();
      renderResults();
      toast('Correspondances recalculées avec le nouveau jeu.');
    }
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
        fullcolorSection.hidden = false;
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
    const numeroInput = prompt('Numéro de la légende pour cette pastille :', String(nextNumero));
    if (numeroInput === null) return; // annulé
    const numero = numeroInput.trim() || String(nextNumero);

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

  btnDetect.addEventListener('click', async () => {
    if (!originalImageData) { alert('Charge d’abord une photo.'); return; }
    const activeSet = DB.getSet(DB.getActiveSetId());
    if (!activeSet || activeSet.feutres.length === 0) {
      alert('Choisis d’abord un jeu de feutres actif (onglet Feutres).');
      return;
    }
    if (currentPoints.length && !confirm('La détection automatique remplace les pastilles déjà pointées. Continuer ?')) return;

    const wantOcr = ocrToggle.checked;
    const originalLabel = btnDetect.textContent;
    btnDetect.disabled = true;
    btnDetect.textContent = '⏳ Analyse en cours… (peut prendre plusieurs secondes)';

    // setTimeout laisse le navigateur repeindre le bouton avant de bloquer
    // le thread avec le calcul (sinon le texte "Analyse en cours" n'apparaît
    // jamais à l'écran avant que ça se termine ou plante).
    setTimeout(async () => {
      let found;
      try {
        found = detectSwatches();
      } catch (err) {
        console.error('Erreur détection', err);
        alert('La détection a échoué : ' + (err && err.message ? err.message : err));
        btnDetect.disabled = false;
        btnDetect.textContent = originalLabel;
        return;
      }

      if (!found || found.length === 0) {
        btnDetect.disabled = false;
        btnDetect.textContent = originalLabel;
        toast('Aucune pastille détectée — essaie le repérage manuel.');
        return;
      }

      if (wantOcr) {
        btnDetect.textContent = '⏳ Lecture des numéros (OCR)…';
        try {
          const n = await ocrDetectedNumbers(found);
          toast(n > 0 ? `${n} numéro(s) lu(s) automatiquement — vérifie le reste.` : 'OCR : aucun numéro lu avec confiance, vérifie manuellement.');
        } catch (err) {
          console.error('OCR indisponible', err);
          alert('OCR indisponible : ' + (err && err.message ? err.message : err) + '\nLa détection continue avec une numérotation séquentielle à corriger.');
        }
      }

      btnDetect.disabled = false;
      btnDetect.textContent = originalLabel;
      vibrate();
      currentPoints = found;
      nextNumero = found.length + 1;
      recomputeAllMatches();
      renderCanvas();
      renderResults();
      if (!wantOcr) toast(`${found.length} pastille(s) détectée(s) — vérifie les numéros.`);
    }, 50);
  });

  /**
   * Repère automatiquement les pastilles de couleur dans l'image : détecte
   * les blocs compacts et remplis (contrairement aux traits fins de
   * l'illustration, qui ont un ratio de remplissage bien plus faible dans
   * leur boîte englobante), sans zone à sélectionner à la main.
   * Numérotées par défaut dans l'ordre de lecture (haut→bas, gauche→droite) ;
   * à corriger si besoin dans les résultats.
   */
  function detectSwatches() {
    const fullW = originalImageData.width, fullH = originalImageData.height;
    const data = originalImageData.data;

    // Travaille sur une grille sous-échantillonnée (1 pixel sur 2 dans
    // chaque direction, soit 4x moins de calcul) : les pastilles font
    // largement plus de 2px, donc ça ne change rien à la détection, mais
    // ça change beaucoup la vitesse sur un téléphone modeste.
    const step = 2;
    const w = Math.ceil(fullW / step);
    const h = Math.ceil(fullH / step);
    const n = w * h;

    const score = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcIdx = ((y * step) * fullW + (x * step)) * 4;
        const r = data[srcIdx], g = data[srcIdx + 1], b = data[srcIdx + 2];
        const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
        const sat = maxc > 0 ? (maxc - minc) / maxc : 0;
        const dark = 1 - maxc / 255;
        // Seuils assouplis (0.14 / 0.28, contre 0.22 / 0.45 initialement)
        // pour capter les pastilles pâles/pastel, sans les relâcher au
        // point de fusionner avec les traits fins de l'illustration.
        score[y * w + x] = (sat > 0.14 || dark > 0.28) ? 1 : 0;
      }
    }

    const labels = new Int32Array(n);
    const stack = new Int32Array(n);
    let nextLabel = 1;
    const components = [];

    for (let start = 0; start < n; start++) {
      if (score[start] !== 1 || labels[start] !== 0) continue;
      let sp = 0;
      stack[sp++] = start;
      labels[start] = nextLabel;
      let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
      while (sp > 0) {
        const idx = stack[--sp];
        const x = idx % w, y = (idx / w) | 0;
        area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0)   { const nb = idx - 1; if (score[nb] === 1 && labels[nb] === 0) { labels[nb] = nextLabel; stack[sp++] = nb; } }
        if (x < w-1) { const nb = idx + 1; if (score[nb] === 1 && labels[nb] === 0) { labels[nb] = nextLabel; stack[sp++] = nb; } }
        if (y > 0)   { const nb = idx - w; if (score[nb] === 1 && labels[nb] === 0) { labels[nb] = nextLabel; stack[sp++] = nb; } }
        if (y < h-1) { const nb = idx + w; if (score[nb] === 1 && labels[nb] === 0) { labels[nb] = nextLabel; stack[sp++] = nb; } }
      }
      components.push({ minX, minY, maxX, maxY, area });
      nextLabel++;
    }

    // Seuils de taille en pixels absolus plutôt qu'en pourcentage de
    // l'image totale : une légende à 20 pastilles a des pastilles bien
    // plus petites qu'une légende à 10, un pourcentage fixe rate donc
    // les petites légendes. Divisés par 4 (step²) car mesurés sur la
    // grille sous-échantillonnée.
    const minArea = 300 / (step * step);
    const maxArea = 20000 / (step * step);
    let candidates = components.filter(c => {
      if (c.area < minArea || c.area > maxArea) return false;
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      const fillRatio = c.area / (bw * bh);
      const aspect = bw / bh;
      return fillRatio > 0.45 && aspect > 0.4 && aspect < 2.5;
    });

    if (candidates.length === 0) return [];
    candidates.forEach(c => { c.cx = (c.minX+c.maxX)/2; c.cy = (c.minY+c.maxY)/2; });

    // Exclut les éléments isolés du reste du groupe (typiquement le numéro
    // de page, imprimé loin de la légende) : une vraie pastille de légende
    // a toujours d'autres pastilles proches, peu importe l'orientation
    // (ligne, colonne...), alors qu'un numéro de page est un point isolé.
    if (candidates.length >= 4) {
      candidates.forEach(c => {
        let minDist = Infinity;
        candidates.forEach(o => {
          if (o === c) return;
          const d = Math.hypot(c.cx - o.cx, c.cy - o.cy);
          if (d < minDist) minDist = d;
        });
        c.nnDist = minDist;
      });
      const dists = candidates.map(c => c.nnDist).sort((a,b) => a-b);
      const medianDist = dists[Math.floor(dists.length/2)];
      candidates = candidates.filter(c => c.nnDist <= medianDist * 3);
    }

    const heights = candidates.map(c => c.maxY - c.minY + 1).sort((a,b)=>a-b);
    const medianH = heights[Math.floor(heights.length/2)];
    candidates.sort((a,b) => a.cy - b.cy);
    const rows = [];
    candidates.forEach(c => {
      let row = rows.find(r => Math.abs(r.y - c.cy) < medianH * 0.6);
      if (!row) { row = { y: c.cy, items: [] }; rows.push(row); }
      row.items.push(c);
    });
    rows.sort((a,b) => a.y - b.y);
    const ordered = [];
    rows.forEach(r => {
      r.items.sort((a,b) => a.cx - b.cx);
      ordered.push(...r.items);
    });

    return ordered.map((c, i) => {
      // remise à l'échelle vers les coordonnées de l'image pleine résolution
      const cx = Math.round(c.cx * step), cy = Math.round(c.cy * step);
      const rawRgb = sampleColor(cx, cy);
      return {
        numero: String(i + 1), x: cx, y: cy, rawRgb,
        bbox: {
          x0: Math.round(c.minX * step), y0: Math.round(c.minY * step),
          x1: Math.round(c.maxX * step), y1: Math.round(c.maxY * step)
        }
      };
    });
  }

  // ==================================================
  // OCR optionnel des numéros (expérimental)
  // ==================================================
  let tesseractLoadPromise = null;
  function loadTesseract() {
    if (tesseractLoadPromise) return tesseractLoadPromise;
    tesseractLoadPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error('Moteur OCR indisponible (connexion internet requise pour le premier usage)'));
      document.head.appendChild(script);
    });
    return tesseractLoadPromise;
  }

  /**
   * Tente de lire le numéro imprimé sur chaque pastille détectée, pour
   * remplacer la numérotation séquentielle par défaut. Contrairement à
   * l'OCR sur un dessin complet (abandonné — chiffres minuscules et peu
   * fiables), ici les chiffres de légende sont grands et nets (texte en
   * gras sur fond de couleur uni) : bien plus favorable. Reste
   * expérimental, non validé en conditions réelles.
   */
  /** Rogne puis fait pivoter une zone du canvas source vers un nouveau canvas. */
  function cropRotated(srcCanvas, sx, sy, sw, sh, scale, angleDeg) {
    const out = document.createElement('canvas');
    const rad = angleDeg * Math.PI / 180;
    if (angleDeg === 90 || angleDeg === -90 || angleDeg === 270) {
      out.width = sh * scale;
      out.height = sw * scale;
    } else {
      out.width = sw * scale;
      out.height = sh * scale;
    }
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.translate(out.width / 2, out.height / 2);
    octx.rotate(rad);
    octx.drawImage(srcCanvas, sx, sy, sw, sh, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
    return out;
  }

  async function ocrDetectedNumbers(points) {
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      tessedit_pageseg_mode: '10' // caractère/bloc unique
    });
    let successCount = 0;
    for (const p of points) {
      if (!p.bbox) continue;
      try {
        const pad = 4;
        const bw = p.bbox.x1 - p.bbox.x0 + 1, bh = p.bbox.y1 - p.bbox.y0 + 1;
        const sx = Math.max(0, p.bbox.x0 - pad), sy = Math.max(0, p.bbox.y0 - pad);
        const sw = bw + pad * 2, sh = bh + pad * 2;

        // Essaie plusieurs orientations et garde la meilleure confiance —
        // Tesseract peut lire un même caractère très différemment selon
        // l'angle, même pour un caractère isolé.
        let best = null;
        for (const angle of [0, 90, -90]) {
          const crop = cropRotated(canvas, sx, sy, sw, sh, 4, angle);
          const { data } = await worker.recognize(crop);
          const cleaned = (data.text || '').trim().replace(/[^0-9A-Za-z]/g, '');
          if (cleaned && (!best || data.confidence > best.confidence)) {
            best = { cleaned, confidence: data.confidence };
          }
        }
        if (best && best.confidence > 55) {
          p.numero = best.cleaned.length <= 3 ? best.cleaned : best.cleaned.slice(0, 3);
          successCount++;
        }
      } catch (e) {
        console.error('OCR pastille échoué', e);
      }
    }
    await worker.terminate();
    return successCount;
  }

  // ==================================================
  // Coloriage automatique d'une page complète (expérimental)
  // ==================================================
  btnFullcolor.addEventListener('click', () => fullcolorFileInput.click());
  fullcolorFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processFullColorPage(file);
    e.target.value = '';
  });

  function nextFrame() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  function setFullcolorProgress(text, frac) {
    fullcolorProgress.hidden = false;
    fullcolorProgress.innerHTML = `<div>${escapeHtml(text)}</div><div class="bar"><div class="bar-fill" style="width:${Math.round(frac*100)}%"></div></div>`;
  }
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function dilateBinary(mask, w, h, iterations) {
    let cur = mask;
    for (let it = 0; it < iterations; it++) {
      const next = new Uint8Array(cur.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (cur[idx]) { next[idx] = 1; continue; }
          if ((x > 0 && cur[idx-1]) || (x < w-1 && cur[idx+1]) ||
              (y > 0 && cur[idx-w]) || (y < h-1 && cur[idx+w])) next[idx] = 1;
        }
      }
      cur = next;
    }
    return cur;
  }

  /** Segmente les zones fermées de l'illustration (fond entre les traits, dilatés pour combler les micro-coupures). */
  function segmentZones(imgData) {
    const w = imgData.width, h = imgData.height, data = imgData.data, n = w * h;
    const ink = new Uint8Array(n);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      ink[p] = (data[i] + data[i+1] + data[i+2]) / 3 < 200 ? 1 : 0;
    }
    const dilated = dilateBinary(ink, w, h, 2);
    const background = new Uint8Array(n);
    for (let i = 0; i < n; i++) background[i] = dilated[i] ? 0 : 1;

    const labels = new Int32Array(n);
    const stack = new Int32Array(n);
    let nextLabel = 1;
    const areas = {};
    for (let start = 0; start < n; start++) {
      if (background[start] !== 1 || labels[start] !== 0) continue;
      let sp = 0; stack[sp++] = start; labels[start] = nextLabel;
      let area = 0;
      while (sp > 0) {
        const idx = stack[--sp]; const x = idx % w, y = (idx / w) | 0; area++;
        if (x > 0)   { const nb = idx-1; if (background[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
        if (x < w-1) { const nb = idx+1; if (background[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
        if (y > 0)   { const nb = idx-w; if (background[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
        if (y < h-1) { const nb = idx+w; if (background[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
      }
      areas[nextLabel] = area;
      nextLabel++;
    }
    return { labels, w, h, areas, n };
  }

  /** Repère les petits blocs compacts (chiffres) dans le masque d'encre non dilaté. */
  function detectDigitBlobs(imgData) {
    const w = imgData.width, h = imgData.height, data = imgData.data, n = w * h;
    const inkLoose = new Uint8Array(n);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      inkLoose[p] = (data[i] + data[i+1] + data[i+2]) / 3 < 235 ? 1 : 0;
    }
    const dilated = dilateBinary(inkLoose, w, h, 1);
    const labels = new Int32Array(n);
    const stack = new Int32Array(n);
    let nextLabel = 1;
    const comps = [];
    for (let start = 0; start < n; start++) {
      if (dilated[start] !== 1 || labels[start] !== 0) continue;
      let sp = 0; stack[sp++] = start; labels[start] = nextLabel;
      let minX=w, minY=h, maxX=0, maxY=0, area=0;
      while (sp > 0) {
        const idx = stack[--sp]; const x = idx % w, y = (idx / w) | 0; area++;
        if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y;
        if (x > 0)   { const nb = idx-1; if (dilated[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
        if (x < w-1) { const nb = idx+1; if (dilated[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
        if (y > 0)   { const nb = idx-w; if (dilated[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
        if (y < h-1) { const nb = idx+w; if (dilated[nb]===1 && labels[nb]===0) { labels[nb]=nextLabel; stack[sp++]=nb; } }
      }
      const bw = maxX-minX+1, bh = maxY-minY+1;
      if (bh>=8 && bh<=45 && bw>=5 && bw<=40 && area>=15 && area/(bw*bh)>0.18) {
        comps.push({ minX, minY, maxX, maxY, cx:(minX+maxX)/2, cy:(minY+maxY)/2, bw, bh });
      }
      nextLabel++;
    }
    return comps;
  }

  /** Fusionne les blobs de chiffres adjacents (même hauteur, faible écart horizontal)
   *  pour reconstituer les nombres à 2 chiffres (10, 11, 14...) avant OCR. */
  function mergeDigitBlobs(comps) {
    const sorted = comps.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const used = new Array(sorted.length).fill(false);
    const merged = [];
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue;
      const group = [sorted[i]];
      used[i] = true;
      let lastX1 = sorted[i].maxX;
      for (let j = i + 1; j < sorted.length; j++) {
        if (used[j]) continue;
        const o = sorted[j];
        const gap = o.minX - lastX1;
        if (Math.abs(o.cy - sorted[i].cy) < sorted[i].bh * 0.5 && gap > -3 && gap < sorted[i].bw * 0.9) {
          group.push(o); used[j] = true; lastX1 = o.maxX;
        }
      }
      const minX = Math.min(...group.map(g => g.minX));
      const maxX = Math.max(...group.map(g => g.maxX));
      const minY = Math.min(...group.map(g => g.minY));
      const maxY = Math.max(...group.map(g => g.maxY));
      merged.push({ minX, minY, maxX, maxY, cx: (minX+maxX)/2, cy: (minY+maxY)/2, bw: maxX-minX+1, bh: maxY-minY+1, n: group.length });
    }
    return merged;
  }

  function zoneAt(seg, cx, cy) {
    const x = Math.round(cx), y = Math.round(cy);
    if (x<0||x>=seg.w||y<0||y>=seg.h) return null;
    const direct = seg.labels[y*seg.w+x];
    if (direct) return direct;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x+dx, yy = y+dy;
          if (xx<0||xx>=seg.w||yy<0||yy>=seg.h) continue;
          const id = seg.labels[yy*seg.w+xx];
          if (id) return id;
        }
      }
    }
    return null;
  }

  function cropDigitCanvas(sourceCanvas, b) {
    const pad = 4, scale = 5;
    const bw = (b.maxX-b.minX+1) + pad*2, bh = (b.maxY-b.minY+1) + pad*2;
    const out = document.createElement('canvas');
    out.width = Math.max(1, bw*scale); out.height = Math.max(1, bh*scale);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.drawImage(sourceCanvas, Math.max(0,b.minX-pad), Math.max(0,b.minY-pad), bw, bh, 0, 0, out.width, out.height);
    return out;
  }

  async function processFullColorPage(file) {
    if (currentPoints.length === 0) {
      alert('Scanne d’abord la légende ci-dessus : il faut connaître la correspondance numéro → feutre avant de colorier une page.');
      return;
    }
    const numeroToColor = {};
    currentPoints.forEach(p => { numeroToColor[p.numero] = p.match.feutre.rgb; });

    fullcolorCanvasWrap.hidden = true;
    setFullcolorProgress('Chargement de l’image…', 0);
    await nextFrame();

    let img;
    try {
      img = await loadImageFromFile(file);
    } catch (e) {
      fullcolorProgress.hidden = true;
      alert('Impossible de charger cette image.');
      return;
    }

    const maxW = 1600; // résolution plus fine que le scanner de légende : les chiffres sont petits
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    fullcolorCanvas.width = w; fullcolorCanvas.height = h;
    const fctx = fullcolorCanvas.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(img, 0, 0, w, h);
    const imgData = fctx.getImageData(0, 0, w, h);

    setFullcolorProgress('Segmentation des zones du dessin…', 0.05);
    await nextFrame();
    let seg, digitBlobs;
    try {
      seg = segmentZones(imgData);
      setFullcolorProgress('Détection des numéros…', 0.15);
      await nextFrame();
      digitBlobs = mergeDigitBlobs(detectDigitBlobs(imgData));
    } catch (e) {
      fullcolorProgress.hidden = true;
      alert('Erreur pendant l’analyse : ' + (e && e.message ? e.message : e));
      return;
    }

    const zoneDigit = {};
    digitBlobs.forEach(b => {
      const zid = zoneAt(seg, b.cx, b.cy);
      if (zid && !zoneDigit[zid]) zoneDigit[zid] = b; // un seul chiffre attendu par zone
    });
    const zoneIds = Object.keys(zoneDigit);

    let worker;
    try {
      const Tesseract = await loadTesseract();
      worker = await Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
    } catch (e) {
      fullcolorProgress.hidden = true;
      alert('Moteur OCR indisponible : ' + (e && e.message ? e.message : e) + '\n(connexion internet requise au premier usage)');
      return;
    }

    const zoneColor = {};
    let done = 0, success = 0, rejected = 0;
    for (const zid of zoneIds) {
      const b = zoneDigit[zid];
      try {
        const crop = cropDigitCanvas(fullcolorCanvas, b);
        const { data } = await worker.recognize(crop);
        let text = (data.text || '').trim().replace(/[^0-9]/g, '');
        let remapped44to11 = false;
        // Confusion récurrente et spécifique constatée à l'usage : deux "1"
        // fusionnés se lisent souvent "44". Les légendes de coloriages
        // mystères ne dépassent quasiment jamais 10-12 (elles passent ensuite
        // à des lettres), donc "44" n'est en pratique jamais un vrai code —
        // on ne corrige que si "44" n'existe pas dans la légende mais "11" oui,
        // pour ne jamais écraser un vrai code 44 si un livre en avait un jour un.
        if (text === '44' && !numeroToColor['44'] && numeroToColor['11']) {
          text = '11';
          remapped44to11 = true;
        }
        // Les nombres à 2 chiffres (10, 11, 14...) restent plus fragiles même
        // fusionnés : on exige une confiance nettement plus élevée pour eux,
        // quitte à laisser la zone blanche plutôt que risquer une couleur
        // fausse — une zone vide se voit, une couleur fausse ne se voit pas.
        // Exception : "44"->"11" repose sur une règle fiable, pas sur la
        // confiance OCR brute du "44" lu (souvent basse) — seuil allégé.
        const minConfidence = remapped44to11 ? 30 : (text.length >= 2 ? 70 : 45);
        if (text && numeroToColor[text] && data.confidence >= minConfidence) {
          zoneColor[zid] = numeroToColor[text];
          success++;
        } else if (text) {
          rejected++;
        }
      } catch (e) { /* zone laissée non-coloriée */ }
      done++;
      if (done % 5 === 0 || done === zoneIds.length) {
        setFullcolorProgress(`Lecture des numéros… ${done}/${zoneIds.length} (${success} reconnus)`, 0.15 + 0.75*(done/zoneIds.length));
        await nextFrame();
      }
    }
    await worker.terminate();

    setFullcolorProgress('Coloriage…', 0.95);
    await nextFrame();

    fullcolorImgData = imgData;
    fullcolorSeg = seg;
    fullcolorZoneColor = zoneColor;
    renderFullcolorResult();

    fullcolorProgress.hidden = true;
    fullcolorCanvasWrap.hidden = false;
    fullcolorSummary.textContent = `${success} zone(s) coloriée(s) automatiquement sur ${zoneIds.length} numéro(s) détecté(s) (${digitBlobs.length} candidats analysés, ${rejected} rejeté(s) par manque de confiance). Le reste est laissé tel quel — à compléter à la main, ou touche une zone déjà coloriée pour tester une autre couleur.`;
  }

  /** Redessine le canvas du coloriage complet à partir de l'état courant
   *  (appelé après l'analyse initiale, et après chaque recoloriage manuel). */
  function renderFullcolorResult() {
    const fctx = fullcolorCanvas.getContext('2d', { willReadFrequently: true });
    const seg = fullcolorSeg, imgData = fullcolorImgData, zoneColor = fullcolorZoneColor;
    const out = fctx.createImageData(seg.w, seg.h);
    const src = imgData.data, dst = out.data;
    for (let p = 0; p < seg.n; p++) {
      const i = p * 4;
      const zid = seg.labels[p];
      const color = zid ? zoneColor[zid] : null;
      if (color) {
        dst[i]=color[0]; dst[i+1]=color[1]; dst[i+2]=color[2]; dst[i+3]=255;
      } else {
        dst[i]=src[i]; dst[i+1]=src[i+1]; dst[i+2]=src[i+2]; dst[i+3]=255;
      }
    }
    fctx.putImageData(out, 0, 0);
  }

  /** Tap sur une zone déjà rendue : proposer de la recolorier avec une
   *  couleur du jeu actif, pour évaluer si elle convient mieux. */
  fullcolorCanvas.addEventListener('click', (e) => {
    if (!fullcolorSeg) return;
    const rect = fullcolorCanvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (fullcolorCanvas.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (fullcolorCanvas.height / rect.height));
    if (x < 0 || y < 0 || x >= fullcolorSeg.w || y >= fullcolorSeg.h) return;
    const zid = fullcolorSeg.labels[y * fullcolorSeg.w + x];
    if (!zid) return; // tap sur un trait, pas une zone
    openZoneRecolorDialog(zid);
  });

  function openZoneRecolorDialog(zid) {
    const activeSet = DB.getSet(DB.getActiveSetId());
    if (!activeSet) return;
    pendingRecolorZoneId = zid;
    $('#recolor-search').value = '';
    renderRecolorGrid(activeSet, '');
    $('#zone-recolor-dialog').showModal();
  }

  function renderRecolorGrid(set, term) {
    const grid = $('#recolor-grid');
    grid.innerHTML = '';
    const filtered = term ? set.feutres.filter(f => f.ref.toLowerCase().includes(term.toLowerCase())) : set.feutres;
    filtered.forEach(f => {
      const chip = document.createElement('button');
      chip.className = 'recolor-chip';
      chip.innerHTML = `<span class="hex-chip small" style="background:${ColorMath.rgbToHex(f.rgb)}"></span><span class="mono tiny">${escapeHtml(f.ref)}</span>`;
      chip.addEventListener('click', () => {
        if (pendingRecolorZoneId != null) {
          fullcolorZoneColor[pendingRecolorZoneId] = f.rgb;
          renderFullcolorResult();
          vibrate();
        }
        $('#zone-recolor-dialog').close();
      });
      grid.appendChild(chip);
    });
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="muted small">Aucun résultat.</p>';
    }
  }

  $('#recolor-search').addEventListener('input', () => {
    const activeSet = DB.getSet(DB.getActiveSetId());
    if (activeSet) renderRecolorGrid(activeSet, $('#recolor-search').value.trim());
  });

  $('#recolor-clear-zone').addEventListener('click', () => {
    if (pendingRecolorZoneId != null) {
      delete fullcolorZoneColor[pendingRecolorZoneId];
      renderFullcolorResult();
      vibrate();
    }
    $('#zone-recolor-dialog').close();
  });

  $('#recolor-close').addEventListener('click', () => $('#zone-recolor-dialog').close());

  function sampleColor(x, y) {
    // La médiane seule ne suffit pas : sur une trame d'impression résolue par
    // la photo (deux tons qui alternent pixel à pixel), la médiane retombe
    // sur l'un des deux tons au lieu de leur mélange perçu. On calcule donc
    // une médiane robuste d'abord (pour situer le "centre"), on écarte les
    // pixels trop éloignés (le chiffre imprimé, très contrasté), puis on
    // prend la VRAIE MOYENNE du reste — qui moyenne correctement la trame
    // tout en excluant le chiffre, sans avoir besoin de le détecter par OCR.
    const radius = 9;
    const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius);
    const w = Math.min(originalImageData.width - x0, radius * 2);
    const h = Math.min(originalImageData.height - y0, radius * 2);
    const data = getOriginalPixels(x0, y0, w, h);

    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
    if (pixels.length === 0) return [128, 128, 128];

    const median = arr => {
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const centerEstimate = [
      median(pixels.map(p => p[0])),
      median(pixels.map(p => p[1])),
      median(pixels.map(p => p[2]))
    ];

    const dist = p => Math.sqrt(
      (p[0] - centerEstimate[0]) ** 2 +
      (p[1] - centerEstimate[1]) ** 2 +
      (p[2] - centerEstimate[2]) ** 2
    );
    const distances = pixels.map(dist).sort((a, b) => a - b);
    const threshold = distances[Math.floor(distances.length * 0.85)]; // garde les 85% les plus proches

    const inliers = pixels.filter(p => dist(p) <= threshold);
    const pool = inliers.length >= 6 ? inliers : pixels; // repli si presque tout exclu

    const avg = [0, 0, 0];
    pool.forEach(p => { avg[0] += p[0]; avg[1] += p[1]; avg[2] += p[2]; });
    return avg.map(v => Math.round(v / pool.length));
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
        <button class="numero-badge" title="Toucher pour modifier le numéro">${escapeHtml(p.numero)}</button>
        <span class="hex-chip" style="background:${ColorMath.rgbToHex(correctedRgb)}" title="Couleur lue"></span>
        <span class="arrow">→</span>
        <span class="hex-chip" style="background:${ColorMath.rgbToHex(p.match.feutre.rgb)}" title="Feutre proposé"></span>
        <span class="feutre-ref mono">${escapeHtml(p.match.feutre.ref)}</span>
        ${altTag}${manualTag}
        <span class="confidence ${distanceLabel.cls}">${distanceLabel.text}</span>
        <button class="alt-toggle" title="Voir d'autres correspondances proches">▾</button>
        <button class="row-delete" title="Supprimer cette pastille">✕</button>
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

      main.querySelector('.numero-badge').addEventListener('click', () => {
        const input = prompt('Modifier le numéro de cette pastille :', p.numero);
        if (input === null) return;
        const newNumero = input.trim();
        if (!newNumero) return;
        vibrate();
        p.numero = newNumero;
        renderResults();
      });

      main.querySelector('.row-delete').addEventListener('click', () => {
        if (!confirm(`Supprimer la pastille n°${p.numero} ?`)) return;
        vibrate();
        const idx = currentPoints.indexOf(p);
        if (idx !== -1) currentPoints.splice(idx, 1);
        recomputeAllMatches();
        renderCanvas();
        renderResults();
      });

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
      // Sans ça, la page déjà ouverte continue de tourner avec l'ancien
      // JS en mémoire après une mise à jour en arrière-plan, jusqu'à
      // fermeture manuelle — source de confusion ("j'ai l'impression
      // d'utiliser une vieille version"). On recharge une seule fois dès
      // qu'un nouveau service worker prend le contrôle.
      let refreshedOnce = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshedOnce) return;
        refreshedOnce = true;
        window.location.reload();
      });
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
