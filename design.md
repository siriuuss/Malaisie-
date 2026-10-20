---
name: Malaisie 2026 — Intro cinématique
format: 1920x1080 · 16:9 plein cadre · 24 i/s · ~22 s · MP4 sans son
colors:
  # Bleu nuit spatial — scène 1 (espace)
  space-void: "#05070F"
  space-night: "#0B1430"
  space-blue: "#1B2F66"
  atmosphere-halo: "#7FB4FF"
  # Verts jungle profonds — scène 4 (survol)
  jungle-shadow: "#0B2118"
  jungle-deep: "#143826"
  jungle-canopy: "#2A5A33"
  jungle-moss: "#5C7F3A"
  river-teal: "#2E6B6A"
  # Or chaud — lumière, trajet, titre
  gold-deep: "#B9822B"
  gold-warm: "#E3A947"
  gold-light: "#F7D88F"
  # Orange coucher de soleil — scènes 5-6 (KL)
  sunset-orange: "#F2792B"
  sunset-ember: "#C5441C"
  sunset-rose: "#E88A6A"
  # Brume et neutres chauds
  mist-warm: "#F1DDBB"
  haze-gold: "#D9B27A"
  silhouette: "#120C0A"
typography:
  title:
    family: "Cinzel"
    weight: 900
    case: uppercase
    tracking: "0.08em"
    usage: "MALAISIE 2026 — lettres 3D extrudées (biseau doux), matière or chaud métallisé"
  label:
    family: "Montserrat"
    weight: 600
    case: uppercase
    tracking: "0.18em"
    size: "26px (nom) / 16px (sous-titre)"
    usage: "Noms des étapes sur la carte, en français"
  label-sub:
    family: "Montserrat"
    weight: 400
    case: none
    tracking: "0.04em"
    usage: "Sous-titres discrets (ex. « quad dans la jungle »)"
post:
  tonemapping: ACES Filmic
  bloom: "seuil haut, rayon moyen — seuls le soleil, le trajet et les arêtes dorées fleurissent"
  depth-of-field: "bokeh doux, focus sur le sujet de chaque plan"
  vignette: "0.35 d'intensité, coins chauds (pas noirs purs)"
  grade: "ombres teintées sarcelle/vert, hautes lumières or-orangé, saturation contenue"
  fog: "exponentiel, couleur liée au ciel de chaque scène"
---

# Malaisie 2026 — Design spec

## Overview

Une intro de **22 secondes** qui raconte un voyage par un seul mouvement de caméra continu : depuis l'espace jusqu'au sommet d'une flèche des tours Petronas. Le registre visuel est celui d'une **cinématique de jeu vidéo haut de gamme** : 3D stylisée (formes lisibles, pas de photoréalisme), lumière dorée rasante, brume épaisse, bloom maîtrisé, profondeur de champ et étalonnage chaud.

Une phrase pour tout le film : **« De l'espace à la jungle, jusqu'au sommet de Kuala Lumpur. »**

## Palette — rôles

| Famille | Rôle | Où |
| --- | --- | --- |
| Bleu nuit spatial (`space-void` → `space-blue`, `atmosphere-halo`) | Le vide, la face nocturne, le halo bleu du limbe | Scènes 1-2 |
| Or chaud (`gold-deep` → `gold-light`) | La lumière du soleil, la ligne du trajet, les repères, le titre | Fil rouge de tout le film |
| Verts jungle (`jungle-shadow` → `jungle-moss`, `river-teal`) | Canopée, collines, ombres colorées | Scène 4 |
| Orange coucher de soleil (`sunset-orange`, `sunset-ember`, `sunset-rose`) | Ciel de KL, contre-jour final | Scènes 5-6 |
| Brume (`mist-warm`, `haze-gold`) | Brouillard, nappes de brume, nuages éclairés | Transitions 3 → 4 → 5 |

Règle : **l'or est la seule couleur « active »**. Tout ce qui doit attirer l'œil (trajet, repères, titre, soleil) est or ; le reste de la palette sert de décor. Le film glisse du froid (bleu spatial) au chaud (orange couchant) : la température monte avec la descente.

## Typographie

- **Titre — Cinzel Black (900)**, capitales romaines, tracking large. Grande, grasse et élégante : l'empattement fin évoque l'inscription gravée, le poids 900 garde la présence. Rendue en **vraies lettres 3D extrudées** (biseau doux), matière or chaud métallisé qui accroche le soleil et fait fleurir le bloom sur les arêtes.
- **Repères — Montserrat 600**, capitales espacées, blanc chaud (`mist-warm`) avec une fine ombre portée : lisible par-dessus la carte sans concurrencer le titre. Sous-titre en Montserrat 400.
- Polices embarquées en local (fichiers OFL), aucune police système.

## Ambiance par scène

1. **Espace (0-3 s)** — Silence visuel. Terre Blue Marble, couche de nuages légèrement décalée, halo atmosphérique bleu ; le soleil se lève sur le limbe avec un éclat (bloom) or-blanc. Étoiles fixes, à graine.
2. **Itinéraire (3-8 s)** — Lisible et précis. La péninsule malaise en lumière rasante ; une ligne or lumineuse se dessine, repères qui s'allument un par un avec une petite onde.
3. **Plongée (8-10 s)** — Les nuages remplissent tout le cadre, blanc doré, la caméra les traverse : c'est le changement d'échelle.
4. **Survol (10-16 s)** — Moiteur et densité. Jungle vert profond, rivière sarcelle qui reflète le ciel doré, nappes de brume basses, rayons de soleil volumétriques. Le titre or émerge de la brume.
5. **Kuala Lumpur (16-20 s)** — Énergie. Skyline en silhouettes chaudes, ciel orange-rose, tours Petronas argentées qui accrochent le couchant.
6. **Atterrissage (20-22 s)** — Calme et iconique. Contre-jour total : la silhouette noire d'un oiseau sur la flèche, disque solaire derrière. Plan tenu 1 s.

## Caméra

- Un seul « plan-séquence » apparent ; les changements d'échelle sont masqués (nuages, brume).
- Mouvements sur courbes lisses (splines), accélérations/décélérations douces ; pas de coupe sèche.
- Virages légers avec un peu de roulis (banking) pendant le survol, façon oiseau.
- Un seul à-coup volontaire : l'atterrissage sur la flèche.

## Do / Don't

- **Do** : lumière dorée rasante, brume pour la profondeur, contre-jours, or réservé aux éléments importants.
- **Do** : animations 100 % pilotées par le temps de la timeline, aléatoire uniquement à graine fixe.
- **Don't** : bandes noires, noir pur dans les ombres (toujours teinté), sursaturation, textes plats 2D pour le titre, flou de bougé dépendant des images précédentes.
