/* ==========================================================================
   1. CONSTANTES DU MODULE ET ENREGISTREMENT DES ÉTATS & PARAMÈTRES (INIT)
   ========================================================================== */

const MODULE_ID = "cof2-manoeuvres";
const pendingManoeuvreRolls = new Map();
const processingManoeuvreResults = new Set();
const activeManoeuvreActors = new Set();
// Seuil de critique inatteignable : les manœuvres n'ont pas de notion de réussite critique
const NO_CRITICAL_THRESHOLD = "100";

Hooks.once("init", () => {
  // Requête joueur → MJ : relâcher une prise de Bloquer (la cible appartient souvent au MJ)
  CONFIG.queries ??= {};
  CONFIG.queries[`${MODULE_ID}.releaseBlock`] = data => handleReleaseBlockQuery(data);

  const manoeuvreStatuses = [
    {
      id: "manoeuvre-desarmer",
      name: "Désarmé (Manœuvre)",
      img: "icons/skills/melee/strike-sword-slashing-red.webp"
    },
    {
      id: "manoeuvre-blind",
      name: "Aveuglé (Manœuvre)",
      img: "icons/svg/blind.svg"
    },
    {
      id: "manoeuvre-overturned",
      name: "Renversé (Manœuvre)",
      img: "systems/co2/ui/effects/upsidedown.webp"
    }
  ];
  for (const status of manoeuvreStatuses) {
    if (!CONFIG.statusEffects.some(effect => effect.id === status.id)) CONFIG.statusEffects.push(status);
  }

  game.settings.register(MODULE_ID, "tabPlacement", {
    name: "Position de l'onglet Manœuvres",
    hint: "Choisissez d'afficher l'onglet Manœuvres sous forme de signet latéral à droite de la fiche ou directement dans la barre principale entre Voies & Capacités et Effets.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      side: "Sur le côté droit",
      main: "Dans la barre principale"
    },
    default: "side",
    onChange: () => {
      for (const app of Object.values(ui.windows || {})) {
        if (app.actor || app.document?.documentName === "Actor") app.render(false);
      }
      if (foundry?.applications?.instances) {
        for (const app of foundry.applications.instances.values()) {
          if (app.actor || app.document?.documentName === "Actor") app.render(false);
        }
      }
    }
  });

  game.settings.register(MODULE_ID, "sizeModifierDirection", {
    name: "Modificateur de taille",
    hint: "Sens du modificateur de ±5 par catégorie de taille. « Cible plus grande = malus » : il est plus difficile de manœuvrer une créature plus grande que soi. « Lecture littérale » : -5 par catégorie de taille de moins de la cible, +5 par catégorie de plus.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      biggerTargetHarder: "Cible plus grande = malus",
      literal: "Lecture littérale (cible plus grande = bonus)"
    },
    default: "biggerTargetHarder"
  });

  game.settings.register(MODULE_ID, "diminishingScope", {
    name: "Rendements décroissants",
    hint: "Le malus cumulatif de -5 s'applique quand une manœuvre est répétée contre la même cible : quel que soit l'attaquant, ou seulement pour un même attaquant.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      target: "Même cible, tous attaquants confondus",
      attacker: "Même cible et même attaquant"
    },
    default: "target"
  });
});

/* ==========================================================================
   2. UTILITAIRE DOM & DÉFINITION DES 8 MANŒUVRES DE COF2
   ========================================================================== */

function resolveHtmlElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (typeof html.get === "function") return html.get(0) || null;
  if (Array.isArray(html) || typeof html.length === "number") return html.item ? html.item(0) : Reflect.get(html, 0) || null;
  return null;
}

const MANOEUVRES_LIST = [
  {
    id: "distraire",
    name: "Distraire",
    modifierLabel: "+CHA",
    modValue: 0,
    useCha: true,
    sizeSensitive: false,
    img: "icons/tools/instruments/lute-gold-brown.webp",
    summary: "Malus de -10 en PER et -5 en DEF pendant 1 round (cible surprise pour attaques sournoises).",
    description: "<p><strong>Distraire (+CHA) — Action limitée (L)</strong></p><p>La cible subit un malus de <strong>-10 à tous ses tests de PER</strong> et <strong>-5 en DEF</strong> pendant 1 round. Elle est considérée comme <em>surprise</em> pour les attaques sournoises.</p>"
  },
  {
    id: "gener",
    name: "Gêner",
    modifierLabel: "-",
    modValue: 0,
    useCha: false,
    sizeSensitive: false,
    img: "icons/magic/control/debuff-chains-purple.webp",
    summary: "Au choix : cible ralentie (1 seule action M ou A) ou -5 en attaque pendant 1 round.",
    description: "<p><strong>Gêner (-) — Action limitée (L)</strong></p><p>Au choix, la cible est <em>ralentie</em> (une seule action M ou A) ou elle subit <strong>-5 en attaque</strong> pendant 1 round.</p>"
  },
  {
    id: "repousser",
    name: "Repousser",
    modifierLabel: "-*",
    modValue: 0,
    useCha: false,
    sizeSensitive: true,
    img: "icons/skills/melee/unarmed-punch-fist-yellow-red.webp",
    summary: "Recule de [FOR + 3] m. Si acculée : perd autant en DEF pendant 1 round. Déplacement de 10 m possible avant.",
    description: "<p><strong>Repousser (-)* — Action limitée (L)</strong></p><p>La cible recule de <strong>[FOR de l'attaquant + 3] mètres</strong> et l'attaquant occupe le terrain libéré. Si la cible est acculée (mur, précipice, adversaire), elle perd autant en DEF pour 1 round. Cette action peut être précédée d'un déplacement de 10 m en direction de la cible.</p><p><em>* -5 au test par catégorie de taille de moins par rapport à celle de l'attaquant, +5 par catégorie de taille de plus.</em></p>"
  },
  {
    id: "bloquer",
    name: "Bloquer",
    modifierLabel: "-5*",
    modValue: -5,
    useCha: false,
    sizeSensitive: true,
    img: "icons/magic/control/debuff-chains-ropes-net-white.webp",
    summary: "Cible immobilisée 1 round (dé malus en attaque, pas de déplacement). Maintien possible par test opposé de FOR.",
    description: "<p><strong>Bloquer (-5)* — Action limitée (L)</strong></p><p>La cible est <em>immobilisée</em> pendant 1 round (dé malus en attaque et pas de déplacement). Contre une créature de NC inférieur au niveau de l'attaquant, ce dernier peut maintenir sa prise à chaque round qui suit en emportant un <strong>test opposé de FOR</strong> (action limitée, modifiée en cas de différence de taille).</p><p><em>* -5 au test par catégorie de taille de moins par rapport à celle de l'attaquant, +5 par catégorie de taille de plus.</em></p>"
  },
  {
    id: "desarmer",
    name: "Désarmer",
    modifierLabel: "-5*",
    modValue: -5,
    useCha: false,
    sizeSensitive: true,
    img: "icons/skills/melee/hand-grip-sword-orange.webp",
    summary: "La cible laisse tomber son arme au sol (doit sacrifier son prochain tour pour la ramasser).",
    description: "<p><strong>Désarmer (-5)* — Action limitée (L)</strong></p><p>La cible laisse tomber son arme au sol. Elle peut la ramasser avant tout le monde en sacrifiant son prochain tour (elle n'agira pas).</p><p><em>* -5 au test par catégorie de taille de moins par rapport à celle de l'attaquant, +5 par catégorie de taille de plus.</em></p>"
  },
  {
    id: "aveugler",
    name: "Aveugler",
    modifierLabel: "-5",
    modValue: -5,
    useCha: false,
    sizeSensitive: false,
    img: "icons/creatures/eyes/humanoid-single-blind.webp",
    summary: "Cible aveuglée 1 round (-5 en attaque au contact et en DEF, -10 contre une cible à distance).",
    description: "<p><strong>Aveugler (-5) — Action limitée (L)</strong></p><p>La cible est <em>aveuglée</em> pendant 1 round (-5 en attaque au contact et en DEF, -10 contre une cible à distance).</p>"
  },
  {
    id: "renverser",
    name: "Renverser",
    modifierLabel: "-5, -10 quadrupède*",
    modValue: -5,
    useCha: false,
    sizeSensitive: true,
    img: "icons/magic/control/silhouette-fall-slip-prone.webp",
    summary: "Cible renversée (-5 en DEF, action d'attaque pour se relever). Déplacement de 10 m possible avant.",
    description: "<p><strong>Renverser (-5, -10 contre un quadrupède)* — Action limitée (L)</strong></p><p>La cible est <em>renversée</em> (-5 en DEF et action d'attaque pour se relever). Cette action peut être précédée d'un déplacement de 10 m en direction de la cible.</p><p><em>* -5 au test par catégorie de taille de moins par rapport à celle de l'attaquant, +5 par catégorie de taille de plus.</em></p>"
  },
  {
    id: "etourdir",
    name: "Étourdir",
    modifierLabel: "-10*",
    modValue: -10,
    useCha: false,
    sizeSensitive: true,
    img: "icons/skills/wounds/injury-face-impact-orange.webp",
    summary: "Cible étourdie 1 round (pas d'action, -5 en DEF). Si surprise et NC < niveau : test CON 10/15 ou assommée 1d6 min.",
    description: "<p><strong>Étourdir (-10)* — Action limitée (L)</strong></p><p>La cible est <em>étourdie</em> pendant 1 round (pas d'action et -5 en DEF). Si cette manœuvre est réussie contre une cible <em>surprise</em> de NC inférieur au niveau de l'attaquant, elle doit réussir un <strong>test de CON difficulté 10</strong> (15 si l'attaquant utilise une arme qui inflige des DM contondants) ou être assommée (inconsciente) pour 1d6 min.</p><p><em>* -5 au test par catégorie de taille de moins par rapport à celle de l'attaquant, +5 par catégorie de taille de plus.</em></p>"
  }
];

