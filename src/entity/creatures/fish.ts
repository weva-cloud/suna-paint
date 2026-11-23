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

const FISH_MIN_SWIM_SPEED = 0.35;
const FISH_MAX_SWIM_SPEED = 1.15;

const createFishInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * (FISH_MIN_SWIM_SPEED + Math.random() * 0.35),
    vy: (Math.random() - 0.5) * 0.5,
  };
};

const updateFishBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  let dead = false;

  if (state.inWater) {
    const lookAheadX = Math.floor(entity.x + entity.vx * 10);
    const lookAheadY = Math.floor(entity.y + entity.vy * 10);
    const target = context.getCell(lookAheadX, lookAheadY);
    if (target === TYPES.EMPTY || target === TYPES.FIRE || target === TYPES.MAGMA) {
      entity.vx *= -1;
      entity.vy *= -1;
    }

    const swimSpeed = Math.hypot(entity.vx, entity.vy);
    if (swimSpeed < FISH_MIN_SWIM_SPEED) {
      entity.dir = Math.random() > 0.5 ? 1 : -1;
      entity.vx = entity.dir * (FISH_MIN_SWIM_SPEED + Math.random() * 0.35);
      entity.vy = (Math.random() - 0.5) * 0.55;
    }

    if (Math.random() < 0.18) entity.vx += entity.dir * 0.08;
    if (Math.random() < 0.18) entity.vy += (Math.random() - 0.5) * 0.22;
    if (Math.random() < 0.02) entity.dir *= -1;
    if (entity.vx > 0.05) entity.dir = 1;
    if (entity.vx < -0.05) entity.dir = -1;
    entity.vx = Math.max(-FISH_MAX_SWIM_SPEED, Math.min(FISH_MAX_SWIM_SPEED, entity.vx));
    entity.vy = Math.max(-FISH_MAX_SWIM_SPEED, Math.min(FISH_MAX_SWIM_SPEED, entity.vy));
  } else if (state.onGround && Math.random() < 0.05) {
    entity.vy = -state.gravityDirection;
    entity.vx = (Math.random() - 0.5) * 1.5;
  }

  if (state.waterRatio < 0.5 && Math.random() < 0.05) {
    dead = true;
  }

  return skipDefaultEntityWalk(dead);
};

export const fishCreature: CreatureDefinition = {
  type: TYPES.FISH,
  name: "魚",
  color: "#92dff3",
  // 水中で群れた時に大きくなりすぎない横長のサイズにする。
  shape: createEntityShape(["...##....", ".######..", "#########", "..####..."]),
  walkSpeed: 0,
  canDefaultWalk: false,
  avoidWater: false,
  gravityProfile: "swimmer",
  waterDeathChance: 0,
  fireDeathChance: 0.1,
  createInitialVelocity: createFishInitialVelocity,
  updateBehavior: updateFishBehavior,
};
