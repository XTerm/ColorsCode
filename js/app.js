/**
 * app.js — logique principale de ColorsCode
 */

const App = (() => {

  // ---- État en mémoire du scan en cours ----
  let currentImage = null;   // HTMLImageElement
  // Chaque point : {numero, x, y, rawRgb, match:{feutre,distance}, wasAlternative, conflictRank}
  let currentPoints = [];
  let nextNumero = 1;
  let whiteBalance = [1, 1, 1]; // gains R,G,B appliqués aux couleurs lues
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

  const fileInput = $('#file-input');
  const canvas = $('#capture-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const emptyState = $('#scanner-empty');
  const canvasWrap = $('#canvas-wrap');
  const resultsList = $('#results-list');
  const resultsSection = $('#results-section');
  const setSelect = $('#active-set-select');
  const setWarning = $('#set-warning');
  const btnUndo = $('#btn-undo');
  const btnReset = $('#btn-reset');
  const btnSaveScan = $('#btn-save-scan');
  const btnCalibrate = $('#btn-calibrate');
  const calibrationStatus = $('#calibration-status');

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
  async function ensureDefaultSet() {
    const sets = DB.getSets();
    if (sets.length === 0) {
      try {
        const res = await fetch('data/guangna-240.json');
        const data = await res.json();
        DB.saveSet(data);
        DB.setActiveSetId(data.id);
      } catch (e) {
        console.error('Impossible de charger le jeu par défaut', e);
      }
    } else if (!DB.getActiveSetId()) {
      DB.setActiveSetId(sets[0].id);
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
  $('#btn-new-set').addEventListener('click', () => {
    const nom = prompt('Nom du nouveau jeu de feutres (ex : Staedtler 48)');
    if (!nom) return;
    const set = {
      id: 'custom-' + DB.uid(),
      nom,
      source: 'Créé manuellement',
      feutres: []
    };
    DB.saveSet(set);
    DB.setActiveSetId(set.id);
    openSetEditor(set.id);
    renderSets();
    refreshSetSelect();
  });

  function openSetEditor(setId) {
    const set = DB.getSet(setId);
    if (!set) return;
    $('#editor-set-name').textContent = set.nom;
    renderEditorList(set);
    $('#set-editor-dialog').showModal();
  }

  function renderEditorList(set) {
    const list = $('#editor-feutres-list');
    list.innerHTML = '';
    set.feutres.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'editor-row';
      row.innerHTML = `
        <span class="hex-chip small" style="background:${ColorMath.rgbToHex(f.rgb)}"></span>
        <span class="mono">${escapeHtml(f.ref)}</span>
        <button class="icon-btn danger" data-i="${i}">✕</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        set.feutres.splice(i, 1);
        DB.saveSet(set);
        renderEditorList(set);
      });
      list.appendChild(row);
    });
  }

  $('#editor-add-feutre').addEventListener('click', () => {
    const setId = DB.getActiveSetId();
    const set = DB.getSet(setId);
    if (!set) return;
    const ref = $('#editor-ref-input').value.trim();
    const color = $('#editor-color-input').value; // #rrggbb
    if (!ref) { alert('Indique une référence.'); return; }
    const rgb = hexToRgb(color);
    set.feutres.push({ ref, rgb });
    DB.saveSet(set);
    renderEditorList(set);
    $('#editor-ref-input').value = '';
    $('#editor-ref-input').focus();
  });

  $('#editor-close').addEventListener('click', () => {
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
  $('#btn-take-photo').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
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
        resetPoints();
        updateCalibrationStatus();
        emptyState.hidden = true;
        canvasWrap.hidden = false;
        resultsSection.hidden = false;
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
    calibrating = false;
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
    redrawMarkers();
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

  canvas.addEventListener('click', (e) => {
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
      calibrateFromSample(rawRgb);
      calibrating = false;
      updateCalibrationStatus();
      recomputeAllMatches();
      renderResults();
      toast('Étalonnage appliqué à cette photo.');
      return;
    }

    const numeroInput = prompt('Numéro de la légende pour cette pastille :', String(nextNumero));
    if (numeroInput === null) return; // annulé
    const numero = numeroInput.trim() || String(nextNumero);

    currentPoints.push({ numero, x, y, rawRgb });
    nextNumero = (parseInt(numero, 10) || nextNumero) + 1;

    recomputeAllMatches();
    redrawMarkers();
    renderResults();
  });

  /**
   * Corrige une dominante colorée en calculant des gains R/G/B à partir
   * d'un point censé être blanc (le fond de la page). Gain plafonné à 3x
   * pour éviter une correction aberrante si le point tapé n'est pas neutre.
   */
  function calibrateFromSample(rawRgb) {
    const target = 250;
    whiteBalance = rawRgb.map(c => c > 5 ? Math.min(3, target / c) : 1);
  }

  function applyWhiteBalance(rawRgb) {
    return rawRgb.map((c, i) => Math.max(0, Math.min(255, Math.round(c * whiteBalance[i]))));
  }

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

    // Priorité aux matches les plus nets pour "réclamer" leur meilleur feutre en premier
    const order = [...entries].sort((a, b) => a.ranked[0].distance - b.ranked[0].distance);
    const used = new Set();

    order.forEach(entry => {
      let rank = entry.ranked.findIndex(c => !used.has(c.feutre.ref));
      if (rank === -1) rank = 0; // repli improbable : jeu de feutres trop petit
      const chosen = entry.ranked[rank];
      used.add(chosen.feutre.ref);
      entry.point.match = { feutre: chosen.feutre, distance: chosen.distance };
      entry.point.wasAlternative = rank > 0;
      entry.point.conflictRank = rank;
    });
  }

  function sampleColor(x, y) {
    // Moyenne sur une petite zone pour limiter le bruit / compression JPEG
    const radius = 6;
    const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius);
    const w = Math.min(canvas.width - x0, radius * 2);
    const h = Math.min(canvas.height - y0, radius * 2);
    const data = ctx.getImageData(x0, y0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function redrawMarkers() {
    if (!currentImage) return;
    drawImageToCanvas(currentImage);
    currentPoints.forEach((p, i) => {
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
      row.className = 'result-row';
      const correctedRgb = applyWhiteBalance(p.rawRgb);
      const distanceLabel = distanceToLabel(p.match.distance);
      const altTag = p.wasAlternative
        ? `<span class="conflict-tag" title="Le plus proche était déjà pris par un autre numéro">${p.conflictRank + 1}ᵉ choix</span>`
        : '';
      row.innerHTML = `
        <span class="numero-badge">${escapeHtml(p.numero)}</span>
        <span class="hex-chip" style="background:${ColorMath.rgbToHex(correctedRgb)}" title="Couleur lue"></span>
        <span class="arrow">→</span>
        <span class="hex-chip" style="background:${ColorMath.rgbToHex(p.match.feutre.rgb)}" title="Feutre proposé"></span>
        <span class="feutre-ref mono">${escapeHtml(p.match.feutre.ref)}</span>
        ${altTag}
        <span class="confidence ${distanceLabel.cls}">${distanceLabel.text}</span>
      `;
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

  btnSaveScan.addEventListener('click', () => {
    const livre = prompt('Titre du livre :', '') || '';
    const page = prompt('Numéro de page :', '') || '';
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

  let toastTimeout;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), 2200);
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
