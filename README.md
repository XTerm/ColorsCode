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

- **v1.20** : deux corrections suite à un test sur une légende à 20
  pastilles rondes et pâles (thème pastel), qui n'était pas détectée du
  tout. (1) **Bug de fond trouvé** : le seuil de taille minimale était
  calculé en pourcentage de l'image totale — or plus une légende a de
  pastilles, plus chacune est petite, donc ce pourcentage fixe ratait les
  légendes à nombreuses pastilles. Passé à des seuils en pixels absolus.
  (2) Seuil de couleur légèrement assoupli (0.14/0.28 contre 0.22/0.45)
  pour capter les teintes pastel, validé pour ne pas fusionner avec les
  traits de l'illustration (testé : 10/10 et 19/20 sur deux légendes
  réelles, contre 9/10 et 0/20 avant). (3) OCR : teste maintenant 3
  orientations (0°, 90°, -90°) par pastille et garde la meilleure
  confiance, comme suggéré — plus lent mais plus robuste.

- **v1.19** : trois ajouts. (1) **Auto-refresh** : la page se recharge
  automatiquement dès qu'une nouvelle version du service worker prend le
  contrôle, au lieu de continuer à tourner avec l'ancien JS en mémoire
  jusqu'à fermeture manuelle — probable cause de l'impression d'utiliser
  une "vieille version". (2) **Édition/suppression individuelle** : le
  numéro de n'importe quelle pastille (pas seulement la dernière) se
  modifie en touchant son badge, et chaque ligne a son propre bouton de
  suppression — plus besoin d'annuler en cascade pour corriger une seule
  erreur. (3) **OCR expérimental** (case à cocher lors de la détection) :
  tente de lire automatiquement le numéro imprimé sur chaque pastille via
  Tesseract.js chargé à la demande (nécessite internet au premier usage,
  plus lent). Contrairement à l'OCR sur un dessin complet (abandonné),
  les chiffres de légende sont grands et nets — mais cette fonctionnalité
  n'a pas pu être testée en conditions réelles avant livraison, à valider
  à l'usage.

- **v1.18** : "Détection en cours…" restait affiché sans jamais aboutir —
  probablement un calcul bien plus lent sur téléphone que dans mes tests
  (faits sur un serveur), avec un toast éphémère (2.2s) qui disparaissait
  avant la fin, donnant l'impression que rien ne se passait. Deux
  corrections : (1) l'analyse tourne maintenant sur une grille
  sous-échantillonnée (1 pixel sur 2 dans chaque sens), divisant le volume
  de calcul par 4 sans perte de précision sur les pastilles (bien plus
  grandes que 2px) ; (2) le bouton affiche "⏳ Analyse en cours…" et reste
  désactivé jusqu'à la fin réelle du calcul, au lieu d'un toast qui
  disparaît tout seul.

- **v1.17** : retour définitif au `prompt()` natif du système pour le
  numéro de pastille (fiable à 100% quel que soit le zoom, contrairement
  à mes deux tentatives de bulle personnalisée qui cassaient toujours un
  cas de figure). Code de la bulle abandonnée entièrement retiré. Ajout
  d'une vraie remontée d'erreur sur le bouton de détection automatique
  (try/catch + alert du message précis) : si elle échoue à nouveau,
  l'erreur exacte s'affichera au lieu d'un échec silencieux — nécessaire
  pour diagnostiquer le rapport "la détection ne fonctionne pas", que je
  n'ai pas réussi à reproduire en rejouant l'algorithme exact sur l'image
  de test fournie (9/9 détectées côté test).

- **v1.16** : retour au positionnement précédent de la bulle du numéro
  (décalage haut-droite du point tapé) — la version centrée au-dessus
  (v1.15) corrigeait la disposition horizontale mais cassait la
  disposition verticale. **Nouvelle fonctionnalité : détection
  automatique des pastilles** (bouton "🔎 Détecter les pastilles"). Repère
  les blocs de couleur compacts et remplis de l'image (contrairement aux
  traits fins de l'illustration) sans zone à sélectionner à la main, les
  numérote dans l'ordre de lecture (haut→bas, gauche→droite), et laisse
  l'utilisateur corriger les numéros ou ajouter à la main les pastilles
  manquées. Limite connue : les couleurs très pâles/peu saturées (proches
  du blanc de la page) peuvent échapper à la détection automatique.

