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

const WHITE_BEAR_WALK_SPEED = 0.34;
const WHITE_BEAR_SWIM_SPEED = 0.24;

const createWhiteBearInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * WHITE_BEAR_WALK_SPEED,
    vy: 0,
  };
};

const updateWhiteBearBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  const fishTarget = context.findNearestEntity(entity, TYPES.FISH, 110);
  if (fishTarget) {
    entity.dir = fishTarget.x < entity.x ? -1 : 1;
    if (state.inWater) {
      entity.vx = entity.dir * WHITE_BEAR_SWIM_SPEED;
      entity.vy += Math.sign(fishTarget.y - entity.y) * 0.025;
    } else if (state.onGround && state.blockedX) {
      entity.vy = -state.gravityDirection * 0.75;
    }
  } else if (state.inWater) {
    // 獲物がいない時は水面へ浮上し、水面際で壁(岸)に当たったら跳び上がって自力で池から出る。
    // 「水槽の動物が自分で上がれるようにしてほしい」要望への対応。
    entity.vy -= state.gravityDirection * 0.08;
    if (state.waterRatio < 0.5 && (state.blockedX || Math.random() < 0.03)) {
      entity.vy = -state.gravityDirection * 1.6;
      entity.vx = entity.dir * WHITE_BEAR_SWIM_SPEED * 2;
    }
  } else {
    const coldTarget =
      context.findNearestParticle(state.centerX, state.centerY, TYPES.SNOW, 80) ??
      context.findNearestParticle(state.centerX, state.centerY, TYPES.ICE, 80);
    if (coldTarget) {
      entity.dir = coldTarget.x < state.centerX ? -1 : 1;
    }
  }

  const attackReach = Math.max(7, Math.ceil(Math.min(state.w, state.h) * 0.55));
  context.consumeNearbyEntity(entity, TYPES.FISH, attackReach);

  return { dead: false, skipDefaultWalk: false };
};

export const whiteBearCreature: CreatureDefinition = {
  type: TYPES.POLAR_BEAR,
  name: "白クマ",
  color: "#f8fafc",
  // 低い大型の胴、段差のある頭、太い脚で白クマらしい量感を出す。
  shape: createEntityShape([
    "...######.......",
    ".##########.##..",
    "###############.",
    "################",
    ".#############..",
    "..###..####.....",
    ".#..#..#..#.....",
    "#...#..#...#....",
  ]),
  walkSpeed: WHITE_BEAR_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: false,
  gravityProfile: "heavySwimmer",
  waterDeathChance: 0,
  fireDeathChance: 0.1,
  createInitialVelocity: createWhiteBearInitialVelocity,
  updateBehavior: updateWhiteBearBehavior,
};
