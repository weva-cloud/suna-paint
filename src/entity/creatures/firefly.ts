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

const FIREFLY_FLY_SPEED = 0.24;
// 小型の虫らしく低い場所を漂わせるため、画面上部35%を越えたら下向きへ戻す。
const FIREFLY_FLIGHT_CEILING_RATIO = 0.35;
const FIREFLY_GRAVITY_COMPENSATION = 0.015;
const FIREFLY_DESCENT_ACCELERATION = 0.025;

const createFireflyInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * FIREFLY_FLY_SPEED,
    vy: (Math.random() - 0.5) * 0.2,
  };
};

const updateFireflyBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  const plantTarget = context.findNearestParticle(state.centerX, state.centerY, TYPES.PLANT, 70);
  if (plantTarget) {
    entity.dir = plantTarget.x < state.centerX ? -1 : 1;
    entity.vx += entity.dir * 0.018;
    entity.vy += Math.sign(plantTarget.y - state.centerY) * 0.012 + (Math.random() - 0.5) * 0.05;
  } else {
    if (Math.random() < 0.025) entity.dir *= -1;
    entity.vx += entity.dir * 0.018;
    entity.vy += (Math.random() - 0.5) * 0.06;
  }

  const isAboveFlightCeiling = state.centerY < context.height * FIREFLY_FLIGHT_CEILING_RATIO;
  if (isAboveFlightCeiling) {
    // 上空へ抜け続けないよう、飛行上限より上では自然に低い場所へ戻す。
    entity.vy += FIREFLY_DESCENT_ACCELERATION;
  } else {
    // 通常高度では重力だけを相殺し、虫らしい小さな上下動を維持する。
    entity.vy -= state.gravityDirection * FIREFLY_GRAVITY_COMPENSATION;
  }
  entity.vx = Math.max(-0.34, Math.min(0.34, entity.vx));
  entity.vy = Math.max(-0.34, Math.min(0.34, entity.vy));
  if (entity.y < 2) entity.vy = Math.abs(entity.vy);
  if (entity.y + state.h > context.height - 2) entity.vy = -Math.abs(entity.vy);

  return skipDefaultEntityWalk(state.inWater && Math.random() < 0.05);
};

export const fireflyCreature: CreatureDefinition = {
  type: TYPES.FIREFLY,
  name: "ホタル",
  color: "#fde047",
  // 発光点として読める範囲に抑え、虫より小さく見えるサイズにする。
  shape: createEntityShape([".#.", "###"]),
  walkSpeed: 0,
  canDefaultWalk: false,
  avoidWater: true,
  gravityProfile: "flyer",
  waterDeathChance: 0,
  fireDeathChance: 0.1,
  createInitialVelocity: createFireflyInitialVelocity,
  updateBehavior: updateFireflyBehavior,
};
