import { createEntityShape } from "../entityShape";
import type { CreatureDefinition } from "../entityTypes";
import { keepDefaultEntityBehavior, TYPES } from "../entityTypes";

const BUG_WALK_SPEED = 0.24;

const createBugInitialVelocity = (dir: -1 | 1) => {
  return {
    vx: dir * BUG_WALK_SPEED,
    vy: 0,
  };
};

export const bugCreature: CreatureDefinition = {
  type: TYPES.BUG,
  name: "虫",
  color: "#4b5563",
  // 人やカエルと並んだ時に虫として読める小さな体格にする。
  shape: createEntityShape(["#.#.#", "#####", ".###."]),
  walkSpeed: BUG_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: true,
  gravityProfile: "land",
  waterDeathChance: 0.01,
  fireDeathChance: 0.1,
  createInitialVelocity: createBugInitialVelocity,
  updateBehavior: keepDefaultEntityBehavior,
};
