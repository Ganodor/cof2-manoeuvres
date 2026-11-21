/* ==========================================================================
   1. CONSTANTES DU MODULE ET ENREGISTREMENT DES ÉTATS & PARAMÈTRES (INIT)
   ========================================================================== */

const MODULE_ID = "cof2-manoeuvres";
const SOCKET_NAME = "module." + MODULE_ID;

Hooks.once("init", () => {
  const customStatuses = [
    {
      id: "manoeuvre-distraire",
      name: "Distrait (Manœuvre)",
      img: "icons/tools/instruments/lute-gold-brown.webp",
      changes: [
        { key: "system.abilities.per.bonuses.effects", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-10" },
        { key: "system.combat.def.bonuses.effects", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-5" }
      ]
    },
    {
      id: "manoeuvre-gener",
      name: "Gêné (-5 attaque)",
      img: "icons/magic/control/debuff-chains-purple.webp",
      changes: [
        { key: "system.combat.melee.bonuses.effects", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-5" },
        { key: "system.combat.ranged.bonuses.effects", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-5" },
        { key: "system.combat.magic.bonuses.effects", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-5" }
      ]
    },
    {
      id: "manoeuvre-repousser",
      name: "Acculé (Repoussé)",
      img: "icons/skills/melee/unarmed-punch-fist-yellow-red.webp",
      changes: []
    },
    {
      id: "manoeuvre-desarmer",
      name: "Désarmé (Arme au sol)",
      img: "icons/skills/melee/strike-sword-slashing-red.webp",
      changes: []
    }
  ];

  for (const st of customStatuses) {
    if (!CONFIG.statusEffects.some(e => e.id === st.id)) {
      CONFIG.statusEffects.push(st);
    }
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
    img: "icons/skills/melee/strike-sword-slashing-red.webp",
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
    img: "icons/magic/perception/eye-ringed-glow-angry-red.webp",
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
    img: "icons/skills/movement/figure-running-gray.webp",
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

function getActorAttackBonusByType(actor, attackType) {
  const sys = actor?.system || {};
  const level = Number(sys.details?.level ?? sys.level ?? sys.niveau ?? 1) || 1;

  const readCombatStat = (candidates) => {
    for (const val of candidates) {
      if (typeof val === "number" && Number.isFinite(val)) return val;
      if (val && typeof val === "object") {
        if (typeof val.total === "number") return val.total;
        if (typeof val.value === "number") return val.value;
        if (typeof val.base === "number") {
          return val.base + (Number(val.bonuses?.sheet ?? 0) || 0) + (Number(val.bonuses?.effects ?? 0) || 0);
        }
      }
    }
    return null;
  };

  if (attackType === "finesse") {
    const fin = readCombatStat([sys.combat?.finesse, sys.attacks?.finesse]);
    return fin !== null ? fin : level + getActorAbilityTotal(actor, "agi");
  }

  if (attackType === "ranged") {
    const ranged = readCombatStat([sys.combat?.ranged, sys.combat?.distance, sys.attacks?.ranged, sys.attacks?.distance]);
    return ranged !== null ? ranged : level + getActorAbilityTotal(actor, "agi");
  }

  if (attackType === "magic") {
    const magic = readCombatStat([sys.combat?.magic, sys.combat?.magique, sys.attacks?.magic, sys.attacks?.magique]);
    if (magic !== null) return magic;
    const bestMental = Math.max(
      getActorAbilityTotal(actor, "int"),
      getActorAbilityTotal(actor, "vol"),
      getActorAbilityTotal(actor, "cha")
    );
    return level + bestMental;
  }

  const melee = readCombatStat([sys.combat?.melee, sys.combat?.contact, sys.attacks?.melee, sys.attacks?.contact]);
  return melee !== null ? melee : level + getActorAbilityTotal(actor, "for");
}

function getActorChaMod(actor) {
  return getActorAbilityTotal(actor, "cha");
}

// Vérifie si l'acteur possède un profil principal de la famille des combattants
function isActorMainCombatantProfile(actor) {
  if (!actor?.items) return false;
  return actor.items.some(i =>
    i.type === "profile" &&
    i.system?.mainProfile === true &&
    String(i.system?.family || "").toLowerCase() === "combattant"
  );
}

// Additionne les bonus provenant du module compagnon (Cof2 - Manoeuvres +)
function getManoeuvreItemAndEffectBonuses(actor, manoeuvre) {
  if (!actor) return { total: 0, sources: [] };

  let total = 0;
  const sources = [];
  const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const targetId = normalize(manoeuvre.id);

  for (const item of actor.items) {
    const sys = item.system || {};
    if (sys.equipped === false) continue;
    if (typeof sys.learned === "boolean" && !sys.learned) continue;
    if (typeof sys.acquired === "boolean" && !sys.acquired) continue;

    if (Array.isArray(sys.actions)) {
      const plusMap = item.getFlag("cof2-manoeuvres-plus", "modifiers") || {};

      sys.actions.forEach((action, actionIdx) => {
        if (!Array.isArray(action.modifiers)) return;
        const requiresEquip = Array.isArray(action.conditions) && action.conditions.some(c => c.predicate === "isEquipped");
        if (requiresEquip && sys.equipped !== true) return;

        action.modifiers.forEach((mod, modIdx) => {
          const plusEntry = plusMap[`${actionIdx}_${modIdx}`];
          if (mod?.subtype !== "manoeuvre" && !plusEntry) return;

          // Si le bonus vient d'une propriété d'arme, exige un profil principal de la famille des combattants
          if (plusEntry?.isWeaponPreset && !isActorMainCombatantProfile(actor)) return;

          // Si le bonus vient d'une arme polyvalente tenue à 1 main (bouclier équipé), on le suspend
          if (plusEntry?.isWeaponPreset && game.modules.get("cof2-arme-polyvalent")?.active && item.getFlag("cof2-arme-polyvalent", "grip") === "1h") {
            return;
          }

          const modTarget = normalize(plusEntry?.target || mod.target || "all");
          const val = Number(plusEntry?.value ?? mod.value ?? 0);
          if (!Number.isFinite(val) || val === 0) return;

          if (modTarget === "all" || modTarget === targetId) {
            total += val;
            sources.push(item.name + " " + (val >= 0 ? "+" : "") + val);
          }
        });
      });
    }
  }

  return { total, sources };
}

function getDiminishingReturnsCount(actor, targetToken, manoeuvreId) {
  const combat = game.combat;
  if (!combat || !actor || !targetToken) return 0;

  const history = combat.getFlag(MODULE_ID, "manoeuvreHistory") || {};
  const key = actor.id + "_" + targetToken.id + "_" + manoeuvreId;
  return Number(history[key] || 0);
}

async function incrementDiminishingReturnsCount(actor, targetToken, manoeuvreId) {
  const combat = game.combat;
  if (!combat || !actor || !targetToken) return;

  const history = foundry.utils.deepClone(combat.getFlag(MODULE_ID, "manoeuvreHistory") || {});
  const key = actor.id + "_" + targetToken.id + "_" + manoeuvreId;
  history[key] = (Number(history[key] || 0)) + 1;
  await combat.setFlag(MODULE_ID, "manoeuvreHistory", history);
}

/* ==========================================================================
   4. APPLICATION DES ÉTATS PRÉJUDICIABLES, RELAIS SOCKET MJ & EXPIRATION
   ========================================================================== */

function resolveActorFromPayload(payload) {
  if (payload.targetTokenId && canvas?.tokens) {
    const tok = canvas.tokens.get(payload.targetTokenId);
    if (tok?.actor) return tok.actor;
  }
  if (payload.targetActorId) {
    const act = game.actors.get(payload.targetActorId);
    if (act) return act;
  }
  return null;
}

function buildExpiryFlag(attackerActorId) {
  const combat = game.combat;
  if (!combat || !attackerActorId) return null;
  const attackerCombatant = combat.combatants.find(c => c.actorId === attackerActorId);
  if (!attackerCombatant) return null;
  return {
    combatId: combat.id,
    attackerCombatantId: attackerCombatant.id,
    createdRound: combat.round ?? 0,
    createdTurn: combat.turn ?? 0
  };
}

async function executeApplyManoeuvreOutcome(payload) {
  const targetActor = resolveActorFromPayload(payload);
  if (!targetActor) return;

  const expiry = buildExpiryFlag(payload.attackerActorId);
  const manId = payload.manoeuvreId;

  const applyNativeStatus = async (statusId, hasExpiry, dynamicChanges = null) => {
    if (!targetActor.statuses?.has(statusId)) {
      await targetActor.toggleStatusEffect(statusId, { active: true });
    }
    const statusEffect = targetActor.effects.find(e => e.statuses?.has(statusId));
    if (statusEffect) {
      if (Array.isArray(dynamicChanges) && dynamicChanges.length > 0) {
        await statusEffect.update({ changes: dynamicChanges });
      }
      if (hasExpiry && expiry) {
        await statusEffect.setFlag(MODULE_ID, "expiry", expiry);
        await statusEffect.setFlag(MODULE_ID, "appliedManoeuvre", manId);
      }
    }
  };

  if (manId === "distraire") {
    await applyNativeStatus("manoeuvre-distraire", true);
  } else if (manId === "gener") {
    if (payload.generChoice === "attackPenalty") {
      await applyNativeStatus("manoeuvre-gener", true);
    } else {
      await applyNativeStatus("slowed", true);
    }
  } else if (manId === "repousser") {
    if (payload.isCornered) {
      const defMalus = -Math.abs(Number(payload.repousserDefMalus || 3));
      await applyNativeStatus("manoeuvre-repousser", true, [
        { key: "system.combat.def.bonuses.effects", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(defMalus) }
      ]);
    }
  } else if (manId === "bloquer") {
    await applyNativeStatus("immobilized", true);
  } else if (manId === "desarmer") {
    await applyNativeStatus("manoeuvre-desarmer", false);
  } else if (manId === "aveugler") {
    await applyNativeStatus("blind", true);
  } else if (manId === "renverser") {
    await applyNativeStatus("overturned", false);
  } else if (manId === "etourdir") {
    await applyNativeStatus("stun", true);
  }
}

async function applyManoeuvreOutcome(payload) {
  const targetActor = resolveActorFromPayload(payload);
  if (!targetActor) return;

  if (targetActor.isOwner || game.user.isGM) {
    await executeApplyManoeuvreOutcome(payload);
  } else {
    game.socket.emit(SOCKET_NAME, {
      action: "applyManoeuvreOutcome",
      payload
    });
  }
}

Hooks.once("ready", () => {
  game.socket.on(SOCKET_NAME, async (data) => {
    if (!game.user.isGM) return;
    const activeGM = game.users.activeGM;
    if (activeGM && activeGM.id !== game.user.id) return;

    if (data?.action === "applyManoeuvreOutcome" && data.payload) {
      await executeApplyManoeuvreOutcome(data.payload);
    }
  });
});

Hooks.on("combatTurnChange", async (combat, prior, current) => {
  if (!game.user.isGM) return;
  const activeGM = game.users.activeGM;
  if (activeGM && activeGM.id !== game.user.id) return;

  const currentCombatant = combat.combatant;
  if (!currentCombatant) return;

  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;

    const toDelete = [];
    const expiredSlugs = new Set();

    for (const effect of actor.effects) {
      const expiry = effect.getFlag(MODULE_ID, "expiry");
      if (!expiry) continue;
      if (expiry.combatId !== combat.id) continue;
      if (expiry.attackerCombatantId !== currentCombatant.id) continue;

      const isLaterTurn =
        (combat.round > expiry.createdRound) ||
        (combat.round === expiry.createdRound && combat.turn > expiry.createdTurn);

      if (isLaterTurn) {
        toDelete.push(effect.id);
        const manId = effect.getFlag(MODULE_ID, "appliedManoeuvre");
        if (manId) expiredSlugs.add("manoeuvre-" + manId);
      }
    }

    if (toDelete.length > 0) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    }

    if (expiredSlugs.size > 0 && Array.isArray(actor.system?.currentEffects)) {
      const cleaned = actor.system.currentEffects.filter(ce => !expiredSlugs.has(ce.slug));
      await actor.update({ "system.currentEffects": cleaned });
    }
  }
});

Hooks.on("deleteCombat", async (combat) => {
  if (!game.user.isGM) return;
  const activeGM = game.users.activeGM;
  if (activeGM && activeGM.id !== game.user.id) return;

  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;

    const toDelete = [];
    const expiredSlugs = new Set();

    for (const effect of actor.effects) {
      const expiry = effect.getFlag(MODULE_ID, "expiry");
      if (expiry && expiry.combatId === combat.id) {
        toDelete.push(effect.id);
        const manId = effect.getFlag(MODULE_ID, "appliedManoeuvre");
        if (manId) expiredSlugs.add("manoeuvre-" + manId);
      }
    }

    if (toDelete.length > 0) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    }

    if (expiredSlugs.size > 0 && Array.isArray(actor.system?.currentEffects)) {
      const cleaned = actor.system.currentEffects.filter(ce => !expiredSlugs.has(ce.slug));
      await actor.update({ "system.currentEffects": cleaned });
    }
  }
});

/* ==========================================================================
   5. BOÎTE DE DIALOGUE DE L'ATTAQUANT ET JET DE MANŒUVRE
   ========================================================================== */

async function rollManoeuvre(actor, manoeuvre) {
  const chaBonus = manoeuvre.useCha ? getActorChaMod(actor) : 0;
  const targetToken = game.user?.targets?.first() || null;
  const inCombatWithTarget = Boolean(game.combat && targetToken);
  const autoPriorCount = inCombatWithTarget ? getDiminishingReturnsCount(actor, targetToken, manoeuvre.id) : 0;
  const diminishingPenalty = inCombatWithTarget ? -5 * autoPriorCount : 0;
  const extraBonuses = getManoeuvreItemAndEffectBonuses(actor, manoeuvre);
  const attackerForMod = getActorAbilityTotal(actor, "for");
  const repousserDistance = attackerForMod + 3;

  const repetitionLineHtml = autoPriorCount > 0
    ? '<div class="mv-man-repetition-info">' +
        '<i class="fas fa-redo-alt"></i> ' +
        '<span>Répétitions sur cette cible : <strong>' + autoPriorCount + '</strong> (' + diminishingPenalty + ')</span>' +
      '</div>'
    : "";

  let extraFieldsHtml = "";
  if (manoeuvre.id === "gener") {
    extraFieldsHtml +=
      '<div class="mv-man-row-opt">' +
        '<label>Effet si réussite :</label>' +
        '<select name="generChoice">' +
          '<option value="slowed">Cible ralentie (1 action M ou A)</option>' +
          '<option value="attackPenalty">Malus de -5 en attaque</option>' +
        '</select>' +
      '</div>';
  }
  if (manoeuvre.id === "repousser") {
    extraFieldsHtml +=
      '<label class="mv-man-opt">' +
        '<input type="checkbox" name="isCornered"/> Cible acculée (perd ' + repousserDistance + ' en DEF pendant 1 round)' +
      '</label>';
  }
  if (manoeuvre.id === "renverser") {
    extraFieldsHtml +=
      '<label class="mv-man-opt">' +
        '<input type="checkbox" name="isQuadruped"/> Cible quadrupède (malus -10 au lieu de -5)' +
      '</label>';
  }
  if (manoeuvre.sizeSensitive) {
    extraFieldsHtml +=
      '<div class="mv-man-row-opt">' +
        '<label>Différence de taille (*):</label>' +
        '<select name="sizeDiff">' +
          '<option value="0">Même taille (0)</option>' +
          '<option value="5">Cible 1 catégorie plus grande (+5)</option>' +
          '<option value="10">Cible 2 catégories plus grandes (+10)</option>' +
          '<option value="-5">Cible 1 catégorie plus petite (-5)</option>' +
          '<option value="-10">Cible 2 catégories plus petites (-10)</option>' +
        '</select>' +
      '</div>';
  }

  const targetImg = targetToken?.document?.texture?.src || targetToken?.actor?.img || "";
  const targetHeadHtml = targetToken && targetImg
    ? '<div class="mv-man-roll-target">' +
        '<span class="mv-man-roll-target-name" title="Cible : ' + targetToken.name + '">' + targetToken.name + '</span>' +
        '<img src="' + targetImg + '" width="36" height="36" title="Cible : ' + targetToken.name + '"/>' +
      '</div>'
    : "";

  const content =
    '<div class="mv-man-roll-dialog">' +
      '<div class="mv-man-roll-head">' +
        '<img src="' + manoeuvre.img + '" width="36" height="36"/>' +
        '<div><strong>' + manoeuvre.name + '</strong></div>' +
        targetHeadHtml +
      '</div>' +
      '<div class="mv-man-formula-box">' +
        '<span class="mv-man-formula-label">Jet calculé :</span>' +
        '<span class="mv-man-formula-text">1d20</span>' +
      '</div>' +
      repetitionLineHtml +
      '<div class="mv-man-row-opt">' +
        '<label>Modificateur circonstanciel :</label>' +
        '<input type="number" name="situational" value="0" step="1"/>' +
      '</div>' +
      '<div class="mv-man-row-opt">' +
        '<label>Type de test d\'attaque :</label>' +
        '<select name="attackType">' +
          '<option value="melee">Attaque au contact (FOR)</option>' +
          '<option value="finesse">Attaque au contact en finesse (AGI)</option>' +
          '<option value="ranged">Attaque à distance (AGI)</option>' +
          '<option value="magic">Attaque magique</option>' +
        '</select>' +
      '</div>' +
      extraFieldsHtml +
    '</div>';

  const DialogImpl = foundry?.appv1?.api?.Dialog || Dialog;
  const RollImpl = foundry?.dice?.Roll || Roll;
  const escapeAttr = (str) => String(str || "").replace(/"/g, "&quot;");

  const computeRollBreakdown = (dlgEl) => {
    const attackType = dlgEl?.querySelector('[name="attackType"]')?.value || "melee";
    const baseAttack = getActorAttackBonusByType(actor, attackType);
    const attackLabels = {
      melee: "Contact",
      finesse: "Contact finesse",
      ranged: "Distance",
      magic: "Magique"
    };

    let mod = manoeuvre.modValue;
    if (manoeuvre.id === "renverser" && dlgEl?.querySelector('[name="isQuadruped"]')?.checked) {
      mod = -10;
    }

    const sizeDiff = Number(dlgEl?.querySelector('[name="sizeDiff"]')?.value || 0);
    const situational = Number(dlgEl?.querySelector('[name="situational"]')?.value || 0);
    const totalBonus = baseAttack + mod + chaBonus + extraBonuses.total + diminishingPenalty + sizeDiff + situational;

    const fmt = (n) => (n >= 0 ? "+ " + n : "- " + Math.abs(n));
    const makeTokenHtml = (val, label) =>
      '<span class="mv-man-formula-token" data-tooltip="' + escapeAttr(label) + '">' + fmt(val) + '</span>';

    const formulaHtmlTokens = ['<span>1d20</span>', makeTokenHtml(baseAttack, attackLabels[attackType])];
    const detailsParts = [attackLabels[attackType] + " " + (baseAttack >= 0 ? "+" : "") + baseAttack];

    if (mod !== 0) {
      formulaHtmlTokens.push(makeTokenHtml(mod, "Manœuvre (" + manoeuvre.name + ")"));
      detailsParts.push("Manœuvre " + (mod >= 0 ? "+" : "") + mod);
    }
    if (manoeuvre.useCha) {
      formulaHtmlTokens.push(makeTokenHtml(chaBonus, "Charisme (CHA)"));
      detailsParts.push("CHA " + (chaBonus >= 0 ? "+" : "") + chaBonus);
    }
    if (extraBonuses.sources.length > 0) {
      formulaHtmlTokens.push(makeTokenHtml(extraBonuses.total, extraBonuses.sources.join(" | ")));
      detailsParts.push(...extraBonuses.sources);
    }
    if (diminishingPenalty !== 0) {
      formulaHtmlTokens.push(makeTokenHtml(diminishingPenalty, "Rendements décroissants (" + autoPriorCount + " répétition(s))"));
      detailsParts.push("Rendements décroissants " + diminishingPenalty);
    }
    if (sizeDiff !== 0) {
      formulaHtmlTokens.push(makeTokenHtml(sizeDiff, "Différence de taille"));
      detailsParts.push("Taille " + (sizeDiff >= 0 ? "+" : "") + sizeDiff);
    }
    if (situational !== 0) {
      formulaHtmlTokens.push(makeTokenHtml(situational, "Modificateur circonstanciel"));
      detailsParts.push("Circonstance " + (situational >= 0 ? "+" : "") + situational);
    }

    return {
      totalBonus,
      formula: "1d20 + " + totalBonus,
      previewHtml: formulaHtmlTokens.join(" "),
      detailsParts
    };
  };

  let dialogRoot = null;

  new DialogImpl(
    {
      title: "Manœuvre : " + manoeuvre.name,
      content,
      render: (html) => {
        dialogRoot = resolveHtmlElement(html);
        if (!dialogRoot) return;
        const formulaTextEl = dialogRoot.querySelector(".mv-man-formula-text");
        const updateFormulaPreview = () => {
          if (!formulaTextEl) return;
          formulaTextEl.innerHTML = computeRollBreakdown(dialogRoot).previewHtml;
        };
        dialogRoot.querySelectorAll("select, input").forEach(el => {
          el.addEventListener("change", updateFormulaPreview);
          el.addEventListener("input", updateFormulaPreview);
        });
        updateFormulaPreview();
      },
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice-d20"></i>',
          label: "Lancer le test opposé",
          callback: async (html) => {
            try {
              const dlgEl = dialogRoot || resolveHtmlElement(html);
              const breakdown = computeRollBreakdown(dlgEl);
              const roll = await new RollImpl(breakdown.formula).evaluate();
              const generChoice = dlgEl?.querySelector('[name="generChoice"]')?.value || "slowed";
              const isCornered = Boolean(dlgEl?.querySelector('[name="isCornered"]')?.checked);
              const targetLine = targetToken ? " — Cible : " + targetToken.name : "";

              const chatContent =
                '<div class="mv-man-chat-card">' +
                  '<div class="mv-man-chat-header">' +
                    '<img src="' + manoeuvre.img + '" width="32" height="32"/>' +
                    '<div>' +
                      '<h4>Manœuvre : ' + manoeuvre.name + ' (' + manoeuvre.modifierLabel + ')' + targetLine + '</h4>' +
                      '<span class="mv-man-chat-sub">' + breakdown.detailsParts.join(" | ") + '</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="mv-man-chat-desc">' + manoeuvre.description + '</div>' +
                  '<div class="mv-man-oppose-zone">' +
                    '<button type="button" class="mv-man-oppose-btn"><i class="fas fa-shield-alt"></i> Lancer le test opposé</button>' +
                  '</div>' +
                '</div>';

              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: chatContent,
                flags: {
                  [MODULE_ID]: {
                    opposedData: {
                      attackerActorId: actor.id,
                      attackerName: actor.name,
                      attackerTotal: roll.total,
                      manoeuvreId: manoeuvre.id,
                      manoeuvreName: manoeuvre.name,
                      manoeuvreImg: manoeuvre.img,
                      generChoice,
                      isCornered,
                      repousserDefMalus: repousserDistance,
                      targetTokenId: targetToken?.id || null,
                      targetActorId: targetToken?.actor?.id || null,
                      targetName: targetToken?.name || "Défenseur",
                      resolved: false
                    }
                  }
                }
              });
            } catch (err) {
              console.error(MODULE_ID + " | Erreur lors du jet de manœuvre :", err);
              ui.notifications.error("Erreur lors du jet de manœuvre : " + err.message);
            }
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Annuler" }
      },
      default: "roll"
    },
    { classes: ["dialog", "mv-man-dialog"], width: 460 }
  ).render(true);
}

/* ==========================================================================
   6. BOÎTE DE DIALOGUE DU DÉFENSEUR ET RÉSOLUTION DU TEST OPPOSÉ
   ========================================================================== */

async function openOpposedManoeuvreDialog(message, opposedData, clickedBtn = null) {
  let defenderActor = null;
  let defenderTokenId = opposedData.targetTokenId || null;

  if (defenderTokenId && canvas?.tokens) {
    const tok = canvas.tokens.get(defenderTokenId);
    defenderActor = tok?.actor || null;
  }
  if (!defenderActor && opposedData.targetActorId) {
    defenderActor = game.actors.get(opposedData.targetActorId) || null;
  }
  if (!defenderActor) {
    const controlledTok = canvas?.tokens?.controlled?.at?.(0);
    if (controlledTok) {
      defenderActor = controlledTok.actor;
      defenderTokenId = controlledTok.id;
    } else {
      defenderActor = game.user?.character || null;
    }
  }

  const defenderName = defenderActor?.name || opposedData.targetName || "Défenseur";

  const content =
    '<div class="mv-man-roll-dialog">' +
      '<div class="mv-man-roll-head">' +
        '<img src="' + (opposedData.manoeuvreImg || "icons/svg/shield.svg") + '" width="36" height="36"/>' +
        '<div>' +
          '<strong>Test opposé : ' + opposedData.manoeuvreName + '</strong>' +
          '<div class="mv-man-chat-sub">Score à égaler ou battre : <strong>' + opposedData.attackerTotal + '</strong> (' + opposedData.attackerName + ')</div>' +
        '</div>' +
      '</div>' +
      '<div class="mv-man-row-opt">' +
        '<label>Test d\'attaque du défenseur :</label>' +
        '<select name="defAttackType">' +
          '<option value="melee">Attaque au contact (FOR)</option>' +
          '<option value="finesse">Attaque au contact en finesse (AGI)</option>' +
          '<option value="ranged">Attaque à distance (AGI)</option>' +
          '<option value="magic">Attaque magique</option>' +
        '</select>' +
      '</div>' +
      '<div class="mv-man-row-opt">' +
        '<label>Modificateur circonstanciel :</label>' +
        '<input type="number" name="defSituational" value="0" step="1"/>' +
      '</div>' +
    '</div>';

  const DialogImpl = foundry?.appv1?.api?.Dialog || Dialog;
  const RollImpl = foundry?.dice?.Roll || Roll;
  let dialogRoot = null;

  new DialogImpl(
    {
      title: "Réponse au test opposé — " + defenderName,
      content,
      render: (html) => { dialogRoot = resolveHtmlElement(html); },
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice-d20"></i>',
          label: "Lancer la défense",
          callback: async (html) => {
            try {
              const dlgEl = dialogRoot || resolveHtmlElement(html);
              if (!dlgEl) return;

              const defType = dlgEl.querySelector('[name="defAttackType"]')?.value || "melee";
              const defSit = Number(dlgEl.querySelector('[name="defSituational"]')?.value || 0);
              const baseDef = defenderActor ? getActorAttackBonusByType(defenderActor, defType) : 0;
              const labels = { melee: "Contact", finesse: "Contact finesse", ranged: "Distance", magic: "Magique" };

              const roll = await new RollImpl("1d20 + " + (baseDef + defSit)).evaluate();
              const attackerWins = Number(opposedData.attackerTotal) > roll.total;
              const outcomeClass = attackerWins ? "mv-man-outcome-success" : "mv-man-outcome-fail";
              const outcomeText = attackerWins
                ? "Manœuvre réussie ! (" + opposedData.attackerName + " " + opposedData.attackerTotal + " vs " + defenderName + " " + roll.total + ") — Effet appliqué à " + defenderName
                : "Manœuvre repoussée ! (" + opposedData.attackerName + " " + opposedData.attackerTotal + " vs " + defenderName + " " + roll.total + ")";

              const subParts = [labels[defType] + " " + (baseDef >= 0 ? "+" : "") + baseDef];
              if (defSit !== 0) subParts.push("Circonstance " + (defSit >= 0 ? "+" : "") + defSit);

              const replyContent =
                '<div class="mv-man-chat-card">' +
                  '<div class="mv-man-chat-header">' +
                    '<img src="' + (opposedData.manoeuvreImg || "icons/svg/shield.svg") + '" width="32" height="32"/>' +
                    '<div><h4>Opposition : ' + opposedData.manoeuvreName + '</h4><span class="mv-man-chat-sub">' + subParts.join(" | ") + '</span></div>' +
                  '</div>' +
                  '<div class="mv-man-outcome ' + outcomeClass + '">' + outcomeText + '</div>' +
                '</div>';

              await roll.toMessage({
                speaker: defenderActor ? ChatMessage.getSpeaker({ actor: defenderActor }) : ChatMessage.getSpeaker({ alias: defenderName }),
                flavor: replyContent
              });

              if (game.combat && opposedData.attackerActorId && defenderTokenId) {
                const attackerActor = game.actors.get(opposedData.attackerActorId);
                const defToken = canvas?.tokens?.get(defenderTokenId);
                if (attackerActor && defToken) await incrementDiminishingReturnsCount(attackerActor, defToken, opposedData.manoeuvreId);
              }

              if (attackerWins && (defenderTokenId || defenderActor)) {
                await applyManoeuvreOutcome({
                  attackerActorId: opposedData.attackerActorId || null,
                  manoeuvreId: opposedData.manoeuvreId,
                  generChoice: opposedData.generChoice || "slowed",
                  isCornered: Boolean(opposedData.isCornered),
                  repousserDefMalus: Number(opposedData.repousserDefMalus || 3),
                  targetTokenId: defenderTokenId,
                  targetActorId: defenderActor?.id || opposedData.targetActorId || null
                });
              }

              if (clickedBtn) {
                clickedBtn.disabled = true;
                clickedBtn.innerHTML = '<i class="fas fa-check"></i> Test opposé effectué';
              }

              if (message && (game.user.isGM || message.isAuthor)) {
                const updatedData = foundry.utils.deepClone(opposedData);
                updatedData.resolved = true;
                await message.setFlag(MODULE_ID, "opposedData", updatedData);
              }
            } catch (err) {
              console.error(MODULE_ID + " | Erreur lors du jet d'opposition :", err);
              ui.notifications.error("Erreur lors du jet d'opposition : " + err.message);
            }
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Annuler" }
      },
      default: "roll"
    },
    { classes: ["dialog", "mv-man-dialog"], width: 440 }
  ).render(true);
}

const syncOpposedChatButtonState = (message, html) => {
  const opposedData = message?.getFlag?.(MODULE_ID, "opposedData");
  if (!opposedData) return;
  const root = resolveHtmlElement(html);
  const btn = root?.querySelector?.(".mv-man-oppose-btn");
  if (btn && opposedData.resolved) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-check"></i> Test opposé effectué';
  }
};

Hooks.on("renderChatMessageHTML", syncOpposedChatButtonState);

Hooks.once("ready", () => {
  document.body.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".mv-man-oppose-btn");
    if (!btn || btn.disabled) return;
    const messageId = btn.closest("[data-message-id]")?.dataset?.messageId;
    if (!messageId) return;
    const message = game.messages?.get(messageId);
    const opposedData = message?.getFlag?.(MODULE_ID, "opposedData");
    if (!opposedData || opposedData.resolved) return;
    ev.preventDefault();
    ev.stopPropagation();
    openOpposedManoeuvreDialog(message, opposedData, btn);
  });
});

