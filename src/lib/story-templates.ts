export const STORY_POINTS_PER_TURN = 4;
export const STORY_MAX_ACTION_LENGTH = 500;
export const STORY_MAX_HISTORY_TURNS = 5;

export type StoryStateValue = string | number | string[];
export type StoryState = Record<string, StoryStateValue>;
export type StoryStatePatch = Record<string, unknown>;

export interface StoryMode {
  id: string;
  title: string;
  description: string;
  initialState: StoryState;
}

export interface StoryDifficulty {
  id: "easy" | "normal" | "hard" | "hell" | "custom";
  title: string;
  description: string;
  undoLimit: number;
  riskFactor: number;
  rewardFactor: number;
  rule: string;
}

export interface StoryTemplate {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  premise: string;
  rules: string;
  modes: StoryMode[];
}

export interface StoryTurn {
  action: string;
  narrative: string;
}

export interface StoryPayload {
  requestId: string;
  sessionId: string;
  turnIndex: number;
  templateId: string;
  modeId: string;
  style: string;
  userAction: string;
  history: StoryTurn[];
  state: StoryState;
  summary: string;
  characters: StoryCharacters;
  difficultyId: StoryDifficulty["id"];
  customDifficulty: string;
  memory: StoryMemory;
}

export interface StoryMemory {
  relationships: Record<string, string>;
  promises: string[];
  threads: string[];
  discoveries: string[];
}

export interface StoryProtagonist {
  name: string;
  gender: string;
  age: string;
  personality: string[];
  background: string;
  appearance: string;
}

export interface StorySupportingCharacter {
  name: string;
  relationship: string;
  gender: string;
  age: string;
  personality: string[];
  role: string;
}

export interface StoryCharacters {
  protagonist: StoryProtagonist;
  supportingCast: StorySupportingCharacter[];
}

export interface StoryModelResult {
  narrative: string;
  choices: string[];
  statePatch: StoryStatePatch;
  memory: StoryMemory;
  summary: string;
  ending: boolean;
}

export const STORY_STYLES = [
  "热血成长",
  "轻松幽默",
  "黑暗悬疑",
  "史诗严肃",
] as const;

export const STORY_DIFFICULTIES: StoryDifficulty[] = [
  {
    id: "easy",
    title: "轻松",
    description: "主角光环明显，危机通常留有转机，资源更宽裕。",
    undoLimit: 5,
    riskFactor: 0.7,
    rewardFactor: 1.3,
    rule:
      "优先保证故事体验，危险不会轻易导致无法挽回的失败；关键选择应提供合理转机。",
  },
  {
    id: "normal",
    title: "普通",
    description: "标准成长与冒险，收益和风险相对平衡。",
    undoLimit: 3,
    riskFactor: 1,
    rewardFactor: 1,
    rule: "保持收益与风险平衡，失败会带来代价，但不会无缘无故封死全部道路。",
  },
  {
    id: "hard",
    title: "困难",
    description: "资源紧缺，敌人会适应，错误选择留下长期后果。",
    undoLimit: 2,
    riskFactor: 1.35,
    rewardFactor: 0.8,
    rule:
      "资源与机会更稀缺，敌人和局势会利用主角的错误，失败应产生持续后果。",
  },
  {
    id: "hell",
    title: "地狱",
    description: "首要且几乎唯一的目标是活下来，每次选择都可能致命。",
    undoLimit: 1,
    riskFactor: 1.8,
    rewardFactor: 0.55,
    rule:
      "世界极度危险且资源匮乏，重点是生存；不提供无代价救援，重大失误可能直接结束故事。",
  },
  {
    id: "custom",
    title: "自定义",
    description: "用一句话补充你希望增加的挑战或保护规则。",
    undoLimit: 3,
    riskFactor: 1,
    rewardFactor: 1,
    rule: "在保证安全与角色一致性的前提下，优先遵守玩家的自定义难度规则。",
  },
];

export const DEFAULT_STORY_DIFFICULTY = "normal";

export function getStoryDifficulty(
  difficultyId: unknown,
  customDifficulty: unknown = "",
) {
  const id = STORY_DIFFICULTIES.some((item) => item.id === difficultyId)
    ? (difficultyId as StoryDifficulty["id"])
    : DEFAULT_STORY_DIFFICULTY;
  const difficulty =
    STORY_DIFFICULTIES.find((item) => item.id === id) ??
    STORY_DIFFICULTIES[1];
  return {
    ...difficulty,
    customDifficulty:
      id === "custom" && typeof customDifficulty === "string"
        ? customDifficulty.trim().slice(0, 200)
        : "",
  };
}

export function createInitialStoryMemory(): StoryMemory {
  return {
    relationships: {},
    promises: [],
    threads: [],
    discoveries: [],
  };
}

