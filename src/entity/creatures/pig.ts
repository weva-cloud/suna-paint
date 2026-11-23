import { createEntityShape } from "../entityShape";
import {
  TYPES,
  type CreatureDefinition,
  type Direction,
  type Entity,
  type EntityBehaviorContext,
  type EntityBehaviorResult,
  type EntityBehaviorState,
} from "../entityTypes";

const PIG_WALK_SPEED = 0.22;

const createPigInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * PIG_WALK_SPEED,
    vy: 0,
  };
};

const updatePigBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  const foodTarget = context.findNearestFood(state.centerX, state.centerY, 95);
  if (foodTarget) {
    entity.dir = foodTarget.x < state.centerX ? -1 : 1;
  } else if (Math.random() < 0.008) {
    entity.dir *= -1;
  }

  context.eatNearbyFood(entity, state.w, state.h);

  return { dead: false, skipDefaultWalk: false };
};

export const pigCreature: CreatureDefinition = {
  type: TYPES.PIG,
  name: "ブタ",
  color: "#f9a8d4",
  // 丸い胴、耳、短い鼻先を出してブタらしい重心にする。
  shape: createEntityShape([
    "...##....##..",
    "..##########.",
    ".############",
    "#############",
    ".###########.",
    "..##.##..##..",
    ".#..#....#...",
  ]),
  walkSpeed: PIG_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: true,
  gravityProfile: "land",
  waterDeathChance: 0.008,
  fireDeathChance: 0.1,
  createInitialVelocity: createPigInitialVelocity,
  updateBehavior: updatePigBehavior,
};
