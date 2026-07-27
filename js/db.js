/**
 * db.js
 * Stockage 100% local (localStorage). Aucune donnée ne quitte l'appareil.
 * Les volumes en jeu sont faibles (quelques dizaines de Ko par jeu de
 * feutres, quelques Ko par scan), largement sous la limite de localStorage :
 * pas besoin d'IndexedDB pour ce cas d'usage, ce qui garde le code simple.
 */

const DB = (() => {
  const KEY_SETS = 'colorscode_sets_v1';
  const KEY_HISTORY = 'colorscode_history_v1';
  const KEY_ACTIVE = 'colorscode_active_set_v1';

  function _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Lecture stockage échouée', key, e);
      return fallback;
    }
  }

  function _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Écriture stockage échouée', key, e);
      return false;
    }
  }

  // ---- Jeux de feutres ----

  function getSets() {
    return _read(KEY_SETS, []);
  }

  function getSet(id) {
    return getSets().find(s => s.id === id) || null;
  }

  function saveSet(set) {
    const sets = getSets();
    const idx = sets.findIndex(s => s.id === set.id);
    if (idx >= 0) sets[idx] = set;
    else sets.push(set);
    _write(KEY_SETS, sets);
  }

  function deleteSet(id) {
    const sets = getSets().filter(s => s.id !== id);
    _write(KEY_SETS, sets);
    if (getActiveSetId() === id) {
      setActiveSetId(sets.length ? sets[0].id : null);
    }
  }

  function getActiveSetId() {
    return _read(KEY_ACTIVE, null);
  }

  function setActiveSetId(id) {
    _write(KEY_ACTIVE, id);
  }

  // ---- Historique des scans ----

  function getHistory() {
    return _read(KEY_HISTORY, []);
  }

  function saveScan(scan) {
    const history = getHistory();
    history.unshift(scan); // le plus récent en premier
    _write(KEY_HISTORY, history);
  }

  function deleteScan(id) {
    const history = getHistory().filter(s => s.id !== id);
    _write(KEY_HISTORY, history);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    getSets, getSet, saveSet, deleteSet,
    getActiveSetId, setActiveSetId,
    getHistory, saveScan, deleteScan,
    uid
  };
})();
