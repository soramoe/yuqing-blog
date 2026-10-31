export const STORY_POINTS_PER_TURN = 2;
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
}

export interface StoryModelResult {
  narrative: string;
  choices: string[];
  statePatch: StoryStatePatch;
  summary: string;
  ending: boolean;
}

export const STORY_STYLES = [
  "热血成长",
  "轻松幽默",
  "黑暗悬疑",
  "史诗严肃",
] as const;

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
) {
  const next = structuredClone(currentState);

  if (templateId === "cultivation") {
    for (const key of ["cultivation", "spiritStones", "reputation"]) {
      const value = Number(patch[key]);
      if (Number.isFinite(value) && typeof next[key] === "number") {
        next[key] = Number(next[key]) + clamp(value, -10_000, 10_000);
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
        next[key] = Number(next[key]) + clamp(value, -10_000, 10_000);
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
    next.inventory = [...currentInventory, ...additions].slice(0, 20);
  }

  return sanitizeStoryState(templateId, next);
}
