import { createEntityShape } from "../entityShape";
import {
  skipDefaultEntityWalk,
  TYPES,
  type CreatureDefinition,
  type Direction,
  type Entity,
  type EntityBehaviorContext,
  type EntityBehaviorResult,
  type EntityBehaviorState,
} from "../entityTypes";

const BIRD_FLY_SPEED = 0.46;

const createBirdInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * BIRD_FLY_SPEED,
    vy: (Math.random() - 0.5) * 0.35,
  };
};

const updateBirdBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  if (Math.random() < 0.015) entity.dir *= -1;
  entity.vx = entity.dir * BIRD_FLY_SPEED;
  entity.vy += (Math.random() - 0.5) * 0.08 - state.gravityDirection * 0.015;
  entity.vy = Math.max(-0.6, Math.min(0.6, entity.vy));
  if (entity.y < 2) entity.vy = Math.abs(entity.vy);
  if (entity.y + state.h > context.height - 2) entity.vy = -Math.abs(entity.vy);

  return skipDefaultEntityWalk(state.inWater && Math.random() < 0.01);
};

export const birdCreature: CreatureDefinition = {
  type: TYPES.BIRD,
  name: "鳥",
  color: "#f8fafc",
  // 翼幅は残しつつ、人や大型動物より小さく見える大きさに抑える。
  shape: createEntityShape(["..#...#..", ".#######.", "#########", "..#####..", "...###..."]),
  walkSpeed: 0,
  canDefaultWalk: false,
  avoidWater: true,
  gravityProfile: "flyer",
  waterDeathChance: 0,
  fireDeathChance: 0.1,
  createInitialVelocity: createBirdInitialVelocity,
  updateBehavior: updateBirdBehavior,
};