export function sanitizeStoryMemory(value: unknown): StoryMemory {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const list = (item: unknown) =>
    (Array.isArray(item) ? item : [])
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 12);
  const relationships: Record<string, string> = {};
  if (
    input.relationships &&
    typeof input.relationships === "object" &&
    !Array.isArray(input.relationships)
  ) {
    for (const [name, relation] of Object.entries(
      input.relationships as Record<string, unknown>,
    ).slice(0, 12)) {
      if (typeof relation === "string") {
        relationships[name.slice(0, 20)] = relation.slice(0, 80);
      }
    }
  }
  return {
    relationships,
    promises: list(input.promises),
    threads: list(input.threads),
    discoveries: list(input.discoveries),
  };
}

export function applyDifficultyToInitialState(
  state: StoryState,
  difficultyId: StoryDifficulty["id"],
) {
  const next = structuredClone(state);
  const difficulty = getStoryDifficulty(difficultyId);
  const resourceFactor =
    difficulty.id === "easy"
      ? difficulty.rewardFactor
      : difficulty.id === "hard" || difficulty.id === "hell"
        ? difficulty.riskFactor
          ? 1 / difficulty.riskFactor
          : 1
        : 1;
  const resourceKeys = ["spiritStones", "food", "water", "defense"];
  for (const key of resourceKeys) {
    if (typeof next[key] === "number") {
      next[key] = Math.max(
        0,
        Math.round(Number(next[key]) * resourceFactor),
      );
    }
  }
  return next;
}

const safeText = (value: unknown, maximum: number) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

const safePersonality = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 12))
    .filter(Boolean)
    .slice(0, 3);

export function sanitizeStoryCharacters(value: unknown): StoryCharacters {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const protagonistInput =
    input.protagonist &&
    typeof input.protagonist === "object" &&
    !Array.isArray(input.protagonist)
      ? (input.protagonist as Record<string, unknown>)
      : {};
  const supportingInput = Array.isArray(input.supportingCast)
    ? input.supportingCast
    : [];

  return {
    protagonist: {
      name: safeText(protagonistInput.name, 20),
      gender: safeText(protagonistInput.gender, 20),
      age: safeText(protagonistInput.age, 30),
      personality: safePersonality(protagonistInput.personality),
      background: safeText(protagonistInput.background, 160),
      appearance: safeText(protagonistInput.appearance, 160),
    },
    supportingCast: supportingInput
      .slice(0, 3)
      .map((item) => {
        const character =
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : {};
        return {
          name: safeText(character.name, 20),
          relationship: safeText(character.relationship, 40),
          gender: safeText(character.gender, 20),
          age: safeText(character.age, 30),
          personality: safePersonality(character.personality),
          role: safeText(character.role, 60),
        };
      })
      .filter((character) => character.name || character.relationship),
  };
}

export function emptyStoryCharacters(): StoryCharacters {
  return {
    protagonist: {
      name: "",
      gender: "",
      age: "",
      personality: [],
      background: "",
      appearance: "",
    },
    supportingCast: [],
  };
}

export const STORY_TEMPLATES: StoryTemplate[] = [
  {
    id: "cultivation",
    title: "问仙录",
    eyebrow: "CULTIVATION",
    description: "从凡尘到仙途，每一次选择都会改变境界、资源与因果。",
    premise:
      "一个灵气复苏、宗门林立的世界。主角必须在修行、人情、秘境与天劫之间做出选择。",
    rules:
      "力量成长要循序渐进，除非模式明确说明开局极强。境界变化必须有合理契机。宗门、因果和资源会影响后续选择。",
    modes: [
      {
        id: "mortal",
        title: "凡尘起步",
        description: "资质普通，从炼气一层开始，用选择和机遇逆天改命。",
        initialState: {
          realm: "炼气一层",
          cultivation: 0,
          spiritStones: 5,
          reputation: 0,
          inventory: ["旧木剑"],
        },
      },
      {
        id: "prodigy",
        title: "天骄开局",
        description: "身负上品灵根，被宗门重点培养，但也会引来更多觊觎。",
        initialState: {
          realm: "炼气九层",
          cultivation: 80,
          spiritStones: 80,
          reputation: 20,
          inventory: ["青锋剑", "聚气丹"],
        },
      },
      {
        id: "invincible",
        title: "开局无敌",
        description: "修为已至化神初期，却带着旧伤和未知敌人重返人间。",
        initialState: {
          realm: "化神初期",
          cultivation: 9000,
          spiritStones: 500,
          reputation: 100,
          inventory: ["残破仙印"],
        },
      },
    ],
  },
  {
    id: "apocalypse",
    title: "余烬之后",
    eyebrow: "AFTER THE FALL",
    description: "灾变后的世界没有正确答案，只有活下去和让更多人活下去。",
    premise:
      "文明崩塌后的第七个月，城市被污染区和变异生物割裂。幸存者需要物资、据点和彼此信任。",
    rules:
      "物资会消耗，受伤和战斗必须付出代价。基地建设需要资源、人力和时间，不能凭空升级。",
    modes: [
      {
        id: "wasteland",
        title: "废土生存",
        description: "独自醒在废弃地铁站，只有半瓶水和一只旧手电。",
        initialState: {
          day: 1,
          food: 1,
          water: 1,
          baseLevel: 0,
          defense: 0,
          survivors: 0,
          inventory: ["旧手电"],
        },
      },
      {
        id: "base-builder",
        title: "升级基地",
        description: "带着四名幸存者守住一座旧仓库，在废墟中扩建成聚落。",
        initialState: {
          day: 1,
          food: 12,
          water: 10,
          baseLevel: 1,
          defense: 3,
          survivors: 4,
          inventory: ["工具箱", "无线电"],
        },
      },
    ],
  },
];

