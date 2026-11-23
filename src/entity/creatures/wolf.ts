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

const WOLF_WALK_SPEED = 0.5;

const createWolfInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * WOLF_WALK_SPEED,
    vy: 0,
  };
};

const updateWolfBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  const prey = context.findNearestEntity(entity, TYPES.HUMAN, 95);
  if (prey) {
    entity.dir = prey.x < entity.x ? -1 : 1;
    entity.vx = entity.dir * WOLF_WALK_SPEED;
    if (state.onGround && state.blockedX) {
      entity.vy = -state.gravityDirection * 0.9;
    }
  }

  return { dead: state.inWater && Math.random() < 0.01, skipDefaultWalk: false };
};

export const wolfCreature: CreatureDefinition = {
  type: TYPES.WOLF,
  name: "オオカミ",
  color: "#64748b",
  // 人より低いが横に長い大型犬科として、白クマより一段小さくする。
  shape: createEntityShape([
    "..##.....##.",
    ".###########",
    "############",
    ".#########..",
    "..##..##..#.",
    ".#...#...#..",
  ]),
  walkSpeed: WOLF_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: true,
  gravityProfile: "land",
  waterDeathChance: 0,
  fireDeathChance: 0.1,
  createInitialVelocity: createWolfInitialVelocity,
  updateBehavior: updateWolfBehavior,
};