/* ==========================================================================
   3. CALCUL DES CARACTÉRISTIQUES, BONUS D'OBJETS/EFFETS ET RÉPÉTITIONS
   ========================================================================== */

function getActorAbilityTotal(actor, abilityKey) {
  const ab = actor?.system?.abilities?.[abilityKey];
  if (!ab) return 0;
  if (typeof ab.total === "number") return ab.total;
  if (typeof ab.value === "number") return ab.value;

  const base = Number(ab.base ?? 0) || 0;
  const sheetBonus = Number(ab.bonuses?.sheet ?? 0) || 0;
  const effectBonus = Number(ab.bonuses?.effects ?? 0) || 0;
  return base + sheetBonus + effectBonus;
}

function getActorChaMod(actor) {
  return getActorAbilityTotal(actor, "cha");
}

function getActorManeuverRank(actor) {
  const rank = actor?.type === "encounter"
    ? actor.system?.attributes?.nc
    : actor?.system?.attributes?.level;
  const value = Number(rank);
  return Number.isFinite(value) ? value : null;
}

function getActorNC(actor) {
  if (actor?.type !== "encounter") return null;
  const value = Number(actor.system?.attributes?.nc);
  return Number.isFinite(value) ? value : null;
}

function isEligibleForStunSave(attacker, target, isSurprised = false) {
  const attackerRank = getActorManeuverRank(attacker);
  const targetRank = getActorNC(target);
  return (isSurprised || target?.statuses?.has("surprised"))
    && attackerRank !== null && targetRank !== null && targetRank < attackerRank;
}

// Collecte les bonus natifs (subtype === "manoeuvre") et laisse les extensions (ex. Cof2 - Manoeuvres +) injecter les leurs
function getManoeuvreItemAndEffectBonuses(actor, manoeuvre) {
  if (!actor) return { total: 0, sources: [] };

  const context = {
    total: 0,
    sources: [],
    add(value, label) {
      const val = Number(value);
      if (!Number.isFinite(val) || val === 0) return;
      this.total += val;
      this.sources.push(`${label} ${val >= 0 ? "+" : ""}${val}`);
    }
  };

  const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const targetId = normalize(manoeuvre.id);

  for (const item of actor.items) {
    const sys = item.system || {};
    if (sys.equipped === false) continue;
    if (typeof sys.learned === "boolean" && !sys.learned) continue;
    if (typeof sys.acquired === "boolean" && !sys.acquired) continue;

    if (Array.isArray(sys.actions)) {
      sys.actions.forEach((action) => {
        if (!Array.isArray(action.modifiers)) return;
        const requiresEquip = Array.isArray(action.conditions) && action.conditions.some(c => c.predicate === "isEquipped");
        if (requiresEquip && sys.equipped !== true) return;

        action.modifiers.forEach((mod) => {
          if (mod?.subtype !== "manoeuvre") return;
          const modTarget = normalize(mod.target || "all");
          if (modTarget === "all" || modTarget === targetId) {
            context.add(mod.value, item.name);
          }
        });
      });
    }
  }

  // Permet aux modules complémentaires (comme Cof2 - Manoeuvres +) d'ajouter leurs modificateurs
  Hooks.callAll("cof2-manoeuvres.getRollBonuses", actor, manoeuvre, context);

  return { total: context.total, sources: context.sources };
}

function getSizeRank(actor) {
  const sizes = Object.keys(game.system?.CONST?.TOKEN_SIZE || {});
  const size = actor?.system?.details?.size;
  const index = sizes.indexOf(size);
  return index < 0 ? null : index;
}

function getSizeModifier(attacker, target) {
  const attackerSize = getSizeRank(attacker);
  const targetSize = getSizeRank(target);
  if (attackerSize === null || targetSize === null) return 0;
  const direction = game.settings.get(MODULE_ID, "sizeModifierDirection") === "literal" ? 1 : -1;
  return (targetSize - attackerSize) * 5 * direction;
}

// Le système COF2 attend comme source d'un effet l'UUID d'un objet (Actor.X.Item.Y ou Scene.S.Token.T.Actor.X.Item.Y) :
// avec l'UUID nu d'un acteur, CustomEffectData#sourceParts ne retrouve pas l'acteur et la fiche de la cible plante.
// On ajoute donc un identifiant d'objet fictif : l'acteur est retrouvé, l'objet est simplement absent.
const EFFECT_SOURCE_ITEM_ID = "cof2Manoeuvres00";
function getEffectSourceUuid(actorUuid) {
  if (!actorUuid) return null;
  return actorUuid.includes(".Item.") ? actorUuid : `${actorUuid}.Item.${EFFECT_SOURCE_ITEM_ID}`;
}

// Répare les effets de manœuvre créés par les versions précédentes (source = UUID nu de l'acteur),
// qui empêchaient d'ouvrir la fiche de la cible.
async function repairManoeuvreEffectSources() {
  const actors = new Set(game.actors.contents);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.add(token.actor);
    }
  }

  let repaired = 0;
  for (const actor of actors) {
    const effects = actor.system?.toObject?.().currentEffects;
    if (!Array.isArray(effects) || effects.length === 0) continue;
    let changed = false;
    for (const effect of effects) {
      if (!effect.slug?.startsWith("manoeuvre-")) continue;
      const fixedSource = getEffectSourceUuid(effect.source);
      if (fixedSource && fixedSource !== effect.source) {
        effect.source = fixedSource;
        changed = true;
      }
      for (const modifier of effect.modifiers ?? []) {
        const fixedModifierSource = getEffectSourceUuid(modifier.source);
        if (fixedModifierSource && fixedModifierSource !== modifier.source) {
          modifier.source = fixedModifierSource;
          changed = true;
        }
      }
    }
    if (!changed) continue;
    try {
      await actor.update({ "system.currentEffects": effects });
      repaired++;
    } catch (error) {
      console.error(`${MODULE_ID} | Réparation des effets impossible pour ${actor.name} :`, error);
    }
  }
  if (repaired) ui.notifications.info(`Cof2 - Manœuvres : effets réparés sur ${repaired} acteur(s).`);
}

// Les malus de test imposés par une manœuvre (ex. Distraire : -10 en PER) s'appliquent d'office :
// on les présélectionne dans la fenêtre de test du système (champ `selected` lu par le modèle Handlebars).
function isManoeuvreSkillBonus(bonus) {
  return bonus?.sourceType === "CustomEffectData"
    && (bonus.additionalInfos === "Manœuvre" || String(bonus.name || "").startsWith("Manœuvre :"));
}

Hooks.once("setup", () => {
  if (game.system.id !== "co2") return;
  const proto = CONFIG.Actor.documentClass?.prototype;
  const original = proto?.getSkillBonuses;
  if (typeof original !== "function" || original._cof2ManoeuvresWrapped) return;

  const wrapped = function (...args) {
    const bonuses = original.apply(this, args);
    if (!Array.isArray(bonuses)) return bonuses;
    for (const bonus of bonuses) {
      if (isManoeuvreSkillBonus(bonus)) bonus.selected = true;
    }
    return bonuses;
  };
  wrapped._cof2ManoeuvresWrapped = true;
  proto.getSkillBonuses = wrapped;

  // Gêner : ajoute le -5 au champ Malus des jets d'attaque (formule 1d20+7-5 plutôt que 1d20+2)
  const originalRollAttack = proto.rollAttack;
  if (typeof originalRollAttack === "function" && !originalRollAttack._cof2ManoeuvresWrapped) {
    const wrappedRollAttack = function (item, options = {}, ...rest) {
      const type = options?.type ?? "attack";
      if (type === "attack" && !options?.auto && hasGenerAttackPenalty(this)) {
        options = { ...options, skillMalus: (Number(options.skillMalus) || 0) + GENER_ATTACK_PENALTY };
      }
      return originalRollAttack.call(this, item, options, ...rest);
    };
    wrappedRollAttack._cof2ManoeuvresWrapped = true;
    proto.rollAttack = wrappedRollAttack;
  }

  // Fin de combat : le système appelle deleteEffects() deux fois en parallèle (Combat#_onDelete et hook deleteCombat).
  // Le second passage tente de retirer des statuts déjà supprimés (ex. Aveuglé) et lève une erreur.
  // On partage la même promesse tant qu'un nettoyage est en cours pour un acteur.
  const originalDeleteEffects = proto.deleteEffects;
  if (typeof originalDeleteEffects === "function" && !originalDeleteEffects._cof2ManoeuvresWrapped) {
    const pendingCleanups = new Map();
    const wrappedDeleteEffects = function (...args) {
      const key = this.uuid;
      if (pendingCleanups.has(key)) return pendingCleanups.get(key);
      const promise = Promise.resolve(originalDeleteEffects.apply(this, args))
        .finally(() => pendingCleanups.delete(key));
      pendingCleanups.set(key, promise);
      return promise;
    };
    wrappedDeleteEffects._cof2ManoeuvresWrapped = true;
    proto.deleteEffects = wrappedDeleteEffects;
  }
});

