import type { Direction, EntityShape } from "./entityTypes";

export const createEntityShape = (rows: string[]): EntityShape => {
  const width = rows[0]?.length ?? 0;
  const map = rows.flatMap((row) => Array.from(row).map((cell) => (cell === "." ? 0 : 1)));

  return {
    w: width,
    h: rows.length,
    map,
  };
};

export const calculateEntityWidth = (shape: EntityShape, scale: number): number => {
  return shape.w * scale;
};

export const calculateEntityHeight = (shape: EntityShape, scale: number): number => {
  return shape.h * scale;
};

export const findShapePixel = (shape: EntityShape, scale: number, sx: number, sy: number, dir: Direction): number => {
  const sourceX = Math.floor(sx / scale);
  const sourceY = Math.floor(sy / scale);
  const mapX = dir === 1 ? sourceX : shape.w - 1 - sourceX;
  return shape.map[sourceY * shape.w + mapX] ?? 0;
};
