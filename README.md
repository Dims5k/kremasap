# Kremasap

Ta garde-robe en photos, rangée par catégorie, et des propositions de tenues qui respectent les accords de couleurs, le style, l'occasion et la météo.

## Utilisation

1. Ouvre le site sur ton téléphone.
2. Appuie sur **+ Ajouter** et photographie un vêtement (à plat ou sur cintre, fond uni de préférence). La couleur est détectée automatiquement.
3. Vérifie la catégorie, le style et la saison, puis **Ranger**.
4. Onglet **Tenues** : choisis l'occasion, la météo, éventuellement un style ou une pièce imposée, puis **Proposer 3 tenues**.

Pour l'installer comme une appli : dans Safari, *Partager → Sur l'écran d'accueil* ; dans Chrome, *Installer l'application*.

## Règles de style

Le moteur applique des codes stricts :
- jusqu'à 3 couleurs détectées par pièce avec leur proportion (rayures, logo, colorblock), modifiables dans la fiche ;
- une pièce multicolore est la pièce forte : le reste est neutre ou reprend une de ses couleurs (écho) ;
- une seule couleur forte par tenue, le reste en neutres (noir, blanc, gris, beige, camel, marine, jean, kaki, marron) ;
- trois familles de couleurs au maximum, pas de noir avec des chaussures marron ;
- en superposition, la couche intérieure est toujours neutre et unie ;
- un seul motif ou gros logo par tenue ;
- les **ensembles** (même marque, même couleur, haut + bas) se portent toujours complets ; Kremasap choisit la veste et les chaussures qui vont dessus. L'ensemble est détecté automatiquement quand tu renseignes la même marque et la même couleur ;
- pas de chaussures de ville avec un jogging, pas de short au travail ou par froid.

## Données

Tout reste **sur l'appareil** (IndexedDB). Chaque personne qui ouvre le site a sa propre garde-robe, rien n'est envoyé à un serveur.
Pense à faire **Réglages → Exporter ma garde-robe** de temps en temps : si tu vides les données du navigateur ou changes de téléphone, la sauvegarde permet de tout récupérer.

## IA (optionnel)

Sans configuration, un moteur intégré compose les tenues (neutres + une couleur forte, harmonies ton sur ton, analogues ou complémentaires, cohérence de style et de saison).
Avec une clé API Anthropic (Réglages), Claude remplit aussi la fiche à partir de la photo et compose les tenues. La clé est stockée uniquement sur l'appareil ; chaque appel est facturé sur ce compte Anthropic.

## Technique

Site statique sans dépendance : `index.html`, `style.css`, `app.js`, `sw.js` (hors ligne), `manifest.webmanifest`. Hébergé avec GitHub Pages.