Hooks.once("ready", () => {
  if (game.system.id !== "co2" || game.users.activeGM?.id !== game.user.id) return;
  repairManoeuvreEffectSources().catch(error => console.error(`${MODULE_ID} | Échec de la réparation des effets :`, error));
});

function buildEffectModifier(actor, subtype, target, value) {
  return {
    source: getEffectSourceUuid(actor.uuid),
    type: "feature",
    subtype,
    target,
    apply: "others",
    value: String(value),
    choiceGroup: 0,
    additionalInfos: "Manœuvre"
  };
}

function buildManoeuvreEffect(actor, manoeuvre, options, attackerTokenId) {
  const statuses = [];
  const modifiers = [];
  const duration = "1";
  let hasTimedEffect = true;
  let name = `Manœuvre : ${manoeuvre.name}`;
  let slugSuffix = "";

  switch (manoeuvre.id) {
    case "distraire":
      statuses.push("surprised");
      modifiers.push(buildEffectModifier(actor, "skill", "per", -10));
      break;
    case "gener":
      if (options.generChoice === "attackPenalty") {
        // Pas de modificateur de combat (il serait fondu dans @atc/@atd/@atm) : le -5 est ajouté
        // au champ Malus de la fenêtre d'attaque, cf. le wrapper de rollAttack
        name = `Manœuvre : ${manoeuvre.name} (${GENER_ATTACK_PENALTY} en attaque)`;
        slugSuffix = GENER_ATTACK_SLUG_SUFFIX;
      } else {
        statuses.push("slowed");
      }
      break;
    case "repousser":
      if (options.isCornered) {
        const strength = getActorAbilityTotal(actor, "for");
        modifiers.push(buildEffectModifier(actor, "combat", "def", -(strength + 3)));
      } else {
        hasTimedEffect = false;
      }
      break;
    case "bloquer":
      statuses.push("immobilized");
      break;
    case "aveugler":
      statuses.push("manoeuvre-blind");
      modifiers.push(
        buildEffectModifier(actor, "combat", "melee", -5),
        buildEffectModifier(actor, "combat", "ranged", -10),
        buildEffectModifier(actor, "combat", "def", -5)
      );
      break;
    case "renverser":
      statuses.push("manoeuvre-overturned");
      modifiers.push(buildEffectModifier(actor, "combat", "def", -5));
      break;
    case "etourdir":
      statuses.push("stun");
      break;
    case "desarmer":
      hasTimedEffect = false;
      break;
  }

  if (!hasTimedEffect) return null;

  const attackerId = attackerTokenId || actor.id;
  return {
    name,
    source: getEffectSourceUuid(actor.uuid),
    statuses: [...new Set(statuses)],
    unit: getManoeuvreEffectUnit(manoeuvre.id, options),
    duration,
    startedAt: game.combat?.round ?? 0,
    remainingTurn: 1,
    modifiers,
    formula: "",
    formulaType: "damage",
    elementType: "",
    slug: `manoeuvre-${attackerId}-${manoeuvre.id}${slugSuffix}`
  };
}

/* --- Durée des effets ---
   - Par défaut (Distraire, Gêner, Aveugler, Étourdir, Repousser acculé, Bloquer sans maintien possible) :
     unité « round » du système → l'effet couvre le prochain tour de la cible et expire à la fin de ce tour.
   - Effets persistants (unité « unlimited », jamais expirés par le système, retirés par le module) :
     • Renverser : jusqu'à ce que la cible se relève (bouton « Se relever ») ;
     • Bloquer avec maintien possible : jusqu'à ce que le lanceur relâche la prise ou rate son test de FOR.
   - Désarmer : simple état, retiré par le bouton « Ramasser son arme ». */
const PERSISTENT_EFFECT_UNIT = "unlimited";

function getManoeuvreEffectUnit(manoeuvreId, options = {}) {
  if (manoeuvreId === "renverser") return PERSISTENT_EFFECT_UNIT;
  if (manoeuvreId === "bloquer" && options.canMaintainBlock) return PERSISTENT_EFFECT_UNIT;
  return "round";
}

function findManoeuvreEffects(actor, manoeuvreId) {
  return (actor?.system?.currentEffects ?? []).filter(effect =>
    effect.slug?.startsWith("manoeuvre-") && effect.slug.includes(`-${manoeuvreId}`));
}

