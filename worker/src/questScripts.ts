// The three hand-authored quest scripts — DESIGN.md §6. Node-sequence data only;
// resolution logic lives in heroEngine.ts.

export interface QuestNode {
  id: string;
  kind: 'challenge' | 'loot';
  label: string;
  danger: number; // 0 for loot nodes
  goldReward: number;
  isBoss: boolean;
}

export interface QuestScript {
  key: 'goblin_warren' | 'bandit_hideout' | 'dragons_lair';
  name: string;
  type: 'dungeon' | 'dragon';
  difficulty: 1 | 2 | 3;
  nodes: QuestNode[];
}

export const QUEST_SCRIPTS: Record<QuestScript['key'], QuestScript> = {
  goblin_warren: {
    key: 'goblin_warren',
    name: 'Goblin Warren',
    type: 'dungeon',
    difficulty: 1,
    nodes: [
      { id: 'n1', kind: 'challenge', label: 'Goblin scouts block the tunnel entrance', danger: 25, goldReward: 20, isBoss: false },
      { id: 'n2', kind: 'loot', label: 'A pile of crude plunder', danger: 0, goldReward: 40, isBoss: false },
      { id: 'n3', kind: 'challenge', label: 'The goblin chieftain, club in hand', danger: 40, goldReward: 80, isBoss: true },
    ],
  },
  bandit_hideout: {
    key: 'bandit_hideout',
    name: "Bandit Hideout",
    type: 'dungeon',
    difficulty: 2,
    nodes: [
      { id: 'n1', kind: 'challenge', label: 'Bandit lookouts spot you', danger: 35, goldReward: 25, isBoss: false },
      { id: 'n2', kind: 'challenge', label: 'A trapped strongbox', danger: 30, goldReward: 30, isBoss: false },
      { id: 'n3', kind: 'loot', label: 'The bandits’ stash', danger: 0, goldReward: 60, isBoss: false },
      { id: 'n4', kind: 'challenge', label: 'The bandit captain and her lieutenants', danger: 55, goldReward: 120, isBoss: true },
    ],
  },
  dragons_lair: {
    key: 'dragons_lair',
    name: "The Dragon's Lair",
    type: 'dragon',
    difficulty: 3,
    nodes: [
      { id: 'n1', kind: 'challenge', label: 'Charred bones litter the entrance — something guards them', danger: 45, goldReward: 40, isBoss: false },
      { id: 'n2', kind: 'challenge', label: 'A narrow ledge over a lava vent', danger: 40, goldReward: 30, isBoss: false },
      { id: 'n3', kind: 'loot', label: 'A hoard of ancient treasure', danger: 0, goldReward: 100, isBoss: false },
      { id: 'n4', kind: 'challenge', label: 'Wyrmlings, roused by the noise', danger: 60, goldReward: 90, isBoss: false },
      { id: 'n5', kind: 'challenge', label: 'The dragon itself, wings unfurling', danger: 85, goldReward: 500, isBoss: true },
    ],
  },
};

export function questScriptForKey(key: string): QuestScript | undefined {
  return (QUEST_SCRIPTS as Record<string, QuestScript>)[key];
}