export function getStoryTemplate(templateId: string) {
  return STORY_TEMPLATES.find((template) => template.id === templateId);
}

export function getStoryMode(templateId: string, modeId: string) {
  return getStoryTemplate(templateId)?.modes.find(
    (mode) => mode.id === modeId,
  );
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function sanitizeStoryState(
  templateId: string,
  state: unknown,
): StoryState {
  const template = getStoryTemplate(templateId);
  const defaultState = template?.modes[0]?.initialState ?? {};
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return structuredClone(defaultState);
  }

  const input = state as Record<string, unknown>;
  if (templateId === "cultivation") {
    return {
      realm:
        typeof input.realm === "string"
          ? input.realm.slice(0, 24)
          : String(defaultState.realm ?? "凡人"),
      cultivation: clamp(Number(input.cultivation) || 0, 0, 9_999_999),
      spiritStones: clamp(Number(input.spiritStones) || 0, 0, 99_999_999),
      reputation: clamp(Number(input.reputation) || 0, -100_000, 100_000),
      inventory: Array.isArray(input.inventory)
        ? input.inventory
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.slice(0, 40))
            .slice(0, 20)
        : [],
    };
  }

  if (templateId === "apocalypse") {
    return {
      day: clamp(Math.round(Number(input.day) || 1), 1, 99_999),
      food: clamp(Math.round(Number(input.food) || 0), 0, 9_999_999),
      water: clamp(Math.round(Number(input.water) || 0), 0, 9_999_999),
      baseLevel: clamp(Math.round(Number(input.baseLevel) || 0), 0, 100),
      defense: clamp(Math.round(Number(input.defense) || 0), 0, 999_999),
      survivors: clamp(
        Math.round(Number(input.survivors) || 0),
        0,
        100_000,
      ),
      inventory: Array.isArray(input.inventory)
        ? input.inventory
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.slice(0, 40))
            .slice(0, 20)
        : [],
    };
  }

  return structuredClone(defaultState);
}

export function applyStoryStatePatch(
  templateId: string,
  currentState: StoryState,
  patch: StoryStatePatch,
  difficultyId: StoryDifficulty["id"] = "normal",
) {
  const next = structuredClone(currentState);
  const difficulty = getStoryDifficulty(difficultyId);
  const scaleDelta = (key: string, value: number) => {
    if (key === "day") return value;
    return value >= 0
      ? Math.round(value * difficulty.rewardFactor)
      : Math.round(value * difficulty.riskFactor);
  };

  if (templateId === "cultivation") {
    for (const key of ["cultivation", "spiritStones", "reputation"]) {
      const value = Number(patch[key]);
      if (Number.isFinite(value) && typeof next[key] === "number") {
        next[key] =
          Number(next[key]) +
          clamp(scaleDelta(key, value), -10_000, 10_000);
      }
    }
    if (typeof patch.realm === "string" && patch.realm.trim()) {
      next.realm = patch.realm.trim().slice(0, 24);
    }
  }

  if (templateId === "apocalypse") {
    for (const key of [
      "food",
      "water",
      "baseLevel",
      "defense",
      "survivors",
      "day",
    ]) {
      const value = Number(patch[key]);
      if (Number.isFinite(value) && typeof next[key] === "number") {
        next[key] =
          Number(next[key]) +
          clamp(scaleDelta(key, value), -10_000, 10_000);
      }
    }
  }

  if (Array.isArray(patch.inventory)) {
    const currentInventory = Array.isArray(next.inventory)
      ? next.inventory
      : [];
    const additions = patch.inventory
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 40))
      .filter(Boolean);
    next.inventory = [...new Set([...currentInventory, ...additions])].slice(
      0,
      20,
    );
  }

  return sanitizeStoryState(templateId, next);
}