async function postManoeuvreNote(actor, text) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="mv-man-block-prompt">${escapeHtml(text)}</div>`
  });
}

// Renverser : la cible consacre une action d'attaque pour se relever
async function standUp(actor) {
  if (!actor?.isOwner) {
    ui.notifications.warn("Vous devez contrôler ce personnage pour le relever.");
    return;
  }
  const effects = findManoeuvreEffects(actor, "renverser");
  if (!effects.length && !actor.statuses?.has("manoeuvre-overturned")) {
    ui.notifications.info(`${actor.name} n’est pas à terre.`);
    return;
  }
  for (const effect of effects) await actor.deleteCustomEffect(effect);
  if (actor.statuses?.has("manoeuvre-overturned")) {
    await actor.activateCOStatusEffect({ state: false, effectid: "manoeuvre-overturned" });
  }
  await postManoeuvreNote(actor, `${actor.name} se relève (action d’attaque).`);
}

// Désarmer : la cible ramasse son arme quand elle le décide
async function pickUpWeapon(actor) {
  if (!actor?.isOwner) {
    ui.notifications.warn("Vous devez contrôler ce personnage pour ramasser son arme.");
    return;
  }
  if (!actor.statuses?.has("manoeuvre-desarmer")) {
    ui.notifications.info(`${actor.name} n’est pas désarmé(e).`);
    return;
  }
  await actor.activateCOStatusEffect({ state: false, effectid: "manoeuvre-desarmer" });
  await postManoeuvreNote(actor, `${actor.name} ramasse son arme.`);
}

// Gêner (option malus) : -5 affiché dans le champ Malus de toute fenêtre d'attaque de la cible gênée
const GENER_ATTACK_PENALTY = -5;
const GENER_ATTACK_SLUG_SUFFIX = "-attaque";

function hasGenerAttackPenalty(actor) {
  return Boolean(actor?.system?.currentEffects?.some(effect =>
    effect.slug?.startsWith("manoeuvre-") && effect.slug.endsWith(`-gener${GENER_ATTACK_SLUG_SUFFIX}`)));
}

function getHistoryKey(attackerTokenId, attackerActorId, targetTokenId, manoeuvreId) {
  if (game.settings.get(MODULE_ID, "diminishingScope") === "target") return `any:${targetTokenId}:${manoeuvreId}`;
  return `${attackerTokenId || attackerActorId}:${targetTokenId}:${manoeuvreId}`;
}

function getDiminishingReturnsCount(attackerTokenId, actor, targetToken, manoeuvreId) {
  if (!game.combat?.started || !targetToken) return 0;
  const history = game.combat.getFlag(MODULE_ID, "manoeuvreHistory") || {};
  const key = getHistoryKey(attackerTokenId, actor.id, targetToken.id, manoeuvreId);
  return Number(history.counts?.[key] || 0);
}

async function resolveStunSave(context) {
  const targetActor = fromUuidSync(context.targetActorUuid);
  if (!targetActor) throw new Error("Acteur cible introuvable pour le test de CON.");

  const save = await targetActor.rollSkill("con", {
    difficulty: context.stunDifficulty,
    chatFlavor: `Résister à l’assommement — difficulté ${context.stunDifficulty}`,
    withDialog: false
  });
  if (!save?.result?.isFailure || targetActor.statuses.has("unconscious")) return;

  const durationRoll = await new Roll("1d6").evaluate();
  await durationRoll.toMessage({ flavor: `Durée de l’assommement : ${durationRoll.total} minute(s)` });
  const durationSeconds = Number(durationRoll.total) * 60;
  const activated = await targetActor.activateCOStatusEffect({ state: true, effectid: "unconscious" });
  if (activated === false) return;

  const statusEffect = targetActor.effects.find(effect => effect.statuses?.has("unconscious"));
  if (!statusEffect) throw new Error("Impossible de trouver l’effet temporaire Inconscient.");
  await statusEffect.update({
    "duration.seconds": durationSeconds,
    "duration.startTime": game.time.worldTime
  });
}

/* --- Suivi des prises de Bloquer (stocké dans le combat, écrit par le MJ actif) ---
   Une entrée par prise : { active, lastRound, lastPromptRound, attacker…, target…, blockEffectSlug, sizeModifier }.
   lastRound = round de la réussite initiale ou du dernier maintien réussi : la prise ne peut être
   maintenue qu'au round suivant ; un round sans tentative la relâche. */
const BLOCK_REGISTRY_FLAG = "activeBlocks";

function getBlockKey(context) {
  return context.blockKey || `${context.blockEffectSlug}:${context.targetTokenId}`;
}

function getBlockEntry(combat, key) {
  return combat?.getFlag(MODULE_ID, BLOCK_REGISTRY_FLAG)?.[key] || null;
}

async function setBlockEntry(combat, key, data) {
  if (!combat) return;
  await combat.setFlag(MODULE_ID, BLOCK_REGISTRY_FLAG, { [key]: { ...(getBlockEntry(combat, key) || {}), ...data } });
}

function isBlockAttacker(entry, combatant) {
  return Boolean((entry.attackerTokenId && entry.attackerTokenId === combatant?.tokenId)
    || (combatant?.actor && entry.attackerActorUuid === combatant.actor.uuid));
}

// MJ uniquement : fin de la prise, l'état immobilisé est retiré de la cible
async function releaseBlock(combat, key, reason = "") {
  const entry = getBlockEntry(combat, key);
  if (!entry?.active) return;
  const targetActor = fromUuidSync(entry.targetActorUuid);
  const effect = targetActor?.system?.currentEffects?.find(current => current.slug === entry.blockEffectSlug);
  if (effect) await targetActor.deleteCustomEffect(effect);
  await setBlockEntry(combat, key, { active: false });
  if (reason) await postManoeuvreNote(fromUuidSync(entry.attackerActorUuid), reason);
}

// Bouton « Relâcher la prise » : exécuté par le MJ (directement ou via une requête du joueur)
async function requestReleaseBlock(context, button) {
  const attacker = fromUuidSync(context.attackerActorUuid);
  if (!game.user.isGM && !attacker?.isOwner) {
    ui.notifications.warn("Vous devez contrôler l’attaquant pour relâcher la prise.");
    return;
  }
  const combatId = context.combatId || game.combat?.id;
  const payload = { combatId, blockKey: getBlockKey(context) };
  if (button) button.disabled = true;
  try {
    if (game.user.isGM) await handleReleaseBlockQuery(payload);
    else if (game.users.activeGM) await game.users.activeGM.query(`${MODULE_ID}.releaseBlock`, payload);
    else {
      ui.notifications.warn("Un MJ doit être connecté pour relâcher la prise.");
      if (button) button.disabled = false;
    }
  } catch (error) {
    if (button) button.disabled = false;
    console.error(`${MODULE_ID} | Échec du relâchement de la prise :`, error);
    ui.notifications.error(`Échec du relâchement de la prise : ${error.message}`);
  }
}

async function handleReleaseBlockQuery({ combatId, blockKey } = {}) {
  const combat = game.combats.get(combatId);
  const entry = getBlockEntry(combat, blockKey);
  if (!entry?.active) return false;
  const attacker = fromUuidSync(entry.attackerActorUuid);
  const targetActor = fromUuidSync(entry.targetActorUuid);
  await releaseBlock(combat, blockKey,
    `${attacker?.name ?? "L’attaquant"} relâche sa prise : ${targetActor?.name ?? "la cible"} n’est plus immobilisé(e).`);
  return true;
}

async function resolveBlockMaintenance(context, result) {
  const targetActor = fromUuidSync(context.targetActorUuid);
  if (!targetActor) throw new Error("Acteur cible introuvable pour le maintien de la prise.");
  const effect = targetActor.system.currentEffects.find(current => current.slug === context.blockEffectSlug);
  const combat = game.combat;
  const blockKey = getBlockKey(context);

  if (!result.isSuccess) {
    if (effect) await targetActor.deleteCustomEffect(effect);
    if (combat?.id === context.combatId) await setBlockEntry(combat, blockKey, { active: false });
    return;
  }

  if (!combat?.started || combat.id !== context.combatId) return;
  await setBlockEntry(combat, blockKey, { active: true, lastRound: combat.round });
  if (!effect && targetActor.statuses.has("immobilized")) return;

  await targetActor.applyCustomEffect({
    name: "Manœuvre : Bloquer",
    source: getEffectSourceUuid(context.attackerActorUuid),
    statuses: ["immobilized"],
    unit: PERSISTENT_EFFECT_UNIT,
    duration: "1",
    startedAt: combat.round,
    previousRound: combat.round,
    remainingTurn: 1,
    modifiers: [],
    formula: "",
    formulaType: "damage",
    elementType: "",
    slug: context.blockEffectSlug
  });
}

// Lien direct jet ↔ manœuvre : le système passe l'objet d'attaque au hook, on y lit le contexte de la manœuvre
Hooks.on("co.resultRollAttack", (item, options, rolls) => {
  const context = item?.[MODULE_ID];
  if (context && rolls?.[0]) rolls[0].options[MODULE_ID] = context;
});

function takePendingContext(roll) {
  const actorId = roll?.options?.actorId;
  const actionName = roll?.options?.actionName || roll?.options?.flavor;
  if (!actorId || !actionName) return null;

  const key = `${actorId}:${actionName}`;
  const contexts = pendingManoeuvreRolls.get(key);
  if (!contexts?.length) return null;

  // Préfère le contexte de la même cible, sinon le plus ancien
  const oppositeTarget = roll.options.oppositeTarget;
  let index = contexts.findIndex(ctx => oppositeTarget && ctx.targetUuid === oppositeTarget);
  if (index < 0) index = 0;
  const [context] = contexts.splice(index, 1);
  if (contexts.length === 0) pendingManoeuvreRolls.delete(key);
  return context;
}

Hooks.on("preCreateChatMessage", message => {
  const roll = message.rolls?.[0];
  if (!roll) return;
  const context = roll.options?.[MODULE_ID] || takePendingContext(roll);
  if (!context) return;
  message.updateSource({
    [`flags.${MODULE_ID}.roll`]: context,
    ...(context.hasTimedEffect ? { "system.effectsApplied": true } : {})
  });
});

Hooks.on("updateChatMessage", async (message, changes) => {
  const activeGM = game.users.activeGM;
  const context = message.getFlag(MODULE_ID, "roll");
  if (!game.user.isGM || activeGM?.id !== game.user.id || !context) return;

  if (context.type === "block-maintenance") {
    const result = changes["system.result"] || foundry.utils.getProperty(changes, "system.result");
    const eventKey = `${message.id}:block-maintenance`;
    if (!result || message.getFlag(MODULE_ID, "maintenanceResolved") || processingManoeuvreResults.has(eventKey)) return;
    processingManoeuvreResults.add(eventKey);
    try {
      await message.setFlag(MODULE_ID, "maintenanceResolved", true);
      await resolveBlockMaintenance(context, result);
    } catch (error) {
      console.error(`${MODULE_ID} | Échec du maintien de la prise :`, error);
      ui.notifications.error(`Échec du maintien de la prise : ${error.message}`);
    } finally {
      processingManoeuvreResults.delete(eventKey);
    }
    return;
  }

  const updatedResults = changes["system.targetResults"] || foundry.utils.getProperty(changes, "system.targetResults");
  if (!Array.isArray(updatedResults)) return;

  const combat = game.combat?.started ? game.combat : null;
  const history = combat
    ? foundry.utils.deepClone(combat.getFlag(MODULE_ID, "manoeuvreHistory") || { counts: {}, events: {} })
    : null;
  if (history) {
    history.counts ||= {};
    history.events ||= {};
  }

  for (const result of updatedResults) {
    if (result.needsOppositeRoll) continue;

    const eventKey = `${message.id}:${context.targetTokenId}`;
    if (history?.events[eventKey] || message.getFlag(MODULE_ID, "resolved")
      || processingManoeuvreResults.has(eventKey)) continue;
    processingManoeuvreResults.add(eventKey);

    try {
      await message.setFlag(MODULE_ID, "resolved", true);

      // Filet de sécurité : si le système n'a pas posé l'effet de la manœuvre, on l'applique ici
      if (result.isSuccess && context.hasTimedEffect && context.effectSlug) {
        const targetActor = fromUuidSync(context.targetActorUuid);
        const alreadyApplied = targetActor?.system?.currentEffects?.some(effect => effect.slug === context.effectSlug);
        const customEffect = message.system?.customEffect;
        if (targetActor && !alreadyApplied && customEffect) {
          const effectData = typeof customEffect.toObject === "function" ? customEffect.toObject() : foundry.utils.deepClone(customEffect);
          await targetActor.applyCustomEffect(effectData);
        }
      }

      // Bloquer réussi en combat : on enregistre la prise pour proposer son maintien au tour suivant de l'attaquant
      if (result.isSuccess && context.manoeuvreId === "bloquer" && context.canMaintainBlock
        && combat && combat.id === context.combatId) {
        await setBlockEntry(combat, getBlockKey(context), {
          active: true,
          lastRound: combat.round,
          lastPromptRound: combat.round,
          attackerActorUuid: context.attackerActorUuid,
          attackerTokenId: context.attackerTokenId,
          targetActorUuid: context.targetActorUuid,
          targetTokenId: context.targetTokenId,
          blockEffectSlug: context.blockEffectSlug,
          sizeModifier: context.sizeModifier,
          combatId: combat.id
        });
      }

      if (result.isSuccess && context.manoeuvreId === "desarmer") {
        const targetActor = canvas?.tokens?.get(context.targetTokenId)?.actor || fromUuidSync(result.uuid);
        if (targetActor?.activateCOStatusEffect) {
          await targetActor.activateCOStatusEffect({ state: true, effectid: "manoeuvre-desarmer" });
        }
      }

      if (result.isSuccess && context.manoeuvreId === "etourdir" && context.stunSaveEligible
        && !message.getFlag(MODULE_ID, "stunSaveAttempted")) {
        await message.setFlag(MODULE_ID, "stunSaveAttempted", true);
        await resolveStunSave(context);
      }

      if (history) {
        const historyKey = getHistoryKey(
          context.attackerTokenId,
          context.attackerActorId,
          context.targetTokenId,
          context.manoeuvreId
        );
        history.counts[historyKey] = Number(history.counts[historyKey] || 0) + 1;
        history.events[eventKey] = true;
        await combat.setFlag(MODULE_ID, "manoeuvreHistory", history);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Échec de la résolution d'une manœuvre :`, error);
      ui.notifications.error(`Échec de la résolution d'une manœuvre : ${error.message}`);
    } finally {
      processingManoeuvreResults.delete(eventKey);
    }
  }
});

