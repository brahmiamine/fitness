# Pulse — lecteur fitness NXK

Application React/Vite mobile-first qui ouvre les sauvegardes `.nxk` de Notify for Xiaomi et présente les données d’activité, de sommeil, de fréquence cardiaque, de SpO₂ et de stress.

Le lecteur couvre également les intervalles de sommeil, les relevés cardiaques périodiques et rapprochés, les mesures minute par minute, les séances, la batterie, les synchronisations, les compteurs de notifications, les mesures manuelles (poids, tension, glycémie), les rappels santé et l’inventaire complet des tables SQLite.

## Compatibilité et grands historiques

- Le schéma SQLite est découvert à l’import : les colonnes absentes sont neutralisées localement et les colonnes nouvelles restent signalées dans le catalogue au lieu de casser tout l’import.
- Les sauvegardes contenant seulement une partie des domaines santé restent acceptées dès qu’une table exploitable est présente.
- Les calculs quotidiens sont construits en un seul passage sur les mesures, sans rescanner toutes les années pour chaque journée.
- IndexedDB conserve un manifeste léger et une partition par jour. Changer de date ne charge que les données détaillées de cette journée.
- Les graphiques limitent automatiquement le nombre de points rendus et les tableaux affichent les lignes progressivement.
- L’espace disponible est vérifié avant l’import. La limite de sécurité est de 256 Mo pour l’archive et 512 Mo pour la base SQLite extraite ; la capacité réelle dépend de la mémoire et du quota du navigateur.
- Un rapport de qualité contrôle doublons, plages techniques, sommeil, fuseaux, schéma et continuité avant toute interprétation.
- La comparaison reste limitée aux journées du backup sélectionné (7, 30, 90 jours ou toute sa couverture).
- Les courbes proposent une lecture tactile, à la souris et au clavier ; chaque tableau dispose d’une recherche et d’un tri local.
- La carte GPS est facultative et éphémère : la trace brute disparaît au rechargement et n’entre jamais dans IndexedDB.
- Le mode technique expose uniquement la structure et la taille des blocs obfusqués, jamais leurs valeurs, jetons ou secrets.
- Le modèle de données interne est versionné (`schemaVersion: 4`) afin que les futurs adaptateurs puissent migrer les imports sans perdre les sources.

## Confidentialité

- Le fichier est décompressé dans le navigateur avec JSZip.
- La base SQLite est lue localement avec sql.js/WebAssembly.
- Aucun fichier, trajet ou identifiant de montre n’est envoyé vers un serveur.
- Les coordonnées GPS brutes restent uniquement en mémoire volatile pour la carte facultative ; elles ne sont jamais enregistrées et disparaissent au rechargement. Seuls distance, durée, vitesse et altitude sont conservés.
- Les adresses MAC, jetons et paramètres secrets ne sont pas extraits.
- L’historique reste dans IndexedDB, sur l’appareil utilisé.
- Les mesures détaillées sont compartimentées par journée ; l’archive SQLite originale n’est pas conservée.

## Développement

```bash
npm install
npm run dev
```

L’éditeur Visual Truth reste strictement local. Après l’avoir installé avec son plugin, lancez-le avec :

```bash
VISUAL_TRUTH=1 VITE_VISUAL_TRUTH=1 npm run dev
```

## Vérification

```bash
npm test
npm run build
npm run preview
```

## GitHub Pages

Le projet utilise la base Vite `/fitness/`. Le workflow `.github/workflows/deploy.yml` teste, construit puis déploie automatiquement `dist` lors d’un push sur `main`.

Dans **Settings → Pages**, sélectionner **GitHub Actions** comme source lors de la première activation.

## Limites

Les données issues d’un bracelet connecté sont des estimations de bien-être. L’application contextualise les valeurs mais n’établit aucun diagnostic médical.
