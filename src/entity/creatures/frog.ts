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

const FROG_HOP_SPEED = 0.48;
const FROG_PREY_RANGE = 80;
// 虫と物理的に重ならなくても、舌で捕まえる動きとして成立させる。
const FROG_TONGUE_REACH = 9;
const FROG_PREY_LUNGE_RANGE = 24;
const FROG_TONGUE_TICKS = 5;

const createFrogInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * FROG_HOP_SPEED,
    vy: 0,
  };
};

const calculateFrogPreyDistance = (state: EntityBehaviorState, prey: Entity): number => {
  return Math.hypot(prey.x - state.centerX, prey.y - state.centerY);
};

const findNearestFrogPrey = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): Entity | null => {
  const bugPrey = context.findNearestEntity(entity, TYPES.BUG, FROG_PREY_RANGE);
  const fireflyPrey = context.findNearestEntity(entity, TYPES.FIREFLY, FROG_PREY_RANGE);

  if (!bugPrey) return fireflyPrey;
  if (!fireflyPrey) return bugPrey;

  return calculateFrogPreyDistance(state, bugPrey) <= calculateFrogPreyDistance(state, fireflyPrey) ? bugPrey : fireflyPrey;
};

const updateFrogTongue = (entity: Entity, prey: Entity) => {
  // 食べた瞬間が分かるように、捕食先へ伸びた舌を数フレームだけ表示する。
  entity.tongueTicks = FROG_TONGUE_TICKS;
  entity.tongueTargetX = prey.x;
  entity.tongueTargetY = prey.y;
};

const consumeFrogPrey = (entity: Entity, prey: Entity | null, context: EntityBehaviorContext, attackReach: number): boolean => {
  if (prey && context.consumeNearbyEntity(entity, prey.type, attackReach)) {
    return true;
  }

  return context.consumeNearbyEntity(entity, TYPES.BUG, attackReach) || context.consumeNearbyEntity(entity, TYPES.FIREFLY, attackReach);
};

const updateFrogBehavior = (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext): EntityBehaviorResult => {
  entity.tongueTicks = Math.max(0, (entity.tongueTicks ?? 0) - 1);

  const prey = findNearestFrogPrey(entity, state, context);
  if (prey) {
    entity.dir = prey.x < entity.x ? -1 : 1;
  } else if (Math.random() < 0.012) {
    entity.dir *= -1;
  }

  const touchReach = Math.max(4, Math.ceil(Math.min(state.w, state.h) * 0.55));
  const tongueReach = Math.max(FROG_TONGUE_REACH, Math.ceil(Math.max(state.w, state.h) * 0.9));
  const attackReach = prey ? tongueReach : touchReach;
  const atePrey = consumeFrogPrey(entity, prey, context, attackReach);
  const preyDistance = prey ? calculateFrogPreyDistance(state, prey) : Number.POSITIVE_INFINITY;
  if (prey && atePrey) {
    updateFrogTongue(entity, prey);
  }

  if (state.inWater) {
    entity.vx += entity.dir * 0.05;
    // 沈む一方だと池から自力で出られないため、水中では水面へ向かう浮上バイアスをかける
    // (物理側 amphibian プロファイルの沈降加速より強くして、ゆっくり浮かび上がるようにする)。
    entity.vy -= state.gravityDirection * 0.06;
    entity.vy += (Math.random() - 0.5) * 0.14;
    entity.vx = Math.max(-0.75, Math.min(0.75, entity.vx));
    entity.vy = Math.max(-0.65, Math.min(0.65, entity.vy));
    // 水面近く(体の半分以上が空気中)まで浮いたら岸へ跳び出す。壁に当たった時は必ず跳ぶ。
    // 「水槽の動物が自分で上がれるようにしてほしい」要望への対応。
    if (state.waterRatio < 0.45 && (state.blockedX || Math.random() < 0.02)) {
      entity.vy = -state.gravityDirection * (1.7 + Math.random() * 0.5);
      entity.vx = entity.dir * (FROG_HOP_SPEED + 0.35);
    }
  } else if (state.onGround) {
    const shouldHop = state.blockedX || preyDistance < FROG_PREY_LUNGE_RANGE || Math.random() < (prey ? 0.45 : 0.22);
    if (shouldHop) {
      entity.vy = -state.gravityDirection * (1.8 + Math.random() * 0.75);
      entity.vx = entity.dir * (FROG_HOP_SPEED + Math.random() * 0.55);
    } else {
      entity.vx = entity.dir * FROG_HOP_SPEED * 0.12;
    }
  } else {
    entity.vx *= 0.96;
  }

  return skipDefaultEntityWalk(false);
};

export const frogCreature: CreatureDefinition = {
  type: TYPES.FROG,
  name: "カエル",
  color: "#65a30d",
  // 人より低い体格に戻し、捕食は舌の射程で表現する。
  shape: createEntityShape([".#...#.", "#######", ".#####.", ".#...#."]),
  walkSpeed: FROG_HOP_SPEED,
  canDefaultWalk: false,
  avoidWater: false,
  gravityProfile: "amphibian",
  waterDeathChance: 0,
  fireDeathChance: 0.1,
  createInitialVelocity: createFrogInitialVelocity,
  updateBehavior: updateFrogBehavior,
};