async function maintainBlock(message, context, button) {
  const combat = game.combat;
  if (!combat?.started || combat.id !== context.combatId || combat.round <= context.blockStartRound) {
    ui.notifications.warn("Vous pourrez tenter de maintenir la prise à partir du prochain round.");
    return;
  }

  const usedRounds = message.getFlag(MODULE_ID, "maintenanceRounds") || [];
  if (usedRounds.includes(combat.round)) {
    ui.notifications.warn("Une tentative de maintien a déjà été lancée ce round.");
    return;
  }

  const blockKey = getBlockKey(context);
  const entry = getBlockEntry(combat, blockKey);
  if (entry) {
    if (!entry.active || entry.lastRound < combat.round - 1) {
      ui.notifications.warn("La prise a été relâchée : elle ne peut plus être maintenue.");
      return;
    }
    if (entry.lastRound >= combat.round) {
      ui.notifications.warn("La prise a déjà été maintenue ce round.");
      return;
    }
  }

  const attacker = fromUuidSync(context.attackerActorUuid);
  const targetActor = fromUuidSync(context.targetActorUuid);
  const targetToken = canvas?.tokens?.get(context.targetTokenId);
  if (!attacker || !targetActor || !attacker.isOwner && !game.user.isGM) {
    ui.notifications.warn("Vous devez contrôler l’attaquant pour maintenir la prise.");
    return;
  }

  const lockKey = `${message.id}:${combat.id}:${combat.round}`;
  if (processingManoeuvreResults.has(lockKey)) return;
  processingManoeuvreResults.add(lockKey);
  button.disabled = true;

  const nextUsedRounds = [...usedRounds, combat.round];
  const actionName = "Maintenir une prise — Manœuvre";
  const pendingKey = `${attacker.id}:${actionName}`;
  const metadata = {
    type: "block-maintenance",
    attackerActorUuid: attacker.uuid,
    attackerTokenId: context.attackerTokenId || null,
    targetActorUuid: targetActor.uuid,
    targetTokenId: context.targetTokenId,
    targetUuid: targetActor.uuid,
    oppositeValue: "@oppose.for",
    blockEffectSlug: context.blockEffectSlug,
    blockKey,
    combatId: combat.id
  };
  const pending = pendingManoeuvreRolls.get(pendingKey) || [];
  pending.push(metadata);
  pendingManoeuvreRolls.set(pendingKey, pending);

  try {
    const roll = await attacker.rollSkill("for", {
      difficulty: "@oppose.for",
      oppositeRoll: true,
      targets: [{
        actor: targetActor,
        token: targetToken,
        uuid: targetActor.uuid,
        name: targetActor.name
      }],
      bonus: Math.max(0, context.sizeModifier || 0),
      malus: Math.min(0, context.sizeModifier || 0),
      chatFlavor: actionName
    });
    // Le message de rappel appartient au MJ : un joueur ne peut pas y écrire (le suivi du combat suffit alors)
    if (roll && message.isOwner) await message.setFlag(MODULE_ID, "maintenanceRounds", nextUsedRounds);
    else if (!roll) button.disabled = false;
  } catch (error) {
    button.disabled = false;
    console.error(`${MODULE_ID} | Échec du test de maintien :`, error);
    ui.notifications.error(`Échec du test de maintien : ${error.message}`);
  } finally {
    const remaining = pendingManoeuvreRolls.get(pendingKey);
    if (remaining) {
      const index = remaining.indexOf(metadata);
      if (index >= 0) remaining.splice(index, 1);
      if (remaining.length === 0) pendingManoeuvreRolls.delete(pendingKey);
    }
    processingManoeuvreResults.delete(lockKey);
  }
}

async function removeManoeuvreEffect(context, button) {
  const targetActor = fromUuidSync(context.targetActorUuid);
  const effect = targetActor?.system?.currentEffects?.find(current => current.slug === context.effectSlug);
  if (!effect) {
    ui.notifications.info("L’effet de cette manœuvre n’est plus actif sur la cible.");
    button.disabled = true;
    return;
  }
  button.disabled = true;
  try {
    await targetActor.deleteCustomEffect(effect);
    ui.notifications.info(`Effet « ${effect.name} » retiré de ${targetActor.name}.`);
  } catch (error) {
    button.disabled = false;
    console.error(`${MODULE_ID} | Échec du retrait de l'effet :`, error);
    ui.notifications.error(`Échec du retrait de l’effet : ${error.message}`);
  }
}

/* --- Rappels de début de tour pour les états persistants (Désarmer, Renverser) --- */
function isActorProne(actor) {
  return Boolean(actor?.statuses?.has("manoeuvre-overturned") || findManoeuvreEffects(actor, "renverser").length > 0);
}

function isActorDisarmed(actor) {
  return Boolean(actor?.statuses?.has("manoeuvre-desarmer"));
}

const CONDITION_PROMPTS = {
  "pickup-prompt": {
    isActive: isActorDisarmed,
    icon: "fa-hand-paper",
    title: "Désarmé(e) — ramasser son arme ?",
    text: name => `${name} peut ramasser son arme tombée au sol.`,
    buttonLabel: "Ramasser son arme",
    action: pickUpWeapon
  },
  "standup-prompt": {
    isActive: isActorProne,
    icon: "fa-person-falling",
    title: "À terre — se relever ?",
    text: name => `${name} est à terre (-5 DEF). Se relever demande une action d’attaque.`,
    buttonLabel: "Se relever (action d’attaque)",
    action: standUp
  }
};

// Un seul rappel par combattant, par état et par round (le hook peut se déclencher plusieurs fois pour un même tour)
const conditionPromptsSent = new Set();

async function promptConditionActions(combat, combatant) {
  const actor = combatant.actor;
  if (!actor) return;
  for (const [type, prompt] of Object.entries(CONDITION_PROMPTS)) {
    if (!prompt.isActive(actor)) continue;
    const promptKey = `${combat.id}:${combat.round}:${combatant.id}:${type}`;
    if (conditionPromptsSent.has(promptKey)) continue;
    conditionPromptsSent.add(promptKey);

    const whisper = game.users
      .filter(user => user.isGM || actor.testUserPermission(user, "OWNER"))
      .map(user => user.id);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor, token: combatant.token }),
      whisper,
      content: `<div class="mv-man-block-prompt"><strong><i class="fas ${prompt.icon}"></i> ${escapeHtml(prompt.title)}</strong>`
        + `<div>${escapeHtml(prompt.text(actor.name))}</div></div>`,
      flags: { [MODULE_ID]: { roll: { type, targetActorUuid: actor.uuid, round: combat.round, combatId: combat.id } } }
    });
  }
}

