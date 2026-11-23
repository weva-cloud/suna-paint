import { birdCreature } from "./creatures/bird";
import { bugCreature } from "./creatures/bug";
import { camelCreature } from "./creatures/camel";
import { catCreature } from "./creatures/cat";
import { fireflyCreature } from "./creatures/firefly";
import { fishCreature } from "./creatures/fish";
import { frogCreature } from "./creatures/frog";
import { humanCreature } from "./creatures/human";
import { mouseCreature } from "./creatures/mouse";
import { pigCreature } from "./creatures/pig";
import { wolfCreature } from "./creatures/wolf";
import { whiteBearCreature } from "./creatures/whiteBear";
import type { CreatureDefinition, CreatureType, Direction, EntityShape, EntityVelocity, ParticleType } from "./entityTypes";
import { TYPES } from "./entityTypes";
import { GRAVE_SHAPE } from "./specialShapes";

export const CREATURE_DEFINITIONS: CreatureDefinition[] = [
  humanCreature,
  camelCreature,
  fishCreature,
  bugCreature,
  birdCreature,
  wolfCreature,
  mouseCreature,
  catCreature,
  frogCreature,
  fireflyCreature,
  pigCreature,
  whiteBearCreature,
];

export const CREATURE_TYPES: CreatureType[] = CREATURE_DEFINITIONS.map((definition) => definition.type);

export const CREATURE_COLOR_BY_TYPE: Record<CreatureType, string> = {
  [TYPES.HUMAN]: humanCreature.color,
  [TYPES.CAMEL]: camelCreature.color,
  [TYPES.FISH]: fishCreature.color,
  [TYPES.BUG]: bugCreature.color,
  [TYPES.BIRD]: birdCreature.color,
  [TYPES.WOLF]: wolfCreature.color,
  [TYPES.MOUSE]: mouseCreature.color,
  [TYPES.CAT]: catCreature.color,
  [TYPES.FROG]: frogCreature.color,
  [TYPES.FIREFLY]: fireflyCreature.color,
  [TYPES.PIG]: pigCreature.color,
  [TYPES.POLAR_BEAR]: whiteBearCreature.color,
};

export const CREATURE_NAME_BY_TYPE: Record<CreatureType, string> = {
  [TYPES.HUMAN]: humanCreature.name,
  [TYPES.CAMEL]: camelCreature.name,
  [TYPES.FISH]: fishCreature.name,
  [TYPES.BUG]: bugCreature.name,
  [TYPES.BIRD]: birdCreature.name,
  [TYPES.WOLF]: wolfCreature.name,
  [TYPES.MOUSE]: mouseCreature.name,
  [TYPES.CAT]: catCreature.name,
  [TYPES.FROG]: frogCreature.name,
  [TYPES.FIREFLY]: fireflyCreature.name,
  [TYPES.PIG]: pigCreature.name,
  [TYPES.POLAR_BEAR]: whiteBearCreature.name,
};

export const isCreatureType = (type: ParticleType): type is CreatureType => {
  return CREATURE_TYPES.some((creatureType) => creatureType === type);
};

export const getCreatureDefinition = (type: ParticleType): CreatureDefinition | null => {
  return CREATURE_DEFINITIONS.find((definition) => definition.type === type) ?? null;
};

export const findEntityShape = (type: ParticleType): EntityShape | null => {
  if (type === TYPES.GRAVE) return GRAVE_SHAPE;
  return getCreatureDefinition(type)?.shape ?? null;
};

export const calculateInitialEntityVelocity = (type: ParticleType, dir: Direction): EntityVelocity => {
  return getCreatureDefinition(type)?.createInitialVelocity(dir) ?? { vx: 0, vy: 0 };
};
