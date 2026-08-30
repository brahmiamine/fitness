# Pulse design system

## Direction

Scène : consultation rapide après une marche, téléphone tenu dehors en lumière naturelle. La surface reste blanche et nette ; l’ambre apporte l’énergie et le bleu pétrole crédibilise les données.

## Color

- `--bg`: `oklch(1 0 0)` — fond principal.
- `--surface`: `oklch(0.97 0.008 78)` — regroupements et graphiques.
- `--ink`: `oklch(0.22 0.025 65)` — texte principal.
- `--muted`: `oklch(0.44 0.018 65)` — texte secondaire.
- `--primary`: `oklch(0.53 0.15 70)` — action principale, sélection et activité.
- `--accent`: `oklch(0.43 0.1 195)` — données physiologiques et liens.
- `--focus`: `oklch(0.48 0.14 250)` — focus clavier.
- États : succès vert, attention ambre, alerte rouge, information bleu ; jamais utilisés comme décoration.

## Typography

Une seule famille système : `Inter, ui-sans-serif, system-ui, sans-serif`. Corps 16 px / 1.5 sur mobile, utilitaires 13–14 px, titres de section 20–24 px, chiffres de synthèse 28–36 px. Les données utilisent des chiffres tabulaires.

## Layout

Mobile-first avec gouttière 16 px, contenu maximal 1180 px, rupture principale à 760 px et rupture large à 1040 px. Le mobile utilise une navigation inférieure à cinq destinations maximum. Le bureau conserve la même hiérarchie avec navigation latérale.

## Shape and elevation

Rayons 10, 12 et 16 px. Les surfaces sont séparées par la couleur et l’espacement ; les ombres ne servent qu’aux éléments flottants. Boutons et zones tactiles : hauteur minimale 44 px.

## Signature

La « ligne de journée » relie sommeil, activité, cœur et récupération sur un axe temporel commun. Sur mobile elle défile horizontalement ; sur grand écran elle occupe toute la largeur. Elle constitue le seul élément identitaire fort du tableau de bord.

## Motion

Transitions d’état de 180 ms avec courbe de sortie. Aucun mouvement décoratif. Avec `prefers-reduced-motion`, les transitions deviennent instantanées.