// Changement de tour : fin des prises non maintenues, puis rappel de maintien au début du tour du lanceur
Hooks.on("updateCombat", async (combat, changed) => {
  if (!("turn" in changed) && !("round" in changed)) return;
  if (game.users.activeGM?.id !== game.user.id || !combat.started) return;
  const combatant = combat.combatant;
  if (!combatant?.actor) return;

  // Désarmé / à terre : au début de son tour, on propose de ramasser l'arme / de se relever
  try {
    await promptConditionActions(combat, combatant);
  } catch (error) {
    console.error(`${MODULE_ID} | Échec des rappels de début de tour :`, error);
  }

  const registry = combat.getFlag(MODULE_ID, BLOCK_REGISTRY_FLAG) || {};
  for (const [key, entry] of Object.entries(registry)) {
    if (!entry?.active || entry.combatId !== combat.id) continue;
    const attacker = fromUuidSync(entry.attackerActorUuid);
    const targetActor = fromUuidSync(entry.targetActorUuid);
    const attackerName = attacker?.name ?? "L’attaquant";
    const targetName = targetActor?.name ?? "la cible";

    try {
      if (!attacker || !targetActor) {
        await releaseBlock(combat, key);
        continue;
      }

      // Le tour du lanceur est passé sans maintien réussi (ou il n'a jamais rejoué) : prise relâchée
      const promptMissed = entry.lastRound < entry.lastPromptRound && !isBlockAttacker(entry, combatant);
      const stale = entry.lastRound < combat.round - 1;
      if (promptMissed || stale) {
        await releaseBlock(combat, key, `${attackerName} n’a pas maintenu sa prise : ${targetName} n’est plus immobilisé(e).`);
        continue;
      }

      if (!isBlockAttacker(entry, combatant) || entry.lastPromptRound === combat.round) continue;

      await setBlockEntry(combat, key, { lastPromptRound: combat.round });
      const whisper = game.users
        .filter(user => user.isGM || attacker.testUserPermission(user, "OWNER"))
        .map(user => user.id);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        whisper,
        content: `<div class="mv-man-block-prompt"><strong><i class="fas fa-hand-rock"></i> Bloquer — maintenir la prise ?</strong>`
          + `<div>${escapeHtml(attackerName)} peut maintenir sa prise sur ${escapeHtml(targetName)} : `
          + `test opposé de FOR (action limitée). En cas d’échec, de refus ou sans tentative ce tour-ci, la prise est relâchée.</div></div>`,
        flags: {
          [MODULE_ID]: {
            roll: { ...entry, type: "block-prompt", blockKey: key, blockStartRound: entry.lastRound, canMaintainBlock: true }
          }
        }
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Échec du suivi de la prise :`, error);
    }
  }
});

function appendActionButton(container, label, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mv-man-maintain-btn ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onClick(button);
  });
  container.append(button);
  return button;
}

function appendMaintainButton(container, message, context) {
  const row = document.createElement("div");
  row.className = "mv-man-btn-row";
  const maintain = appendActionButton(row, "Maintenir la prise (test opposé de FOR)",
    button => maintainBlock(message, context, button));
  const release = appendActionButton(row, "Relâcher la prise",
    button => requestReleaseBlock(context, button), "mv-man-release-btn");
  container.append(row);
  return { maintain, release };
}


Hooks.on("renderChatMessageHTML", (message, html) => {
  const context = message.getFlag(MODULE_ID, "roll");
  const conditionPrompt = CONDITION_PROMPTS[context?.type];
  if (conditionPrompt) {
    const actor = fromUuidSync(context.targetActorUuid);
    if (!actor?.isOwner) return;
    const root = resolveHtmlElement(html);
    const content = root?.querySelector(".message-content") || root;
    if (!content || content.querySelector(".mv-man-maintain-btn")) return;
    const button = appendActionButton(content, conditionPrompt.buttonLabel, async btn => {
      btn.disabled = true;
      await conditionPrompt.action(actor);
    });
    // État déjà levé (arme ramassée, cible relevée) : bouton inactif
    if (!conditionPrompt.isActive(actor)) button.disabled = true;
    return;
  }
  if (context?.type === "block-prompt") {
    const attacker = fromUuidSync(context.attackerActorUuid);
    if (!game.user.isGM && !attacker?.isOwner) return;
    const root = resolveHtmlElement(html);
    const content = root?.querySelector(".message-content") || root;
    if (!content || content.querySelector(".mv-man-maintain-btn")) return;
    const entry = getBlockEntry(game.combat, context.blockKey);
    // Le rappel n'est valable que pendant le round qui suit la dernière prise réussie (revérifié au clic)
    const stillOpen = Boolean(entry?.active && entry.lastRound === context.blockStartRound
      && game.combat?.round === context.blockStartRound + 1);
    const { maintain, release } = appendMaintainButton(content, message, context);
    if (!stillOpen) maintain.disabled = release.disabled = true;
    return;
  }
  if (!context || context.type !== "maneuver") return;
  const results = message.system?.targetResults;
  if (!Array.isArray(results)) return;
  const result = results.find(targetResult => targetResult.uuid === context.targetActorUuid) || results[0];
  if (!result || result.needsOppositeRoll || !result.isSuccess) return;

  const root = resolveHtmlElement(html);
  const content = root?.querySelector(".message-content") || root;
  if (!content || content.querySelector(".mv-man-result-notice")) return;

  const notice = document.createElement("div");
  notice.className = "mv-man-result-notice";
  const notes = [];
  if (context.manoeuvreId === "repousser") {
    const attacker = fromUuidSync(context.attackerActorUuid);
    const distance = getActorAbilityTotal(attacker, "for") + 3;
    notes.push(`Sur réussite, la cible recule de ${distance} m et l’attaquant occupe la place libérée.${context.isCornered ? ` Cible acculée : malus de ${distance} en DEF.` : ""}${context.advanceMovement ? " Déplacement préalable jusqu’à 10 m déclaré." : ""}`);
  } else if (context.manoeuvreId === "renverser") {
    notes.push(`La cible est renversée (-5 DEF) et le reste jusqu’à ce qu’elle consacre une action d’attaque pour se relever (bouton « Se relever »).${context.advanceMovement ? " Déplacement préalable jusqu’à 10 m déclaré." : ""}`);
  } else if (context.manoeuvreId === "desarmer") {
    notes.push("L’arme est au sol. La cible peut la ramasser avant tout le monde en sacrifiant son prochain tour, ou plus tard (bouton « Ramasser son arme »).");
  } else if (context.manoeuvreId === "gener" && context.effectChoice === "slowed") {
    notes.push("Option « ralentie » : la cible ne peut effectuer qu’une action de déplacement ou d’attaque.");
  } else if (context.manoeuvreId === "etourdir") {
    notes.push("Règle : la cible étourdie ne peut pas agir et subit -5 en DEF pendant 1 round.");
  }
  const attacker = fromUuidSync(context.attackerActorUuid);
  if (context.manoeuvreId === "bloquer" && context.canMaintainBlock && (game.user.isGM || attacker?.isOwner)) {
    notes.push("La cible reste immobilisée tant que la prise est maintenue : au début de chacun de ses tours, l’attaquant fait un test opposé de FOR. Un échec, un refus ou un tour sans tentative relâche la prise.");
  }
  if (context.manoeuvreId === "etourdir" && context.stunSaveEligible) {
    notes.push(`La cible est surprise et son NC est inférieur : test de CON contre difficulté ${context.stunDifficulty} lancé automatiquement.`);
  }
  if (context.outOfCombat && context.hasTimedEffect) {
    notes.push("Hors combat : l’effet d’un round n’expire pas automatiquement et doit être retiré par le MJ.");
  }
  if (notes.length) {
    const text = document.createElement("div");
    text.textContent = notes.join(" ");
    notice.append(text);
  }

  if (context.manoeuvreId === "bloquer" && context.canMaintainBlock && (game.user.isGM || attacker?.isOwner)) {
    appendMaintainButton(notice, message, context);
  }

  // Renverser / Désarmer : actions de la cible (propriétaire de la cible ou MJ)
  const targetActor = fromUuidSync(context.targetActorUuid);
  if (targetActor?.isOwner && context.manoeuvreId === "renverser") {
    appendActionButton(notice, "Se relever (action d’attaque)", async button => {
      button.disabled = true;
      await standUp(targetActor);
    });
  }
  if (targetActor?.isOwner && context.manoeuvreId === "desarmer") {
    appendActionButton(notice, "Ramasser son arme", async button => {
      button.disabled = true;
      await pickUpWeapon(targetActor);
    });
  }

  if (context.outOfCombat && context.hasTimedEffect && context.effectSlug && game.user.isGM) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "mv-man-maintain-btn mv-man-remove-effect-btn";
    removeButton.textContent = "Retirer l’effet de la manœuvre";
    removeButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      removeManoeuvreEffect(context, removeButton);
    });
    notice.append(removeButton);
  }
  if (notice.childElementCount) content.append(notice);
});

/* ==========================================================================
   5. CONFIGURATION DU TEST ET JET OPPOSÉ NATIF COF2
   ========================================================================== */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// Empêche deux manœuvres simultanées du même acteur (le lien jet ↔ manœuvre resterait ambigu)
async function rollManoeuvre(actor, manoeuvre, sourceTokenId = null) {
  if (activeManoeuvreActors.has(actor.uuid)) {
    ui.notifications.warn("Une manœuvre de cet acteur est déjà en cours.");
    return;
  }
  activeManoeuvreActors.add(actor.uuid);
  try {
    await performManoeuvreRoll(actor, manoeuvre, sourceTokenId);
  } finally {
    activeManoeuvreActors.delete(actor.uuid);
  }
}

async function performManoeuvreRoll(actor, manoeuvre, sourceTokenId = null) {
  const targets = actor.acquireTargets("single", "all", 1, `Manœuvre : ${manoeuvre.name}`);
  const target = targets[0];
  if (!target?.token || !target.actor) {
    ui.notifications.warn("Ciblez exactement un token pour effectuer une manœuvre.");
    return;
  }

  const sizeModifier = manoeuvre.sizeSensitive ? getSizeModifier(actor, target.actor) : 0;
  const repetitionCount = getDiminishingReturnsCount(sourceTokenId, actor, target.token, manoeuvre.id);
  const diminishingPenalty = repetitionCount > 0 ? -5 * repetitionCount : 0;
  const extraBonuses = getManoeuvreItemAndEffectBonuses(actor, manoeuvre);
  const strength = getActorAbilityTotal(actor, "for");
  const extraFields = [
    '<div class="mv-man-row-opt"><label for="mv-man-attack-mode">Mode d’attaque (si validé par le MJ) :</label><select id="mv-man-attack-mode" name="attackMode"><option value="melee">Au contact</option><option value="ranged">À distance</option><option value="magical">Magique</option></select></div>',
    '<label class="mv-man-opt"><input type="checkbox" name="isFinesse"/> Attaque au contact en finesse (AGI remplace FOR)</label>',
    manoeuvre.id === "gener"
      ? '<div class="mv-man-row-opt"><label for="mv-man-gener-choice">Effet si réussite :</label><select id="mv-man-gener-choice" name="generChoice"><option value="slowed">Cible ralentie (une action M ou A)</option><option value="attackPenalty">Malus de -5 en attaque</option></select></div>'
      : "",
    manoeuvre.id === "repousser"
      ? `<label class="mv-man-opt"><input type="checkbox" name="isCornered"/> Cible acculée (malus de ${strength + 3} en DEF pendant 1 round)</label><label class="mv-man-opt"><input type="checkbox" name="advanceMovement"/> Déplacement préalable de l’attaquant (jusqu’à 10 m)</label>`
      : "",
    manoeuvre.id === "renverser"
      ? '<label class="mv-man-opt"><input type="checkbox" name="isQuadruped"/> Cible quadrupède (malus de -10 au test au lieu de -5)</label><label class="mv-man-opt"><input type="checkbox" name="advanceMovement"/> Déplacement préalable de l’attaquant (jusqu’à 10 m)</label>'
      : "",
    manoeuvre.id === "etourdir"
      ? `<label class="mv-man-opt"><input type="checkbox" name="isTargetSurprised" ${target.actor.statuses?.has("surprised") ? "checked" : ""}/> Cible surprise</label><label class="mv-man-opt"><input type="checkbox" name="isBludgeoning"/> Arme infligeant des DM contondants (difficulté du test de CON : 15)</label>`
      : ""
  ].join("");

  const sizeLine = manoeuvre.sizeSensitive
    ? `<div class="mv-man-chat-sub">Différence de taille appliquée automatiquement : ${sizeModifier >= 0 ? "+" : ""}${sizeModifier}</div>`
    : "";
  const repetitionLine = repetitionCount > 0
    ? `<div class="mv-man-repetition-info"><i class="fas fa-redo-alt"></i><span>Répétitions sur cette cible : <strong>${repetitionCount}</strong> (${diminishingPenalty})</span></div>`
    : "";
  const content =
    `<div class="mv-man-roll-dialog">
      <div class="mv-man-roll-head">
        <img src="${manoeuvre.img}" width="36" height="36"/>
        <div><strong>${manoeuvre.name}</strong><div class="mv-man-chat-sub">Cible : ${escapeHtml(target.name)}</div>${sizeLine}</div>
      </div>
      ${repetitionLine}
      <div class="mv-man-row-opt">
        <label for="mv-man-situational">Modificateur circonstanciel :</label>
        <input id="mv-man-situational" type="number" name="situational" value="0" step="1"/>
      </div>
      ${extraFields}
    </div>`;
  const options = await foundry.applications.api.DialogV2.wait({
    window: { title: `Manœuvre : ${manoeuvre.name}` },
    position: { width: 460 },
    classes: ["dialog", "mv-man-dialog"],
    content,
    rejectClose: false,
    buttons: [
      {
        action: "roll",
        label: "Lancer le test opposé",
        icon: "fas fa-dice-d20",
        default: true,
        callback: (event, button) => {
          const form = button.form;
          const situational = Number(form.elements.namedItem("situational")?.value || 0);
          if (!Number.isFinite(situational)) {
            ui.notifications.warn("Le modificateur circonstanciel doit être un nombre valide.");
            return false;
          }
          return {
            situational,
            generChoice: form.elements.namedItem("generChoice")?.value || "slowed",
            isCornered: Boolean(form.elements.namedItem("isCornered")?.checked),
            isQuadruped: Boolean(form.elements.namedItem("isQuadruped")?.checked),
            advanceMovement: Boolean(form.elements.namedItem("advanceMovement")?.checked),
            attackMode: form.elements.namedItem("attackMode")?.value || "melee",
            isFinesse: Boolean(form.elements.namedItem("isFinesse")?.checked),
            isBludgeoning: Boolean(form.elements.namedItem("isBludgeoning")?.checked),
            isTargetSurprised: Boolean(form.elements.namedItem("isTargetSurprised")?.checked)
          };
        }
      },
      {
        action: "cancel",
        label: "Annuler",
        icon: "fas fa-times",
        callback: () => null
      }
    ]
  });
  if (!options) return;

  const modifier = (manoeuvre.id === "renverser" && options.isQuadruped ? -10 : manoeuvre.modValue)
    + (manoeuvre.useCha ? getActorChaMod(actor) : 0)
    + extraBonuses.total
    + diminishingPenalty
    + sizeModifier
    + options.situational;
  const attackTypes = {
    melee: { actionType: game.system.CONST.ACTION_TYPES.melee.id, formula: options.isFinesse ? "@atc + @agi - @for" : "@atc" },
    ranged: { actionType: game.system.CONST.ACTION_TYPES.ranged.id, formula: "@atd" },
    magical: { actionType: game.system.CONST.ACTION_TYPES.magical.id, formula: "@atm" }
  };
  const attack = attackTypes[options.attackMode] || attackTypes.melee;
  // Maintien de Bloquer possible (en combat, contre une cible de NC inférieur au niveau de l'attaquant)
  const canMaintainBlock = Boolean(game.combat?.started && (() => {
    const attackerRank = getActorManeuverRank(actor);
    const targetRank = getActorNC(target.actor);
    return attackerRank !== null && targetRank !== null && targetRank < attackerRank;
  })());
  let customEffect = buildManoeuvreEffect(actor, manoeuvre, { ...options, canMaintainBlock }, sourceTokenId);
  if (customEffect) {
    customEffect = {
      ...customEffect,
      statuses: customEffect.statuses.filter(status => !target.actor.statuses?.has(status))
    };
    const isGenerAttackPenalty = customEffect.slug.endsWith(`-gener${GENER_ATTACK_SLUG_SUFFIX}`);
    if (!isGenerAttackPenalty && customEffect.statuses.length === 0 && customEffect.modifiers.length === 0) customEffect = null;
  }
  // Hors combat, l'effet est appliqué quand même ; il n'expirera pas seul (bouton de retrait pour le MJ dans le chat)
  const outOfCombat = !game.combat?.started || game.combat.round === null;

  const additionalEffect = {
    active: Boolean(customEffect),
    applyOn: "success",
    // Les états sont portés par customEffect : les mettre ici afficherait des cases à cocher dans la fenêtre
    // du système et les états propres au module (Aveuglé/Renversé) seraient refusés par le modèle de données
    statuses: new Set(),
    duration: "1",
    unit: "round"
  };
  const attackItem = {
    id: "",
    uuid: "",
    name: `Manœuvre : ${manoeuvre.name}`,
    img: manoeuvre.img,
    type: "feature",
    system: { properties: { reloadable: false } }
  };
  const metadata = {
    attackerActorUuid: actor.uuid,
    attackerActorId: actor.id,
    attackerTokenId: sourceTokenId || null,
    targetActorUuid: target.actor.uuid,
    targetTokenId: target.token.id,
    targetUuid: target.uuid,
    oppositeValue: "@oppose.atc",
    manoeuvreId: manoeuvre.id,
    effectChoice: options.generChoice,
    isCornered: options.isCornered,
    outOfCombat,
    hasTimedEffect: Boolean(customEffect),
    effectSlug: customEffect?.slug || null,
    advanceMovement: options.advanceMovement,
    blockStartRound: game.combat?.started ? game.combat.round : null,
    combatId: game.combat?.started ? game.combat.id : null,
    blockEffectSlug: `manoeuvre-${sourceTokenId || actor.id}-bloquer`,
    sizeModifier,
    canMaintainBlock,
    stunSaveEligible: manoeuvre.id === "etourdir" && isEligibleForStunSave(actor, target.actor, options.isTargetSurprised),
    stunDifficulty: options.isBludgeoning ? 15 : 10,
    type: "maneuver"
  };
  // Contexte lu par le hook co.resultRollAttack (lien direct) ; la file d'attente sert de secours
  attackItem[MODULE_ID] = metadata;
  const pendingKey = `${actor.id}:${manoeuvre.name}`;
  const pending = pendingManoeuvreRolls.get(pendingKey) || [];
  pending.push(metadata);
  pendingManoeuvreRolls.set(pendingKey, pending);

  const modifierParts = [
    manoeuvre.modValue ? `Manœuvre ${manoeuvre.modValue}` : "",
    `Attaque ${options.attackMode === "ranged" ? "à distance" : options.attackMode === "magical" ? "magique" : "au contact"}`,
    options.isFinesse && options.attackMode === "melee" ? "Finesse AGI" : "",
    options.isBludgeoning && manoeuvre.id === "etourdir" ? "Arme contondante" : "",
    manoeuvre.useCha ? `CHA ${getActorChaMod(actor)}` : "",
    ...extraBonuses.sources,
    diminishingPenalty ? `Répétition ${diminishingPenalty}` : "",
    sizeModifier ? `Taille ${sizeModifier}` : "",
    options.situational ? `Circonstance ${options.situational}` : ""
  ].filter(Boolean);

  try {
    await actor.rollAttack(attackItem, {
      type: "attack",
      actionName: manoeuvre.name,
      actionType: attack.actionType,
      chatFlavor: modifierParts.join(" | "),
      skillBonus: Math.max(0, modifier),
      skillMalus: Math.min(0, modifier),
      skillFormula: attack.formula,
      skillFormulaTooltip: attack.formula,
      difficulty: "@oppose.atc",
      useDifficulty: true,
      critical: NO_CRITICAL_THRESHOLD,
      criticalTooltip: "Pas de réussite critique pour une manœuvre",
      withDialog: true,
      targetType: "single",
      targetScope: "all",
      targets,
      customEffect,
      additionalEffect
    });
  } catch (error) {
    console.error(`${MODULE_ID} | Erreur lors du jet de manœuvre :`, error);
    ui.notifications.error(`Erreur lors du jet de manœuvre : ${error.message}`);
  } finally {
    const remaining = pendingManoeuvreRolls.get(pendingKey);
    if (remaining) {
      const index = remaining.indexOf(metadata);
      if (index >= 0) remaining.splice(index, 1);
      if (remaining.length === 0) pendingManoeuvreRolls.delete(pendingKey);
    }
  }
}

/* ==========================================================================
   7. INJECTION DE L'ONGLET MANŒUVRES DANS LES FICHES D'ACTEURS COF2
   ========================================================================== */

// Encart « états de manœuvre » en tête de l'onglet : actions pour se relever / ramasser son arme
function refreshManoeuvreConditions(section, actor) {
  const container = section.querySelector(".mv-man-container");
  if (!container) return;
  container.querySelector(".mv-man-conditions")?.remove();
  if (!actor.isOwner) return;

  const isProne = isActorProne(actor);
  const isDisarmed = isActorDisarmed(actor);
  if (!isProne && !isDisarmed) return;

  const box = document.createElement("div");
  box.className = "mv-man-conditions";
  const title = document.createElement("div");
  title.className = "mv-man-conditions-title";
  title.textContent = [isProne ? "À terre" : "", isDisarmed ? "Désarmé(e)" : ""].filter(Boolean).join(" · ");
  box.append(title);
  const row = document.createElement("div");
  row.className = "mv-man-btn-row";
  if (isProne) {
    appendActionButton(row, "Se relever (action d’attaque)", async button => {
      button.disabled = true;
      await standUp(actor);
    });
  }
  if (isDisarmed) {
    appendActionButton(row, "Ramasser son arme", async button => {
      button.disabled = true;
      await pickUpWeapon(actor);
    });
  }
  box.append(row);
  container.insertBefore(box, container.querySelector(".mv-man-grid"));
}

function injectManoeuvresTab(app, html) {
  if (game.system.id !== "co2") return;

  const actor = app.actor || app.document;
  if (!actor || actor.documentName !== "Actor") return;
  const sourceTokenId = app.token?.id || actor.token?.id || actor.getActiveTokens()?.[0]?.id || null;

  const sheetWindow = app.element instanceof HTMLElement
    ? app.element
    : (resolveHtmlElement(html) || document.getElementById(app.id));
  if (!sheetWindow) return;

  const contentArea = sheetWindow.querySelector(".window-content") || sheetWindow;

  let manSection = contentArea.querySelector('section.tab[data-tab="manoeuvres"]');
  if (!manSection) {
    manSection = document.createElement("section");
    manSection.classList.add("tab", "mv-man-tab-section");
    manSection.dataset.tab = "manoeuvres";
    manSection.dataset.group = "primary";

    const cardsHtml = MANOEUVRES_LIST.map(m => {
      return (
        '<div class="mv-man-card" data-man-id="' + m.id + '">' +
          '<div class="mv-man-card-main">' +
            '<img src="' + m.img + '" class="mv-man-icon" width="38" height="38"/>' +
            '<div class="mv-man-body">' +
              '<div class="mv-man-title-row">' +
                '<span class="mv-man-name">' + m.name + '</span>' +
                '<span class="mv-man-action-badge" title="Action limitée">L</span>' +
              '</div>' +
            '</div>' +
            '<div class="mv-man-actions">' +
              '<button type="button" class="mv-man-info-btn" title="Règle détaillée">' +
                '<i class="fas fa-info-circle"></i>' +
              '</button>' +
              '<button type="button" class="mv-man-roll-btn" title="Effectuer la manœuvre">' +
                '<i class="fas fa-dice-d20"></i>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="mv-man-details mv-hidden">' + m.description + '</div>' +
        '</div>'
      );
    }).join("");

    manSection.innerHTML =
      '<div class="mv-man-container">' +
        '<div class="mv-man-banner">' +
          '<div class="mv-man-banner-title"><i class="fas fa-fist-raised"></i> Les manœuvres (Action limitée — L)</div>' +
          '<div class="mv-man-banner-sub">Test opposé d\'attaque au contact résolu par COF2. Aucun DM n\'est infligé ; la réussite applique l\'effet de la manœuvre.</div>' +
        '</div>' +
        '<div class="mv-man-grid">' + cardsHtml + '</div>' +
      '</div>';

    contentArea.appendChild(manSection);

    manSection.querySelectorAll(".mv-man-card").forEach(card => {
      const man = MANOEUVRES_LIST.find(x => x.id === card.dataset.manId);
      if (!man) return;

      card.querySelector(".mv-man-roll-btn")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        rollManoeuvre(actor, man, sourceTokenId);
      });

      card.querySelector(".mv-man-info-btn")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const det = card.querySelector(".mv-man-details");
        const btn = card.querySelector(".mv-man-info-btn");
        if (det) {
          const hidden = det.classList.toggle("mv-hidden");
          btn?.classList.toggle("active", !hidden);
        }
      });
    });
  }

  refreshManoeuvreConditions(manSection, actor);

  const placement = game.settings.get(MODULE_ID, "tabPlacement") || "side";

  sheetWindow.querySelectorAll(".mv-man-side-btn, .mv-man-main-tab-btn").forEach(b => b.remove());
  const existingSideNav = sheetWindow.querySelector(".mv-side-tabs");
  if (existingSideNav && existingSideNav.children.length === 0 && placement === "main") {
    existingSideNav.remove();
  }

  let manBtn;

  if (placement === "main") {
    const mainNav = sheetWindow.querySelector("nav.sheet-tabs");
    const effectsTab = mainNav?.querySelector('[data-tab="effects"]');

    // Clone directement la balise native de l'onglet Effets (<button> ou <a>) pour hériter de 100 % du style COF2
    manBtn = effectsTab ? effectsTab.cloneNode(false) : document.createElement("button");
    if (manBtn.tagName === "BUTTON") manBtn.type = "button";
    manBtn.classList.remove("active");
    manBtn.dataset.action = "tab";
    manBtn.dataset.group = "primary";
    manBtn.dataset.tab = "manoeuvres";
    manBtn.classList.add("mv-man-main-tab-btn");
    manBtn.innerHTML = "<span>Manœuvres</span>";

    if (mainNav) {
      if (effectsTab) {
        mainNav.insertBefore(manBtn, effectsTab);
      } else {
        mainNav.appendChild(manBtn);
      }
    }
  } else {
    let sideNav = sheetWindow.querySelector(".mv-side-tabs");
    if (!sideNav) {
      sideNav = document.createElement("nav");
      sideNav.classList.add("mv-side-tabs");
      sideNav.setAttribute("aria-label", "Navigation secondaire");
      sheetWindow.appendChild(sideNav);
    }

    manBtn = document.createElement("a");
    manBtn.dataset.action = "tab";
    manBtn.dataset.group = "primary";
    manBtn.dataset.tab = "manoeuvres";
    manBtn.classList.add("mv-side-tab-btn", "mv-man-side-btn");
    manBtn.dataset.tooltip = "Manœuvres";
    manBtn.innerHTML = '<i class="fas fa-fist-raised"></i>';

    const sortBtn = sideNav.querySelector('[data-tab="sort"], [data-tab="spells"]');
    if (sortBtn) {
      sideNav.insertBefore(manBtn, sortBtn);
    } else {
      sideNav.insertBefore(manBtn, sideNav.firstChild);
    }

    sideNav.classList.toggle("mv-sheet-minimized", app.minimized === true);
  }

  const deactivateManoeuvresTab = () => {
    app._mvManoeuvresActive = false;
    manBtn.classList.remove("active");
    manSection.classList.remove("active");
  };

  const activateManoeuvresTab = () => {
    app._mvManoeuvresActive = true;
    // Ne jamais écrire "manoeuvres" dans app.tabGroups : le système ne connaît pas cet onglet et la fiche
    // plantait (puis refusait de se rouvrir) au rendu suivant. L'onglet est affiché uniquement via le DOM.
    sheetWindow.querySelectorAll('[data-action="tab"][data-group="primary"]').forEach(b => {
      b.classList.toggle("active", b.dataset.tab === "manoeuvres");
    });
    contentArea.querySelectorAll('section.tab[data-group="primary"]').forEach(s => {
      s.classList.toggle("active", s.dataset.tab === "manoeuvres");
    });
  };

  manBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    activateManoeuvresTab();
  });

  // Délégation globale sur la fenêtre pour détecter tout clic sur un autre onglet (Principal, Inventaire, etc.)
  if (sheetWindow.dataset.mvManTabDelegated !== "true") {
    sheetWindow.dataset.mvManTabDelegated = "true";
    sheetWindow.addEventListener("click", (ev) => {
      const clickedTab = ev.target.closest('[data-action="tab"][data-group="primary"]');
      if (!clickedTab || clickedTab.dataset.tab === "manoeuvres") return;

      const wasActive = app._mvManoeuvresActive;
      app._mvManoeuvresActive = false;
      sheetWindow.querySelectorAll(".mv-man-side-btn, .mv-man-main-tab-btn").forEach(b => b.classList.remove("active"));
      const sec = contentArea.querySelector('section.tab[data-tab="manoeuvres"]');
      if (sec) sec.classList.remove("active");

      // Retour vers l'onglet que Foundry croit déjà actif : il ne fait rien, on réaffiche l'onglet nous-mêmes
      if (wasActive && app.tabGroups?.primary === clickedTab.dataset.tab) {
        const tabId = clickedTab.dataset.tab;
        sheetWindow.querySelectorAll('[data-action="tab"][data-group="primary"]').forEach(b => {
          b.classList.toggle("active", b.dataset.tab === tabId);
        });
        contentArea.querySelectorAll('section.tab[data-group="primary"]').forEach(s => {
          s.classList.toggle("active", s.dataset.tab === tabId);
        });
      }
    }, true);
  }

  if (app._mvManoeuvresActive) {
    activateManoeuvresTab();
  } else {
    deactivateManoeuvresTab();
  }
}

Hooks.on("renderCOCharacterSheet", injectManoeuvresTab);
Hooks.on("renderCOEncounterSheet", injectManoeuvresTab);