/* ==========================================================================
   7. INJECTION DE L'ONGLET MANŒUVRES DANS LES FICHES D'ACTEURS COF2
   ========================================================================== */

function injectManoeuvresTab(app, html) {
  if (game.system.id !== "co2") return;

  const actor = app.actor || app.document;
  if (!actor) return;

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
          '<div class="mv-man-banner-sub">Test opposé d\'attaque au contact (pas de réussite critique). Aucun DM infligé, procure un avantage tactique.</div>' +
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
        rollManoeuvre(actor, man);
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

    const syncSideNavVisibility = () => {
      const isMinimized =
        app.minimized === true ||
        sheetWindow.classList.contains("minimized") ||
        sheetWindow.offsetHeight < 120;
      sideNav.classList.toggle("mv-sheet-minimized", isMinimized);
    };

    syncSideNavVisibility();

    if (sheetWindow._mvManResizeObserver) {
      sheetWindow._mvManResizeObserver.disconnect();
    }
    const resizeObserver = new ResizeObserver(() => syncSideNavVisibility());
    resizeObserver.observe(sheetWindow);
    sheetWindow._mvManResizeObserver = resizeObserver;
  }

  const deactivateManoeuvresTab = () => {
    app._mvManoeuvresActive = false;
    manBtn.classList.remove("active");
    manSection.classList.remove("active");
  };

  const activateManoeuvresTab = () => {
    app._mvManoeuvresActive = true;
    // Synchronise l'état interne de Foundry ApplicationV2 pour que le retour vers un autre onglet fonctionne
    if (app.tabGroups && typeof app.tabGroups === "object") {
      app.tabGroups.primary = "manoeuvres";
    }
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

      app._mvManoeuvresActive = false;
      sheetWindow.querySelectorAll(".mv-man-side-btn, .mv-man-main-tab-btn").forEach(b => b.classList.remove("active"));
      const sec = contentArea.querySelector('section.tab[data-tab="manoeuvres"]');
      if (sec) sec.classList.remove("active");
    }, true);
  }

  if (app._mvManoeuvresActive) {
    activateManoeuvresTab();
  } else {
    deactivateManoeuvresTab();
  }
}

Hooks.on("renderActorSheet", injectManoeuvresTab);
Hooks.on("renderActorSheetV2", injectManoeuvresTab);
Hooks.on("renderCOCharacterSheet", injectManoeuvresTab);
Hooks.on("renderCONpcSheet", injectManoeuvresTab);