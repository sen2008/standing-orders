// Hero quest node resolution — DESIGN.md §6. Pure functions, no D1 access.

import type { Rng } from './rng';
import type { QuestScript } from './questScripts';
import {
  HERO_ITEM_HEAL,
  HERO_ITEM_COUNTER_DAMAGE_FRACTION,
  HERO_NODE_DAMAGE_MIN,
  HERO_NODE_DAMAGE_MAX,
  HERO_NODE_XP,
} from './constants';

export type QuestAction = 'attack' | 'use_item' | 'flee';

export interface HeroCombatant {
  hp: number;
  max_hp: number;
  attack: number;
}

export interface QuestStepOutcome {
  heroHpAfter: number;
  goldGained: number;
  xpGained: number;
  nextNodeIndex: number; // unchanged if the node wasn't cleared this step
  status: 'active' | 'completed' | 'failed_defeated' | 'failed_fled';
  message: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function questStep(
  hero: HeroCombatant,
  script: QuestScript,
  currentNodeIndex: number,
  action: QuestAction,
  rng: Rng
): QuestStepOutcome {
  const node = script.nodes[currentNodeIndex];

  if (action === 'flee') {
    return {
      heroHpAfter: hero.hp,
      goldGained: 0,
      xpGained: 0,
      nextNodeIndex: currentNodeIndex,
      status: 'failed_fled',
      message: 'You retreat, quest abandoned but safe.',
    };
  }

  if (node.kind === 'loot') {
    const advanced = currentNodeIndex + 1;
    const done = advanced >= script.nodes.length;
    return {
      heroHpAfter: hero.hp,
      goldGained: node.goldReward,
      xpGained: HERO_NODE_XP,
      nextNodeIndex: advanced,
      status: done ? 'completed' : 'active',
      message: `You claim ${node.label.toLowerCase()} — ${node.goldReward} gold.`,
    };
  }

  // Challenge node.
  if (action === 'use_item') {
    const counterDamage = Math.round(rollDamage(rng) * HERO_ITEM_COUNTER_DAMAGE_FRACTION);
    const hp = clamp(hero.hp + HERO_ITEM_HEAL - counterDamage, 0, hero.max_hp);
    if (hp <= 0) {
      return {
        heroHpAfter: 0,
        goldGained: 0,
        xpGained: 0,
        nextNodeIndex: currentNodeIndex,
        status: 'failed_defeated',
        message: 'You are struck down while reaching for a potion.',
      };
    }
    return {
      heroHpAfter: hp,
      goldGained: 0,
      xpGained: 0,
      nextNodeIndex: currentNodeIndex,
      status: 'active',
      message: `You quaff a potion, healing while ${node.label.toLowerCase()} presses the attack.`,
    };
  }

  // action === 'attack'
  const successChance = clamp(hero.attack / Math.max(1, node.danger), 0.05, 0.9);
  if (rng() < successChance) {
    const advanced = currentNodeIndex + 1;
    const done = advanced >= script.nodes.length;
    return {
      heroHpAfter: hero.hp,
      goldGained: node.goldReward,
      xpGained: HERO_NODE_XP * (node.isBoss ? 3 : 1),
      nextNodeIndex: advanced,
      status: done ? 'completed' : 'active',
      message: node.isBoss ? `You defeat ${node.label.toLowerCase()}!` : `You overcome ${node.label.toLowerCase()}.`,
    };
  }

  const damage = rollDamage(rng) * (node.isBoss ? 1.5 : 1);
  const hp = Math.max(0, hero.hp - Math.round(damage));
  if (hp <= 0) {
    return {
      heroHpAfter: 0,
      goldGained: 0,
      xpGained: 0,
      nextNodeIndex: currentNodeIndex,
      status: 'failed_defeated',
      message: `${node.label} strikes you down.`,
    };
  }
  return {
    heroHpAfter: hp,
    goldGained: 0,
    xpGained: 0,
    nextNodeIndex: currentNodeIndex,
    status: 'active',
    message: `${node.label} wounds you — try again.`,
  };
}

function rollDamage(rng: Rng): number {
  return HERO_NODE_DAMAGE_MIN + Math.floor(rng() * (HERO_NODE_DAMAGE_MAX - HERO_NODE_DAMAGE_MIN + 1));
}