- **v1.15** : la bulle de saisie du numéro s'ouvrait décalée vers la
  droite du point tapé, ce qui la plaçait exactement sur la pastille
  suivante quand plusieurs pastilles sont alignées horizontalement (le
  cas le plus courant) — empêchant de la toucher. Repositionnée
  au-dessus du point tapé et centrée horizontalement, avec bascule
  automatique en dessous si pas assez de place (bord haut de l'écran).

- **v1.14** : le champ de saisie du numéro de pastille n'imposait qu'un
  clavier numérique — or les légendes peuvent utiliser des lettres (ex :
  1-9, 0, A-F, voire au-delà selon les livres). Passé à un clavier
  standard, avec majuscule automatique pour les lettres.

- **v1.13** : correction d'une régression introduite en v1.12. La modale
  `<dialog>` du numéro de pastille se positionnait par rapport à la page
  entière, pas par rapport à la zone où l'utilisateur était zoomé (pinch-
  zoom) — obligeant à dézoomer pour l'atteindre, contrairement à l'ancien
  `prompt()` qui échappait à ce problème (fenêtre système). Remplacé par
  une bulle de saisie légère, positionnée en `absolute` directement au
  point tapé dans le conteneur du canvas : elle zoome/scrolle avec le
  contenu au lieu de rester figée sur la page. Les autres modales (sauver
  un scan, nouveau jeu) restent inchangées, ce cas ne les concernant pas.

- **v1.12** : quatre améliorations rapides. (1) Modifier une couleur
  existante dans un jeu de feutres (toucher une ligne pour la charger dans
  le formulaire, au lieu de devoir supprimer/recréer). (2) Recherche par
  code dans la liste des feutres d'un jeu. (3) Les `prompt()` natifs du
  navigateur (numéro de pastille, titre/page du scan, nom d'un nouveau
  jeu) sont remplacés par une modale cohérente avec le design de l'app.
  (4) Retour haptique léger sur les interactions clés (ajout d'une
  pastille, étalonnage, choix d'une alternative, suppression).

- **v1.11** : le jeu "Languo 126 Couleurs" est désormais intégré à l'app au
  même titre que GuangNa 240 — disponible automatiquement au premier
  lancement après mise à jour, sans avoir à l'importer manuellement en
  JSON. Le mécanisme de jeux "intégrés" est généralisé pour en supporter
  plusieurs (`BUNDLED_SETS` dans `app.js`), chacun avec sa propre gestion
  de version pour les mises à jour futures.

- **v1.10** : deux corrections importantes sur l'étalonnage. (1) L'image
  affichée dans le scanner est désormais réellement recolorée en direct
  quand on bouge les curseurs Luminosité/Température (avant, seuls les
  résultats changeaient en interne — impossible de comparer visuellement
  avec le livre, ce qui rendait le réglage fin inutilisable). (2)
  L'échantillonnage d'une pastille exclut maintenant les pixels quasi
  blancs/noirs (le chiffre imprimé et son contour) avant de calculer la
  couleur, et utilise une médiane plutôt qu'une moyenne brute — évite que
  le chiffre au centre d'une case fausse la lecture.
- **v1.9** : deux idées reprises de l'outil Révélo. (1) Étalonnage en deux
  temps : après le tap sur une zone blanche (auto), deux curseurs
  "Luminosité" et "Température" permettent un ajustement manuel fin, avec
  recalcul en direct des correspondances. (2) Chaque résultat peut se
  déplier pour voir jusqu'à 5 correspondances alternatives proches ; on
  peut en choisir une manuellement (étiquette "✓ manuel", réversible d'un
  tap) — ce choix est alors respecté lors de la résolution des doublons
  entre numéros.
- **v1.8** : correction d'un bug de fond dans l'étalonnage (base de données
  ET fonction en direct dans le scanner) : la correction visait un blanc
  de référence fixe (~245-250/255) quel que soit le niveau de lumière
  réel capté par la photo, ce qui boostait l'exposition globale en plus
  de corriger la dominante — résultat : toute la palette semblait trop
  claire/pâle par rapport à la réalité. Désormais, seule la dominante
  entre canaux R/G/B est corrigée (gains proches de 1.0), sans toucher à
  l'exposition globale. Base de couleurs regénérée (version 6).
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
