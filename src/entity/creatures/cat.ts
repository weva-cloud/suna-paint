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

const CAT_WALK_SPEED = 0.38;

const createCatInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * CAT_WALK_SPEED,
    vy: 0,
  };
};

const updateCatBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  const prey = context.findNearestEntity(entity, TYPES.MOUSE, 90);
  if (prey) {
    entity.dir = prey.x < entity.x ? -1 : 1;
    if (state.onGround && state.blockedX) {
      entity.vy = -state.gravityDirection * 0.8;
    }
  }

  const attackReach = Math.max(4, Math.ceil(Math.min(state.w, state.h) * 0.55));
  context.consumeNearbyEntity(entity, TYPES.MOUSE, attackReach);

  return { dead: false, skipDefaultWalk: false };
};

export const catCreature: CreatureDefinition = {
  type: TYPES.CAT,
  name: "ネコ",
  color: "#d6b38c",
  // 人の半分程度の高さに抑え、横長すぎない右向きのネコにする。
  shape: createEntityShape([
    "#....#..",
    "##..####",
    ".#######",
    "..#..#..",
  ]),
  walkSpeed: CAT_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: true,
  gravityProfile: "land",
  waterDeathChance: 0.006,
  fireDeathChance: 0.1,
  createInitialVelocity: createCatInitialVelocity,
  updateBehavior: updateCatBehavior,
};
