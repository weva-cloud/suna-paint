import { createEntityShape } from "../entityShape";
import type { CreatureDefinition } from "../entityTypes";
import { createStillEntityVelocity, keepDefaultEntityBehavior, TYPES } from "../entityTypes";

const CAMEL_WALK_SPEED = 0.18;

export const camelCreature: CreatureDefinition = {
  type: TYPES.CAMEL,
  name: "ラクダ",
  color: "#c19a6b",
  // 人より背が高い大型動物として残しつつ、以前より横幅を抑える。
  shape: createEntityShape([
    ".....##.....##..",
    "....####...####.",
    "..############..",
    ".##############.",
    "################",
    ".#############..",
    "..####..####....",
    "...#.#..#.#.....",
    "..#..#..#..#....",
    "..#..#..#..#....",
  ]),
  walkSpeed: CAMEL_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: true,
  gravityProfile: "land",
  waterDeathChance: 0.01,
  fireDeathChance: 0.1,
  createInitialVelocity: createStillEntityVelocity,
  updateBehavior: keepDefaultEntityBehavior,
};
