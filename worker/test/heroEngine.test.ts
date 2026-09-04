import { describe, it, expect } from 'vitest';
import { questStep } from '../src/heroEngine';
import { QUEST_SCRIPTS } from '../src/questScripts';
import { mulberry32 } from '../src/rng';

const hero = { hp: 100, max_hp: 100, attack: 50 };

describe('questStep', () => {
  it('fleeing ends the quest without damaging the hero', () => {
    const outcome = questStep(hero, QUEST_SCRIPTS.goblin_warren, 0, 'flee', mulberry32(1));
    expect(outcome.status).toBe('failed_fled');
    expect(outcome.heroHpAfter).toBe(hero.hp);
  });

  it('a loot node always succeeds and grants its gold regardless of action', () => {
    const outcome = questStep(hero, QUEST_SCRIPTS.goblin_warren, 1, 'attack', mulberry32(1));
    expect(outcome.goldGained).toBe(QUEST_SCRIPTS.goblin_warren.nodes[1].goldReward);
    expect(outcome.nextNodeIndex).toBe(2);
    expect(outcome.status).toBe('active');
  });

  it('an overwhelmingly strong hero clears a weak node and advances', () => {
    const strongHero = { hp: 100, max_hp: 100, attack: 1000 };
    const outcome = questStep(strongHero, QUEST_SCRIPTS.goblin_warren, 0, 'attack', mulberry32(1));
    expect(outcome.status).toBe('active');
    expect(outcome.nextNodeIndex).toBe(1);
    expect(outcome.goldGained).toBeGreaterThan(0);
  });

  it('clearing the final boss node completes the quest', () => {
    const strongHero = { hp: 100, max_hp: 100, attack: 1000 };
    const lastIndex = QUEST_SCRIPTS.goblin_warren.nodes.length - 1;
    const outcome = questStep(strongHero, QUEST_SCRIPTS.goblin_warren, lastIndex, 'attack', mulberry32(1));
    expect(outcome.status).toBe('completed');
    expect(outcome.nextNodeIndex).toBe(QUEST_SCRIPTS.goblin_warren.nodes.length);
  });

  it('a hero far too weak for the dragon is eventually defeated, not just wounded forever', () => {
    const weakHero = { hp: 20, max_hp: 20, attack: 1 };
    const dragonNodeIndex = QUEST_SCRIPTS.dragons_lair.nodes.length - 1;
    let sawDefeat = false;
    let currentHp = weakHero.hp;
    for (let seed = 1; seed < 100 && !sawDefeat; seed++) {
      const outcome = questStep({ ...weakHero, hp: currentHp }, QUEST_SCRIPTS.dragons_lair, dragonNodeIndex, 'attack', mulberry32(seed));
      if (outcome.status === 'failed_defeated') {
        sawDefeat = true;
        expect(outcome.heroHpAfter).toBe(0);
      } else {
        currentHp = outcome.heroHpAfter;
      }
    }
    expect(sawDefeat).toBe(true);
  });

  it('use_item heals but never advances the node', () => {
    const outcome = questStep({ hp: 50, max_hp: 100, attack: 50 }, QUEST_SCRIPTS.bandit_hideout, 0, 'use_item', mulberry32(1));
    expect(outcome.nextNodeIndex).toBe(0);
    expect(outcome.status !== 'completed').toBe(true);
  });
});
