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
- L'étalonnage (v1.1) corrige une dominante de couleur globale et uniforme.
  Il ne corrige pas un éclairage inégal sur la photo (ex : un coin plus
  sombre qu'un autre) — dans ce cas, privilégier une lumière du jour aussi
  homogène que possible, sans flash.
- Pas d'export/partage du résultat (V2).

## Historique des versions

- **v1.7** : correction majeure de l'extraction du nuancier réel. Deux bugs
  identifiés : (1) la grille de positions dérivait sur certaines lignes,
  faisant échantillonner le fond blanc au lieu du cercle (ex : toute la
  ligne des violets ressortait blanche) — corrigé par une détection locale
  du centre de chaque pastille (différence au fond local) plutôt qu'une
  grille figée ; (2) la correction de balance des blancs écrasait les
  couleurs pastel en blanc pur en écrêtant chaque canal RGB indépendamment
  — corrigé en préservant les proportions (donc la teinte) lors de
  l'écrêtage. 240/240 codes désormais correctement mesurés.
- **v1.6** : retrait du code "110" (erroné, propre au chart digital du
  fabricant — confirmé absent du set physique réel par l'utilisateur).
  "607" est désormais confirmé plutôt que marqué incertain. La base
  compte maintenant exactement 240 feutres, tous mesurés sur encre réelle.
- **v1.5** : bouton "Prendre une photo" et bouton "Choisir un fichier"
  séparés. L'attribut `capture` forçait l'ouverture directe de l'appareil
  photo sur Android et empêchait de choisir une image déjà existante
  (galerie, Téléchargements, Drive…).
- **v1.4** : correction du code 774 (confirmé manuellement par l'utilisateur
  sur le nuancier physique — la confusion d'écriture 2/4 était sur l'autre
  occurrence que celle supposée en v1.3). Il ne reste plus qu'un seul code
  à confiance réduite (607) sur 241.
- **v1.3** : base de couleurs GuangNa 240 remplacée par une mesure sur
  encre réelle (nuancier physiquement colorié à la main, étalonné par zone
  blanche de référence), au lieu du chart marketing du fabricant. Écart
  moyen mesuré entre les deux sources : ΔE ≈ 16.6 (largement perceptible),
  ce qui confirme que le chart marketing ne représentait pas fidèlement
  l'encre réelle. Mise à jour automatique du jeu par défaut à l'ouverture
  de l'app (les jeux personnalisés ne sont pas affectés).
- **v1.2** : historique cliquable — chaque scan affiche désormais les
  codes feutre directement dans l'aperçu, et un tap ouvre le détail
  complet (mêmes infos que dans le scanner) avec l'option de suppression
  déplacée dans ce détail.
- **v1.1** : étalonnage manuel de la balance des blancs (tap sur une zone
  blanche de la page) + garantie qu'un même feutre n'est jamais assigné à
  deux numéros différents de la légende (résolution globale des conflits,
  avec repli automatique sur le meilleur choix encore disponible).
- **v1.0** : version initiale.
