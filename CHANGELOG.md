# Journal des modifications

## 2.0.0

Refonte de la résolution des manœuvres : effets appliqués de façon fiable, durées propres à chaque manœuvre et rappels de début de tour.

### Nouveautés

- **Bloquer** : contre une cible de NC inférieur au niveau de l’attaquant, l’immobilisation dure tant que la prise est maintenue. Au début de chaque tour de l’attaquant, un message propose « Maintenir la prise » (test opposé de FOR) ou « Relâcher la prise ». Un échec, un refus ou un tour sans tentative relâche la prise.
- **Renverser** : la cible reste à terre jusqu’à ce qu’elle se relève (action d’attaque). Un bouton « Se relever » est proposé dans la carte de chat, dans l’onglet Manœuvres de la cible et au début de chacun de ses tours.
- **Désarmer** : la cible ramasse son arme quand elle le décide. Un bouton « Ramasser son arme » est proposé dans la carte de chat, dans l’onglet Manœuvres de la cible et au début de chacun de ses tours.
- **Gêner (malus)** : le -5 apparaît dans le champ Malus de la fenêtre d’attaque de la cible (ex. 1d20+7-5) au lieu d’être fondu dans la valeur d’attaque.
- **Distraire** : le -10 en PER est coché d’office dans la fenêtre de test de la cible.
- Les effets s’appliquent aussi hors combat ; le MJ dispose alors d’un bouton « Retirer l’effet de la manœuvre ».
- Nouvelles images plus parlantes pour **Désarmer**, **Aveugler** et **Renverser**.
- Nouveaux paramètres du monde : sens du **modificateur de taille** et portée des **rendements décroissants** (même cible tous attaquants confondus, ou par attaquant).

### Changements de règles

- Le test de manœuvre n’a plus de réussite critique, conformément aux règles.
- Par défaut, une cible plus grande que l’attaquant impose -5 par catégorie de taille (+5 si elle est plus petite). L’ancienne lecture reste disponible dans les paramètres.
- Par défaut, les rendements décroissants (-5 cumulatif) comptent la même manœuvre contre la même cible, quel que soit l’attaquant.
- Les effets d’un round (Distraire, Gêner, Aveugler, Étourdir, Repousser contre une cible acculée) durent jusqu’à la fin du prochain tour de la cible.

### Corrections

- Les effets de manœuvre n’étaient pas toujours appliqués à la cible ; le lien entre le jet et la manœuvre est désormais direct, avec un filet de sécurité côté MJ.
- La fiche de la cible plantait (et ne pouvait plus s’ouvrir) après l’application d’un effet ; les effets existants sont réparés automatiquement au chargement du monde.
- Les rendements décroissants ne s’appliquaient pas quand le jet n’était pas reconnu comme une manœuvre.
- L’onglet Manœuvres ne modifie plus l’état des onglets du système, ce qui pouvait casser l’affichage de la fiche.
- Remplacement du hook déprécié `renderChatMessage` par `renderChatMessageHTML`.

### Technique

- **Compatibilité : Foundry VTT v14 minimum** (la v13 n’est plus prise en charge), système COF2 (`co2`) vérifié en 2.4.0.
- Un MJ doit être connecté pour la résolution automatique des effets, des prises et des rappels.
- Publication via les releases GitHub (manifeste et archive générés automatiquement).

## 1.0.0

- Première version : onglet Manœuvres sur les fiches de personnages et de rencontres, les huit manœuvres de COF2 et leurs jets opposés.
