# ColorsCode

PWA légère pour retrouver quel feutre utiliser sur un coloriage mystère, à
partir d'une photo de la légende. 100% côté client, aucune donnée envoyée
sur un serveur.

## Déployer sur GitHub Pages

1. Copie tout le contenu de ce dossier (`index.html`, `css/`, `js/`,
   `data/`, `icons/`, `manifest.json`, `sw.js`) à la racine de ton repo
   `XTerm/ColorsCode`, branche `main`.
2. Commit + push.
3. Dans Settings → Pages, vérifie que la source est bien `main` / `/root`
   (déjà configuré normalement).
4. Attends 1-2 minutes, puis ouvre `https://xterm.github.io/ColorsCode/`.

## Installer sur le téléphone Android

1. Ouvre l'URL ci-dessus dans Chrome sur le téléphone.
2. Menu (⋮) → **Ajouter à l'écran d'accueil** (ou une bannière d'installation
   apparaît automatiquement après quelques secondes).
3. L'icône ColorsCode apparaît comme une app normale, et fonctionne ensuite
   hors-ligne.

## Utilisation

1. Onglet **Feutres** : le jeu "GuangNa 240 Couleurs" est chargé par défaut
   à la première ouverture. Tu peux en ajouter d'autres (import JSON ou
   saisie manuelle).
2. Onglet **Scanner** : choisis le jeu actif, prends en photo la légende du
   coloriage, puis touche chaque pastille numérotée. L'appli te donne
   immédiatement le feutre le plus proche.
3. **Enregistrer ce scan** garde le résultat dans l'historique (titre du
   livre + page), consultable dans l'onglet **Historique**.

## Format d'un jeu de feutres (pour import JSON)

```json
{
  "id": "mon-jeu",
  "nom": "Mon jeu de feutres",
  "feutres": [
    { "ref": "001", "rgb": [230, 40, 35] },
    { "ref": "002", "rgb": [255, 200, 0] }
  ]
}
```

## Notes techniques

- **Matching couleur** : distance perceptuelle CIEDE2000 (pas une distance
  RGB brute), voir `js/colorMath.js`.
- **Stockage** : `localStorage` (pas IndexedDB — volumes de données trop
  faibles pour que ça soit nécessaire, et ça simplifie le code).
- **Hors-ligne** : Service Worker (`sw.js`) qui met en cache la coquille
  de l'app au premier chargement.
- **Pas de build step** : HTML/CSS/JS vanilla, aucune installation
  nécessaire pour développer ou déployer.

## Limites connues (V1)

- Sélection des pastilles manuelle (tap un par un), pas de détection
  automatique.
- Pas de calibration colorimétrique : la fiabilité dépend de l'éclairage au
  moment de la photo. Conseil affiché nulle part encore dans l'UI — à
  ajouter si besoin : "photographier à la lumière du jour, sans flash".
- Pas d'export/partage du résultat (V2).
