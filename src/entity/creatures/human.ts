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

const HUMAN_HUNGRY_THRESHOLD = 1700;
const HUMAN_HUNGER_DECAY = 0.35;
const HUMAN_WALK_SPEED = 0.32;

const createHumanInitialVelocity = (dir: Direction) => {
  return {
    vx: dir * HUMAN_WALK_SPEED,
    vy: 0,
  };
};

const updateHumanBehavior = (
  entity: Entity,
  state: EntityBehaviorState,
  context: EntityBehaviorContext,
): EntityBehaviorResult => {
  entity.hunger = Math.max(0, entity.hunger - HUMAN_HUNGER_DECAY);
  context.eatNearbyFood(entity, state.w, state.h);

  let dead = false;
  const wolfThreat = context.findNearestEntity(entity, TYPES.WOLF, 65);
  const foodTarget = !wolfThreat ? context.findNearestFood(state.centerX, state.centerY, 95) : null;

  if (wolfThreat) {
    entity.dir = wolfThreat.x < entity.x ? 1 : -1;
    if (state.onGround && state.panicVx === 0) {
      entity.vx = entity.dir * (HUMAN_WALK_SPEED + 0.18);
      if (state.blockedX) {
        entity.vy = -state.gravityDirection * 0.85;
      }
    }
  } else if (foodTarget) {
    entity.dir = foodTarget.x < state.centerX ? -1 : 1;
    if (state.onGround && state.panicVx === 0) {
      const foodWalkSpeed = entity.hunger < HUMAN_HUNGRY_THRESHOLD ? HUMAN_WALK_SPEED + 0.12 : HUMAN_WALK_SPEED;
      entity.vx = entity.dir * foodWalkSpeed;
    }
  }

  const headX = Math.floor(entity.x + state.w / 2);
  const headY = state.gravityDirection > 0 ? Math.floor(entity.y) : Math.floor(entity.y + state.h - 1);
  const headSubmerged = context.getCell(headX, headY) === TYPES.WATER;

  if (headSubmerged && Math.random() < 0.005) {
    dead = true;
  }

  if (entity.hunger <= 0 && Math.random() < 0.04) {
    dead = true;
  }

  const wolfAttackReach = Math.max(4, Math.ceil(Math.min(state.w, state.h) * 0.5));
  if (context.hasNearbyEntity(entity, TYPES.WOLF, wolfAttackReach)) {
    dead = true;
  }

  return { dead, skipDefaultWalk: false };
};

export const humanCreature: CreatureDefinition = {
  type: TYPES.HUMAN,
  name: "人",
  color: "#f0c8a0",
  shape: createEntityShape([".###.", ".###.", "..#..", "#####", "#.#.#", "..#..", ".#.#.", ".#.#.", ".#.#."]),
  walkSpeed: HUMAN_WALK_SPEED,
  canDefaultWalk: true,
  avoidWater: true,
  gravityProfile: "human",
  waterDeathChance: 0,
  fireDeathChance: 0.1,
  createInitialVelocity: createHumanInitialVelocity,
  updateBehavior: updateHumanBehavior,
};
