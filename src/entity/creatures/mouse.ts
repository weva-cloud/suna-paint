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

const MOUSE_WALK_SPEED = 0.28;

const createMouseInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * MOUSE_WALK_SPEED,
    vy: 0,
  };
};

const updateMouseBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  let dead = false;
  const catThreat = context.findNearestEntity(entity, TYPES.CAT, 55);
  const wolfThreat = context.findNearestEntity(entity, TYPES.WOLF, 55);
  const threat = catThreat ?? wolfThreat;
  const foodTarget = !threat ? context.findNearestFood(state.centerX, state.centerY, 75) : null;

  if (threat) {
    entity.dir = threat.x < entity.x ? 1 : -1;
    if (state.onGround && state.blockedX) {
      entity.vy = -state.gravityDirection * 0.65;
    }
  } else if (foodTarget) {
    entity.dir = foodTarget.x < state.centerX ? -1 : 1;
  }

  context.eatNearbyFood(entity, state.w, state.h);

  const attackReach = Math.max(3, Math.ceil(Math.min(state.w, state.h) * 0.45));
  if (context.hasNearbyEntity(entity, TYPES.CAT, attackReach) || context.hasNearbyEntity(entity, TYPES.WOLF, attackReach)) {
    dead = true;
  }

  return { dead, skipDefaultWalk: false };
};

export const mouseCreature: CreatureDefinition = {
  type: TYPES.MOUSE,
  name: "ネズミ",
  color: "#8b735f",
  // ネコよりさらに小さく、尻尾と鼻先だけが分かるサイズにする。
  shape: createEntityShape(["#...#.", ".#####", "..#.#."]),
  walkSpeed: MOUSE_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: true,
  gravityProfile: "land",
  waterDeathChance: 0.015,
  fireDeathChance: 0.1,
  createInitialVelocity: createMouseInitialVelocity,
  updateBehavior: updateMouseBehavior,
};
