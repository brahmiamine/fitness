# Pulse — lecteur fitness NXK

Application React/Vite mobile-first qui ouvre les sauvegardes `.nxk` de Notify for Xiaomi et présente les données d’activité, de sommeil, de fréquence cardiaque, de SpO₂ et de stress.

## Confidentialité

- Le fichier est décompressé dans le navigateur avec JSZip.
- La base SQLite est lue localement avec sql.js/WebAssembly.
- Aucun fichier, trajet ou identifiant de montre n’est envoyé vers un serveur.
- L’historique reste dans IndexedDB, sur l’appareil utilisé.

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
