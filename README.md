# Cof2 - Manoeuvres

Module pour **Foundry VTT** et le système **Chroniques Oubliées Fantasy 2** (`co2`). Il ajoute un onglet **Manœuvres** aux fiches de personnages et de rencontres, et automatise les huit manœuvres de COF2 : test opposé, effets sur la cible, durées et rappels en combat.

## Compatibilité

| Élément | Version |
|---|---|
| Foundry VTT | v14 minimum (vérifié en v14) |
| Système COF2 (`co2`) | vérifié en 2.4.0 |

## Installation

1. Dans Foundry VTT, ouvrez **Modules complémentaires** > **Installer un module**.
2. Collez l’URL du manifeste :
   ```text
   https://github.com/Ganodor/cof2-manoeuvres/releases/latest/download/module.json
   ```
3. Cliquez sur **Installer**, puis activez le module dans votre monde.

> Si vous aviez installé la version 1.0.0, la mise à jour vers la 2.0.0 est proposée normalement par Foundry.

## Utilisation

1. Ciblez **un seul** token.
2. Dans l’onglet **Manœuvres** de la fiche, cliquez sur le d20 de la manœuvre voulue.
3. Choisissez les options (mode d’attaque, finesse, modificateur circonstanciel, options propres à la manœuvre), puis lancez le test opposé.
4. Sur une réussite, l’effet est appliqué à la cible et la carte de chat rappelle la règle.

Le test est un **test opposé d’attaque** résolu par le système COF2 (dés bonus/malus, points de chance, carte de chat). Conformément aux règles, il n’y a **pas de réussite critique**. Le modificateur de taille et les rendements décroissants (-5 cumulatif si la manœuvre est répétée contre la même cible durant le combat) sont calculés automatiquement.

## Les manœuvres

| Manœuvre | Effet sur réussite | Durée |
|---|---|---|
| **Distraire** (+CHA) | Surpris (-5 DEF, attaques sournoises) et -10 en PER, coché d’office dans la fenêtre de test | fin du prochain tour de la cible |
| **Gêner** | au choix : Ralenti (une seule action M ou A), ou -5 en attaque affiché dans le champ Malus de la fenêtre d’attaque | fin du prochain tour de la cible |
| **Repousser** | recul de [FOR + 3] m ; si la cible est acculée, autant de malus en DEF | fin du prochain tour de la cible |
| **Bloquer** (-5) | Immobilisé | voir ci-dessous |
| **Désarmer** (-5) | Désarmé | jusqu’à ce que la cible ramasse son arme |
| **Aveugler** (-5) | Aveuglé (-5 attaque au contact et DEF, -10 à distance) | fin du prochain tour de la cible |
| **Renverser** (-5, -10 quadrupède) | Renversé (-5 DEF) | jusqu’à ce que la cible se relève |
| **Étourdir** (-10) | Étourdi (pas d’action, -5 DEF) ; test de CON contre l’assommement si la cible est surprise et de NC inférieur | fin du prochain tour de la cible |

### Bloquer

- Contre une cible de **NC inférieur au niveau de l’attaquant**, la cible reste immobilisée tant que la prise est maintenue. Au début de chaque tour de l’attaquant, un message (MJ et propriétaire de l’attaquant) propose **Maintenir la prise** (test opposé de FOR, avec modificateur de taille) ou **Relâcher la prise**. Un échec, un refus ou un tour sans tentative relâche la prise.
- Sinon, l’immobilisation dure jusqu’à la fin du prochain tour de la cible.

### Renverser et Désarmer

La cible garde l’état jusqu’à ce qu’elle agisse. Les boutons **Se relever (action d’attaque)** et **Ramasser son arme** sont proposés :

- dans la carte de chat de la manœuvre ;
- dans l’onglet Manœuvres de la fiche de la cible ;
- en combat, dans un message au début de chacun de ses tours.

### Étourdir

Si la cible est surprise et de NC inférieur au niveau de l’attaquant, un test de CON (difficulté 10, ou 15 avec une arme contondante) est lancé automatiquement. En cas d’échec, la cible est inconsciente pendant 1d6 minutes.

### Hors combat

Les manœuvres et leurs effets fonctionnent aussi hors combat. Les effets d’un round n’expirent alors pas d’eux-mêmes : la carte de chat propose au MJ un bouton **Retirer l’effet de la manœuvre**. Le maintien de Bloquer est réservé au combat. À la fin d’un combat, le système retire tous les effets temporaires.

## Paramètres

| Paramètre | Portée | Rôle |
|---|---|---|
| Position de l’onglet Manœuvres | client | signet latéral ou barre principale de la fiche |
| Modificateur de taille | monde | par défaut, une cible plus grande impose -5 par catégorie (+5 si elle est plus petite) ; « lecture littérale » inverse ce sens |
| Rendements décroissants | monde | même manœuvre contre la même cible, tous attaquants confondus (par défaut) ou par attaquant |

## Points d’attention

- **Un MJ doit être connecté** : l’application des effets, le suivi des prises, les rappels de début de tour et le test de CON d’Étourdir sont gérés par le client du MJ actif.
- Les déplacements (Repousser, déplacement préalable de 10 m) restent à effectuer à la main ; ils sont rappelés dans la carte de chat.

## Pour les développeurs

Le hook `cof2-manoeuvres.getRollBonuses` permet à un module complémentaire d’ajouter des bonus aux jets de manœuvre :

```js
Hooks.on("cof2-manoeuvres.getRollBonuses", (actor, manoeuvre, context) => {
  if (manoeuvre.id === "renverser" && actor.items.some(i => i.name === "Lutteur")) {
    context.add(2, "Lutteur");
  }
});
```

Identifiants des manœuvres : `distraire`, `gener`, `repousser`, `bloquer`, `desarmer`, `aveugler`, `renverser`, `etourdir`.

## Publier une nouvelle version

1. Mettez à jour `version` et `download` dans `module.json`, puis le `CHANGELOG.md`.
2. Poussez sur `main`, puis créez une **release GitHub** avec un tag au format `vX.Y.Z` (ex. `v2.0.0`).
3. Le workflow `.github/workflows/release.yml` construit `cof2-manoeuvres.zip` et joint l’archive et `module.json` à la release.

## Journal des modifications

Voir [CHANGELOG.md](CHANGELOG.md).
