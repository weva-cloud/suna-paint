export const TYPES = {
  EMPTY: 0,
  SAND: 1,
  WATER: 2,
  STONE: 3,
  WALL: 4,
  STEAM: 5,
  FIRE: 6,
  PLANT: 7,
  HUMAN: 8,
  CAMEL: 9,
  FISH: 10,
  MAGMA: 11,
  FOOD: 12,
  BUG: 13,
  BIRD: 14,
  WOLF: 15,
  GRAVE: 16,
  CLOUD: 17,
  RAIN_CLOUD: 18,
  THUNDER_CLOUD: 19,
  SNOW: 20,
  ICE: 21,
  OBSIDIAN: 22,
  GLASS: 23,
  LIGHTNING: 24,
  MOUSE: 25,
  CAT: 26,
  FROG: 27,
  FIREFLY: 28,
  PIG: 29,
  POLAR_BEAR: 30,
  // 花火の火の粉。落下して積もると色付きの砂になる(保存互換のため末尾追記のみ・番号変更禁止)
  EMBER: 31,
} as const;

export type ParticleType = (typeof TYPES)[keyof typeof TYPES];
export type Direction = -1 | 1;

export type CreatureType =
  | typeof TYPES.HUMAN
  | typeof TYPES.CAMEL
  | typeof TYPES.FISH
  | typeof TYPES.BUG
  | typeof TYPES.BIRD
  | typeof TYPES.WOLF
  | typeof TYPES.MOUSE
  | typeof TYPES.CAT
  | typeof TYPES.FROG
  | typeof TYPES.FIREFLY
  | typeof TYPES.PIG
  | typeof TYPES.POLAR_BEAR;

export const DEFAULT_ENTITY_HUNGER = 3600;

export type EntityVelocity = {
  vx: number;
  vy: number;
};

export type EntityShape = {
  w: number;
  h: number;
  map: number[];
};

export type Entity = {
  id: number;
  type: ParticleType;
  x: number;
  y: number;
  dir: Direction;
  vx: number;
  vy: number;
  color: string;
  scale: number;
  hunger: number;
  // カエルの捕食が見えるように、短時間だけ舌の終点を保持する。
  tongueTicks?: number;
  tongueTargetX?: number;
  tongueTargetY?: number;
};

export type StoredEntity = Omit<Entity, "color" | "scale" | "hunger"> & {
  color?: string;
  scale?: number;
  hunger?: number;
};

export type EntityTarget = {
  x: number;
  y: number;
};

export type CreatureGravityProfile = "land" | "human" | "swimmer" | "flyer" | "amphibian" | "heavySwimmer";

export type EntityBehaviorState = {
  w: number;
  h: number;
  centerX: number;
  centerY: number;
  onGround: boolean;
  inWater: boolean;
  blockedX: boolean;
  panicVx: number;
  touchFire: boolean;
  waterRatio: number;
  gravityDirection: Direction;
};

export type EntityBehaviorContext = {
  width: number;
  height: number;
  findNearestFood: (centerX: number, centerY: number, range: number) => EntityTarget | null;
  findNearestParticle: (centerX: number, centerY: number, targetType: ParticleType, range: number) => EntityTarget | null;
  findNearestEntity: (source: Entity, targetType: ParticleType, range: number) => Entity | null;
  hasNearbyEntity: (source: Entity, targetType: ParticleType, reach: number) => boolean;
  consumeNearbyEntity: (source: Entity, targetType: ParticleType, reach: number) => boolean;
  eatNearbyFood: (entity: Entity, w: number, h: number) => void;
  getCell: (x: number, y: number) => ParticleType | null;
};

export type EntityBehaviorResult = {
  dead: boolean;
  skipDefaultWalk: boolean;
};

export type CreatureDefinition = {
  type: CreatureType;
  name: string;
  color: string;
  shape: EntityShape;
  walkSpeed: number;
  canDefaultWalk: boolean;
  avoidWater: boolean;
  gravityProfile: CreatureGravityProfile;
  waterDeathChance: number;
  fireDeathChance: number;
  createInitialVelocity: (dir: Direction) => EntityVelocity;
  updateBehavior: (entity: Entity, state: EntityBehaviorState, context: EntityBehaviorContext) => EntityBehaviorResult;
};

export const createStillEntityVelocity = (): EntityVelocity => {
  return { vx: 0, vy: 0 };
};

export const keepDefaultEntityBehavior = (): EntityBehaviorResult => {
  return { dead: false, skipDefaultWalk: false };
};

export const skipDefaultEntityWalk = (dead: boolean): EntityBehaviorResult => {
  return { dead, skipDefaultWalk: true };
};
