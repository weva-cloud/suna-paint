import { readLocalStorageItem, removeLocalStorageItem } from "./lib/safeLocalStorage";
import { useEffect, useRef, useState, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { deflate, inflate } from "pako";
import { IconBrandX, IconBucket, IconDownload, IconLink, IconPhoto, IconX } from "@tabler/icons-react";
// スタイルは CSS Modules から読み込む(vite 標準機能。`*.module.css` はクラス名が自動でハッシュ化される)。
import styles from "./suna-paint.module.css";
import {
  CREATURE_COLOR_BY_TYPE,
  CREATURE_NAME_BY_TYPE,
  CREATURE_TYPES,
  calculateInitialEntityVelocity,
  findEntityShape,
  getCreatureDefinition,
} from "./entity/entityRegistry";
import { calculateEntityHeight, calculateEntityWidth, findShapePixel } from "./entity/entityShape";
import {
  DEFAULT_ENTITY_HUNGER,
  TYPES,
  type Entity,
  type EntityBehaviorContext,
  type EntityBehaviorState,
  type EntityShape,
  type ParticleType,
  type StoredEntity,
} from "./entity/entityTypes";

const CELL_SIZE = 2;
const FPS = 60;
const HEADER_HEIGHT = 44;
// 狭い画面ではツールバーを44pxの2段に積む。suna-paint.module.css の
// canvasLayer の @media 上書きと一致させること。
const STACKED_HEADER_HEIGHT = 88;
const STACKED_TOOLBAR_QUERY = "(max-width: 1000px)";
const MOBILE_TOOLBAR_QUERY = "(max-width: 720px)";
const getHeaderHeight = () =>
  typeof window !== "undefined" && window.matchMedia(STACKED_TOOLBAR_QUERY).matches ? STACKED_HEADER_HEIGHT : HEADER_HEIGHT;
const getViewportHeight = (): number => {
  if (typeof window === "undefined") return 0;
  return Math.floor(window.visualViewport?.height ?? window.innerHeight);
};
const calculateCanvasClientHeight = (): number => Math.max(1, getViewportHeight() - getHeaderHeight());
const STORAGE_KEY = "suna-paint-storage-v1";
const SHARE_QUERY_PARAM = "state";
const SHARE_STATE_VERSION = 1;
const MAX_SHARE_STATE_CELLS = 1_000_000;
const STEPS_PER_FRAME = 3;
// 高速側は物理更新回数に比例して負荷が増えるため2倍までに制限し、描画1回あたりの更新上限も揃える。
const DEFAULT_TIME_SCALE = 1;
const MIN_TIME_SCALE = 0.25;
const MAX_TIME_SCALE = 2;
const TIME_SCALE_STEP = 0.25;
const MAX_SIMULATION_UPDATES_PER_FRAME = 2;
const MAX_UNDO_HISTORY = 20;
const WATER_FALL_STEPS = 2;
const WATER_DIAGONAL_FLOW_DISTANCE = 2;
const WATER_HORIZONTAL_FLOW_DISTANCE = 5;
const WATER_HORIZONTAL_FLOW_CHANCE = 0.78;
const DEFAULT_GRAVITY = 1;
const MIN_GRAVITY = -1.5;
const MAX_GRAVITY = 2.5;
const GRAVITY_EPSILON = 0.03;
const DEFAULT_BRUSH_SIZE = 4;
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 20;
const ENTITY_GRAVITY_ACCELERATION = 0.06 * STEPS_PER_FRAME;
const ENTITY_MAX_GRAVITY_SPEED = 4.5;
const MAGMA_HORIZONTAL_FLOW_CHANCE = 0.24;

// --- 天気・温度シミュレーションのチューニング定数 ---
// 温度は内部では 0-255 の Uint8、UI では摂氏 -100〜300度として扱う。
const MIN_ENVIRONMENT_TEMPERATURE_CELSIUS = -100;
const MAX_ENVIRONMENT_TEMPERATURE_CELSIUS = 300;
const DEFAULT_ENVIRONMENT_TEMPERATURE_CELSIUS = 20;
const SKY_COOLING_CELSIUS = 12;
const TEMPERATURE_INTERNAL_MAX = 255;
const calculateTemperatureValueFromCelsius = (celsius: number): number => {
  const clamped = Math.max(MIN_ENVIRONMENT_TEMPERATURE_CELSIUS, Math.min(MAX_ENVIRONMENT_TEMPERATURE_CELSIUS, celsius));
  const normalized =
    (clamped - MIN_ENVIRONMENT_TEMPERATURE_CELSIUS) /
    (MAX_ENVIRONMENT_TEMPERATURE_CELSIUS - MIN_ENVIRONMENT_TEMPERATURE_CELSIUS);
  return Math.round(normalized * TEMPERATURE_INTERNAL_MAX);
};
const clampEnvironmentTemperatureCelsius = (celsius: unknown): number => {
  if (typeof celsius !== "number" || !Number.isFinite(celsius)) return DEFAULT_ENVIRONMENT_TEMPERATURE_CELSIUS;
  return Math.max(MIN_ENVIRONMENT_TEMPERATURE_CELSIUS, Math.min(MAX_ENVIRONMENT_TEMPERATURE_CELSIUS, Math.round(celsius)));
};
const AMBIENT_TEMP = calculateTemperatureValueFromCelsius(DEFAULT_ENVIRONMENT_TEMPERATURE_CELSIUS);
const AMBIENT_RELAX = 10; // 空セルが平常温度へ近づく速さ/フレーム
// 雲(ユーザーが設置して使う。蒸気から自動生成はしない)
const CLOUD_REEVAPORATE_TEMP = calculateTemperatureValueFromCelsius(80); // 雲がこの温度を超えて熱せられると蒸気へ戻る
const CLOUD_TICK_CHANCE = 0.15; // 雲の処理を間引く(コスト削減)
const CLOUD_LONELY_FADE_CHANCE = 0.05; // 完全に孤立した雲セルだけ消える
const RAIN_EMIT_CHANCE = 0.015; // 雨雲が水滴/雪を落とす確率/step
const SNOWFALL_TEMP = calculateTemperatureValueFromCelsius(0); // 雨雲の自温がこれ未満なら雪を降らせる
// 落雷
const THUNDER_STRIKE_CHANCE = 0.0008; // 雷雲が落雷する確率/step
const LIGHTNING_DECAY_CHANCE = 0.08; // 落雷セルが消える確率/step
// 凍結・融解(ヒステリシス間隔でちらつき防止)
const FREEZE_TEMP = calculateTemperatureValueFromCelsius(0); // 水がこの温度未満かつ氷/雪に隣接で凍結
const FREEZE_CHANCE = 0.003;
const ICE_MELT_TEMP = calculateTemperatureValueFromCelsius(3);
const SNOW_MELT_TEMP = calculateTemperatureValueFromCelsius(1);
const ICE_MELT_CHANCE = 0.002;
const SNOW_MELT_CHANCE = 0.012;
const ICE_MAX_MELT_CHANCE = 0.03;
const SNOW_MAX_MELT_CHANCE = 0.12;
const ICE_THAW_WARM_BASE_CHANCE = 0.06;
const ICE_THAW_WARM_CHANCE_SCALE = 0.35;
const ICE_THAW_WARM_RATE_SCALE = 2;
const SNOW_THAW_WARM_BASE_CHANCE = 0.08;
const SNOW_THAW_WARM_CHANCE_SCALE = 0.75;
const SNOW_THAW_WARM_RATE_SCALE = 6;
const WATER_BOIL_TEMP = calculateTemperatureValueFromCelsius(100);
const SPONTANEOUS_FREEZE_TEMP = calculateTemperatureValueFromCelsius(-20);
const SNOW_FALL_CHANCE = 0.25; // 雪がゆっくり落ちる
const SNOW_DRIFT_CHANCE = 0.2; // 落下時に横へドリフトする確率
const SNOW_SELF_COOL = 6; // 雪自身の冷却/フレーム
const SNOW_NEIGHBOR_CHILL = 3; // 雪が4近傍を冷やす量
const ICE_NEIGHBOR_CHILL = 1; // 氷が4近傍を冷やす量
// マグマの科学的な冷却
const MAGMA_SOLIDIFY_TEMP = 170; // この温度未満で固化(石 or 黒曜石)
// 空冷は確率的にして溶岩らしく長く溶けた状態を保つ(小さいほど長持ち)。
// 例: 0.05 なら空気接触面が固化点へ達するまで ≈ (255-170)/0.05 / 60 ≈ 28秒。
const MAGMA_AIR_COOL_CHANCE = 0.05;
// 「一番寒くしても石にならない」対策: 環境温度が平常より低いほど空冷確率を引き上げる。
// 最低温度(-100度)で確率が (1 + この係数) 倍になり、空冷固化が約28秒→約5秒に縮む。
const MAGMA_COLD_AIR_COOL_BOOST = 5;
const MAGMA_WATER_COOL = 14; // 水・雪・氷に接する面の急冷量/フレーム(黒曜石化は速いまま)
const MAGMA_SAND_TO_GLASS_CHANCE = 0.01; // マグマが接した砂を溶かしてガラスにする確率/接触
const HOT_STONE_FALL_TEMP = calculateTemperatureValueFromCelsius(60); // 熱い石が崩れ落ちる閾値
const IGNITE_TEMP = calculateTemperatureValueFromCelsius(200); // 植物・食べ物が発火する温度
const FIRE_SPREAD_TO_PLANT_CHANCE = 0.45; // 火が隣の植物へ燃え移る確率/フレーム(大きいほど延焼が速い)
// 風ペン(軽い物・中量の物・生き物を飛ばす。重い固体や壁は動かさない)
const WIND_LIGHT_PUSH = 6; // 軽い粒子(蒸気/雲/雪/火/雷)を押す最大セル数
const WIND_MEDIUM_PUSH = 3; // 中量(水/砂/食べ物/植物)を押す最大セル数
const WIND_LIGHT_CHANCE = 1; // 軽い粒子はほぼ確実に流す
const WIND_MEDIUM_CHANCE = 0.85;
const WIND_ENTITY_PUSH = 1.6; // 生き物を押す距離(セル)× ストローク強さ
const WIND_ENTITY_VELOCITY = 1.2; // 生き物に与える速度
const WIND_MAX_DELTA = 6; // 1フレームの風ベクトル上限(速いストロークほど強い)
const WIND_RADIUS_SCALE = 3; // 風の影響半径 = brushSize × これ

const LEGACY_FOOD_COLOR = "#f97316";
// 生き物の死骸に使う骨色。「死骸と砂を区別してほしい」要望に応えて、
// 挙動は砂のまま色だけ通常の砂(#c2b280)と見分けが付く明るい骨色にする。
const CORPSE_SAND_COLOR = "#e6dfcd";

const pickWaterFlowDistance = (maxDistance: number): number => {
  const roll = Math.random();
  if (roll < 0.72) return 1;
  if (roll < 0.92) return Math.min(2, maxDistance);
  if (roll < 0.99) return Math.min(3, maxDistance);
  return maxDistance;
};

// 風はグリッドに書き込まない「ペン専用」ツール。selectedType のセンチネル値。
const WIND_TOOL = 255 as const;
// 花火もペン専用ツール。タップ位置を「開花させたい高さ」として下から打ち上げる(WIND_TOOLと同じセンチネル方式)
const FIREWORK_TOOL = 254 as const;
type BrushSelection = ParticleType | typeof WIND_TOOL | typeof FIREWORK_TOOL;
const isElementBrush = (sel: BrushSelection): sel is ParticleType => sel !== WIND_TOOL && sel !== FIREWORK_TOOL;
const WIND_TOOL_NAME = "風";
const WIND_TOOL_SWATCH = "#bae6fd";
const FIREWORK_TOOL_NAME = "花火";
const FIREWORK_TOOL_SWATCH = "#ff8fa3";

// ===== 花火の定数 =====
// 打ち上げ弾の上昇速度(セル/フレーム)。速すぎると軌跡が飛び飛びになる
const FIREWORK_RISE_SPEED = 2.4;
// 上昇中に金色の尾(火の粉)を残す確率/フレーム
const FIREWORK_TRAIL_CHANCE = 0.45;
// 開花の放射ライン数と、最終的な広がり半径の目安(セル)
const FIREWORK_MIN_RAYS = 26;
const FIREWORK_MAX_RAYS = 36;
const FIREWORK_MIN_RADIUS = 22;
const FIREWORK_MAX_RADIUS = 38;
// ときどき一回り大きな玉を混ぜ、連続打ち上げでも大きさに抑揚を付ける。
const FIREWORK_LARGE_BURST_CHANCE = 0.2;
const FIREWORK_LARGE_MIN_RADIUS = 42;
const FIREWORK_LARGE_MAX_RADIUS = 52;
const FIREWORK_LARGE_RAY_BONUS = 6;
// 1本の放射線に内・外の火花を重ね、少ない描画数で中心から外周まで奥行きをつなぐ。
const FIREWORK_SPARKS_PER_RAY = 2;
// 放射線とは別に低速の火花を中心へ残し、開花後の輪が空洞に見えないようにする。
const FIREWORK_CORE_SPARK_RATIO = 0.65;
// 指定した広がり半径を、空気抵抗込みの初速へ換算する。
const FIREWORK_SPARK_SPEED_PER_RADIUS = 0.032;
// 空気抵抗と弱い重力で、勢いよく開いた後にゆっくり垂れる軌道へ移行させる。
const FIREWORK_SPARK_DRAG = 0.975;
const FIREWORK_SPARK_GRAVITY = 0.006;
// 約2.5〜3.7秒かけて残光を消し、一部だけ色砂になる火の粉として残す。
const FIREWORK_SPARK_MIN_LIFETIME = 150;
const FIREWORK_SPARK_MAX_LIFETIME = 220;
const FIREWORK_SPARK_SETTLE_CHANCE = 0.16;
const FIREWORK_SPARK_TRAIL_FRAMES = 7;
// 光跡が画面端へ触れた瞬間に消えないよう、少し外側まで寿命管理を続ける。
const FIREWORK_SPARK_BOUNDARY_MARGIN = 4;
// スターマイン中も描画負荷が増え続けないよう、同時表示数に上限を設ける。
const FIREWORK_MAX_ACTIVE_SPARKS = 360;
// 連打防止の発射間隔(ms)。雷ペン(150ms)より少し長め
const FIREWORK_LAUNCH_INTERVAL_MS = 300;
// 火の粉が落下中に燃え尽きて消える確率/step(全部積もると画面が埋まるため少しだけ間引く)
const EMBER_FADE_CHANCE = 0.0018;
// 火の粉の落下確率/step。開花後の余韻が残るよう、雪よりもゆっくり落とす。
const EMBER_FALL_CHANCE = 0.12;
const EMBER_DRIFT_CHANCE = 0.34;
// 花火の色パレット(和火・洋火の定番色)。弾ごとにランダムで1色選ぶ
const FIREWORK_PALETTE = ["#ff5a5a", "#ffd166", "#66b8ff", "#7be07b", "#c792ea", "#ff9ac2"] as const;
// 尾(トレイル)の色は金色固定
const FIREWORK_TRAIL_COLOR = "#ffd166";

/**
 * @description 打ち上げ中の花火弾。グリッドには書き込まず、描画はオーバーレイ・状態はrefで持つ
 * (保存データに影響を与えないため。リロードで打ち上げ中の弾が消えるのは許容)
 */
type FireworkShell = {
  x: number;
  y: number;
  targetY: number;
  colorUint32: number;
  // 上昇軌道を左右に揺らす位相
  wigglePhase: number;
};

/**
 * @description 開花後に連続座標で広がる火花。グリッド外で寿命と速度を持ち、残光として描画する
 */
type FireworkSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  colorUint32: number;
  twinklePhase: number;
};

const SAVE_SHARE_TEXT = "砂ペイントで作品を作りました！";

const isCloudType = (type: number): boolean => type === TYPES.CLOUD || type === TYPES.RAIN_CLOUD || type === TYPES.THUNDER_CLOUD;

type NonCreatureParticleType = Exclude<ParticleType, (typeof CREATURE_TYPES)[number]>;

const BASE_COLORS: Record<NonCreatureParticleType, string> = {
  [TYPES.EMPTY]: "#000000",
  [TYPES.SAND]: "#c2b280",
  [TYPES.WATER]: "#4faeff",
  [TYPES.STONE]: "#787878",
  [TYPES.WALL]: "#c8c8c8",
  [TYPES.STEAM]: "#dcdce6",
  [TYPES.FIRE]: "#ff5000",
  [TYPES.PLANT]: "#228b22",
  [TYPES.MAGMA]: "#ff3b12",
  [TYPES.FOOD]: "#f6e27f",
  [TYPES.GRAVE]: "#d1d5db",
  [TYPES.CLOUD]: "#e8edf2",
  [TYPES.RAIN_CLOUD]: "#9aa7b4",
  [TYPES.THUNDER_CLOUD]: "#5b5870",
  [TYPES.SNOW]: "#f4f8ff",
  [TYPES.ICE]: "#a6d8ef",
  [TYPES.OBSIDIAN]: "#2e2440",
  [TYPES.GLASS]: "#cdeedd",
  [TYPES.LIGHTNING]: "#fff7a8",
  // 火の粉の既定色(実際は弾ごとのパレット色を per-cell color で上書きする)
  [TYPES.EMBER]: "#ffd166",
};

const DEFAULT_COLORS: Record<ParticleType, string> = {
  ...BASE_COLORS,
  ...CREATURE_COLOR_BY_TYPE,
};

const BASE_TYPE_NAMES: Record<NonCreatureParticleType, string> = {
  [TYPES.EMPTY]: "消しゴム",
  [TYPES.SAND]: "砂",
  [TYPES.WATER]: "水",
  [TYPES.STONE]: "石",
  [TYPES.WALL]: "壁",
  [TYPES.STEAM]: "蒸気",
  [TYPES.FIRE]: "火",
  [TYPES.PLANT]: "植物",
  [TYPES.MAGMA]: "マグマ",
  [TYPES.FOOD]: "食べ物",
  [TYPES.GRAVE]: "十字架",
  [TYPES.CLOUD]: "雲",
  [TYPES.RAIN_CLOUD]: "雨雲",
  [TYPES.THUNDER_CLOUD]: "雷雲",
  [TYPES.SNOW]: "雪",
  [TYPES.ICE]: "氷",
  [TYPES.OBSIDIAN]: "黒曜石",
  [TYPES.GLASS]: "ガラス",
  [TYPES.LIGHTNING]: "雷",
  [TYPES.EMBER]: "火の粉",
};

const TYPE_NAMES: Record<ParticleType, string> = {
  ...BASE_TYPE_NAMES,
  ...CREATURE_NAME_BY_TYPE,
};

type BrushGroup = { label: string; brushes: BrushSelection[] };
type TemperatureViewMode = "normal" | "temperature";
type ActiveMenu = "brush" | "size" | "gravity" | "time" | "temperature" | "sky" | null;
type SerializedSunaPaintStateKind = "storage" | "share";

type SunaPaintSerializedState = {
  version: number;
  width: number;
  height: number;
  gridRLE: number[];
  particleColorGridRle: number[];
  colors: Record<ParticleType, string>;
  brushSize: number;
  selectedType: BrushSelection;
  entities: Entity[];
  nextEntityId: number;
  bgColor: string;
  gravity: number;
  timeScale: number;
  environmentTemperatureCelsius: number;
  temperatureViewMode: TemperatureViewMode;
  backgroundImageUrl: string | null;
  // 空(時間帯)。見た目だけの設定。
  skyMode: SkyMode;
};

const BRUSH_GROUPS: BrushGroup[] = [
  { label: "道具", brushes: [TYPES.EMPTY] },
  { label: "地形", brushes: [TYPES.SAND, TYPES.STONE, TYPES.WALL] },
  // 水・氷・蒸気は水の三態(氷は天気ではなく水の仲間)
  { label: "水", brushes: [TYPES.WATER, TYPES.ICE, TYPES.STEAM] },
  // 花火はペン専用ツール(タップした高さで開花し、火の粉が色付きの砂として積もる)。
  // オーナー判断で一度非表示にしていたが、再有効化の依頼に合わせてパレットへ戻す。
  // 再び非表示にする場合も、実装本体を消さず brushes 配列から FIREWORK_TOOL だけを外す。
  { label: "熱と光", brushes: [TYPES.FIRE, TYPES.MAGMA, TYPES.LIGHTNING, FIREWORK_TOOL] },
  // 風は天気現象なので天気に置く
  { label: "天気", brushes: [TYPES.CLOUD, TYPES.RAIN_CLOUD, TYPES.THUNDER_CLOUD, TYPES.SNOW, WIND_TOOL] },
  // 黒曜石・ガラスはペンに出さない。マグマ+水 / マグマ+砂 の相互作用でのみ生まれる素材。
  { label: "自然", brushes: [TYPES.PLANT, TYPES.FOOD] },
  { label: "生き物", brushes: CREATURE_TYPES },
];

const getBrushLabel = (sel: BrushSelection): string =>
  sel === WIND_TOOL ? WIND_TOOL_NAME : sel === FIREWORK_TOOL ? FIREWORK_TOOL_NAME : TYPE_NAMES[sel];
const getBrushSwatchColor = (sel: BrushSelection, colors: Record<ParticleType, string>): string =>
  sel === WIND_TOOL ? WIND_TOOL_SWATCH : sel === FIREWORK_TOOL ? FIREWORK_TOOL_SWATCH : colors[sel];
const formatTemperatureLabel = (celsius: number): string => `${clampEnvironmentTemperatureCelsius(celsius)}度`;

const isTemperatureViewMode = (value: unknown): value is TemperatureViewMode => {
  return value === "normal" || value === "temperature";
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isRleNumberList = (value: unknown): value is number[] => {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isSafeInteger(item));
};

const normalizeBrushSize = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BRUSH_SIZE;
  return Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, Math.round(value)));
};

const normalizeGravity = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_GRAVITY;
  return Math.max(MIN_GRAVITY, Math.min(MAX_GRAVITY, value));
};

const normalizeTimeScale = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIME_SCALE;
  const clamped = Math.max(MIN_TIME_SCALE, Math.min(MAX_TIME_SCALE, value));
  return Math.round(clamped / TIME_SCALE_STEP) * TIME_SCALE_STEP;
};

const parseBrushSelection = (value: unknown): BrushSelection | null => {
  if (isParticleType(value)) return value;
  if (value === WIND_TOOL) return WIND_TOOL;
  if (value === FIREWORK_TOOL) return FIREWORK_TOOL;
  return null;
};

const encodeNumberRle = (values: Uint8Array | Uint32Array): number[] => {
  if (values.length === 0) return [];

  const rle: number[] = [];
  let currentVal = values[0];
  let count = 1;

  for (let i = 1; i < values.length; i++) {
    if (values[i] === currentVal && count < 255) {
      count++;
    } else {
      rle.push(currentVal, count);
      currentVal = values[i];
      count = 1;
    }
  }

  rle.push(currentVal, count);
  return rle;
};

const decodeGridRle = (rle: number[], cellCount: number): Uint8Array | null => {
  const grid = new Uint8Array(cellCount);
  let ptr = 0;

  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i];
    const count = rle[i + 1];
    if (!isParticleType(value) || !Number.isSafeInteger(count) || count < 1 || count > 255) return null;

    for (let j = 0; j < count; j++) {
      if (ptr >= cellCount) return null;
      grid[ptr++] = value;
    }
  }

  if (ptr !== cellCount) return null;
  return grid;
};

const decodeParticleColorRle = (rle: number[], cellCount: number): Uint32Array | null => {
  const particleColorGrid = new Uint32Array(cellCount);
  let ptr = 0;

  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i];
    const count = rle[i + 1];
    const isColorValue = Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
    if (!isColorValue || !Number.isSafeInteger(count) || count < 1 || count > 255) return null;

    for (let j = 0; j < count; j++) {
      if (ptr >= cellCount) return null;
      particleColorGrid[ptr++] = value;
    }
  }

  if (ptr !== cellCount) return null;
  return particleColorGrid;
};

// deflate済みのバイト列はそのままクエリに置けないため、URLで壊れない文字だけに寄せる。
const encodeBytesForQuery = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const decodeBytesFromQuery = (value: string): Uint8Array => {
  const querySafeText = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddedText = `${querySafeText}${"=".repeat((4 - (querySafeText.length % 4)) % 4)}`;
  const binary = atob(paddedText);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const encodeSunaPaintShareState = (state: SunaPaintSerializedState): string => {
  // URL長を抑えるため、localStorage と同じRLE形式をさらにdeflateしてクエリへ載せる。
  return encodeBytesForQuery(deflate(JSON.stringify(state)));
};

type SunaPaintSnapshot = {
  grid: Uint8Array;
  particleColorGrid: Uint32Array;
  colorOffset: Int8Array;
  temperature: Uint8Array;
  entities: Entity[];
  nextEntityId: number;
};

const PARTICLE_TYPE_VALUES = Object.values(TYPES);

const isParticleType = (value: unknown): value is ParticleType => {
  return typeof value === "number" && PARTICLE_TYPE_VALUES.some((particleType) => particleType === value);
};

const normalizeStoredColors = (storedColors: unknown): Record<ParticleType, string> => {
  if (!storedColors || typeof storedColors !== "object") return DEFAULT_COLORS;

  const nextColors = { ...DEFAULT_COLORS };
  for (const [key, value] of Object.entries(storedColors)) {
    const particleType = Number(key);
    if (!isParticleType(particleType) || typeof value !== "string") continue;

    nextColors[particleType] = value;
  }

  if (nextColors[TYPES.FOOD].toLowerCase() === LEGACY_FOOD_COLOR) {
    nextColors[TYPES.FOOD] = DEFAULT_COLORS[TYPES.FOOD];
  }

  return nextColors;
};

const isStoredEntity = (value: unknown): value is StoredEntity => {
  if (!value || typeof value !== "object") return false;

  const entity = value as Record<string, unknown>;

  return (
    typeof entity.id === "number" &&
    isParticleType(entity.type) &&
    typeof entity.x === "number" &&
    typeof entity.y === "number" &&
    (entity.dir === -1 || entity.dir === 1) &&
    typeof entity.vx === "number" &&
    typeof entity.vy === "number" &&
    (entity.color === undefined || typeof entity.color === "string") &&
    (entity.scale === undefined || typeof entity.scale === "number") &&
    (entity.hunger === undefined || typeof entity.hunger === "number")
  );
};

const pickStoredEntityColor = (entity: StoredEntity, storedColors: Partial<Record<ParticleType, string>> | null): string => {
  if (entity.color) {
    return entity.color;
  }

  if (storedColors) {
    const storedColor = storedColors[entity.type];
    if (storedColor) {
      return storedColor;
    }
  }

  return DEFAULT_COLORS[entity.type];
};

const calculateStoredEntityScale = (entity: StoredEntity): number => {
  if (!entity.scale || !Number.isFinite(entity.scale)) return 1;
  return Math.max(1, Math.round(entity.scale));
};

const calculateStoredEntityHunger = (entity: StoredEntity): number => {
  if (typeof entity.hunger !== "number" || !Number.isFinite(entity.hunger)) {
    return DEFAULT_ENTITY_HUNGER;
  }

  return Math.max(0, Math.min(DEFAULT_ENTITY_HUNGER, entity.hunger));
};

const createEntityFromStoredEntity = (
  entity: StoredEntity,
  storedColors: Partial<Record<ParticleType, string>> | null,
): Entity => ({
  ...entity,
  color: pickStoredEntityColor(entity, storedColors),
  scale: calculateStoredEntityScale(entity),
  hunger: calculateStoredEntityHunger(entity),
});

const createEntitiesFromUnknown = (
  value: unknown,
  storedColors: Partial<Record<ParticleType, string>> | null,
): Entity[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entity: unknown): Entity[] => {
    if (!isStoredEntity(entity)) return [];
    return [createEntityFromStoredEntity(entity, storedColors)];
  });
};

const calculateNextEntityId = (entities: Entity[], nextEntityId: unknown): number => {
  const storedNextEntityId =
    typeof nextEntityId === "number" && Number.isSafeInteger(nextEntityId) && nextEntityId >= 0 ? nextEntityId : 0;

  return entities.reduce((maxId, entity) => Math.max(maxId, entity.id + 1), storedNextEntityId);
};

const parseSunaPaintSerializedState = (value: unknown): SunaPaintSerializedState | null => {
  if (!isObjectRecord(value)) return null;
  if (value.version !== SHARE_STATE_VERSION) return null;

  const width = typeof value.width === "number" && Number.isSafeInteger(value.width) ? value.width : 0;
  const height = typeof value.height === "number" && Number.isSafeInteger(value.height) ? value.height : 0;
  const cellCount = width * height;
  if (width <= 0 || height <= 0 || cellCount <= 0 || cellCount > MAX_SHARE_STATE_CELLS) return null;
  if (!isRleNumberList(value.gridRLE) || !isRleNumberList(value.particleColorGridRle)) return null;

  const selectedType = parseBrushSelection(value.selectedType);
  if (selectedType === null) return null;

  const colors = normalizeStoredColors(value.colors);
  const temperatureViewMode = isTemperatureViewMode(value.temperatureViewMode) ? value.temperatureViewMode : "normal";
  const backgroundImageUrl = typeof value.backgroundImageUrl === "string" ? value.backgroundImageUrl : null;
  const entities = createEntitiesFromUnknown(value.entities, colors);
  const nextEntityId = calculateNextEntityId(entities, value.nextEntityId);
  const bgColor = typeof value.bgColor === "string" ? value.bgColor : DEFAULT_COLORS[TYPES.EMPTY];

  return {
    version: SHARE_STATE_VERSION,
    width,
    height,
    gridRLE: value.gridRLE,
    particleColorGridRle: value.particleColorGridRle,
    colors,
    brushSize: normalizeBrushSize(value.brushSize),
    selectedType,
    entities,
    nextEntityId,
    bgColor,
    gravity: normalizeGravity(value.gravity),
    // 旧保存データに値がない場合は標準速度へ戻し、version 1 の共有URLとの互換性を維持する。
    timeScale: normalizeTimeScale(value.timeScale),
    environmentTemperatureCelsius: clampEnvironmentTemperatureCelsius(value.environmentTemperatureCelsius),
    temperatureViewMode,
    backgroundImageUrl,
    skyMode: isSkyMode(value.skyMode) ? value.skyMode : "off",
  };
};

const decodeSunaPaintShareState = (raw: string): SunaPaintSerializedState | null => {
  try {
    const json = inflate(decodeBytesFromQuery(raw), { to: "string" });
    const parsed: unknown = JSON.parse(json);
    return parseSunaPaintSerializedState(parsed);
  } catch {
    return null;
  }
};

const readSunaPaintShareStateFromLocation = (): SunaPaintSerializedState | null => {
  const raw = new URLSearchParams(window.location.search).get(SHARE_QUERY_PARAM);
  if (!raw) return null;
  return decodeSunaPaintShareState(raw);
};

const replaceCurrentLocationWithShareUrl = (shareUrl: URL): void => {
  window.history.replaceState(null, "", `${shareUrl.pathname}${shareUrl.search}${shareUrl.hash}`);
};

const calculateEntityScale = (brushSize: number): number => {
  return Math.max(1, Math.round(brushSize / 4));
};

const formatGravityLabel = (gravity: number): string => {
  if (Math.abs(gravity) < GRAVITY_EPSILON) return "無重力";
  if (gravity < 0) return `逆 ${Math.abs(gravity).toFixed(2)}x`;
  if (gravity > 1.05) return `重い ${gravity.toFixed(2)}x`;
  if (gravity < 0.95) return `軽い ${gravity.toFixed(2)}x`;
  return "標準 1.00x";
};

const formatTimeScaleLabel = (timeScale: number): string => {
  if (timeScale === DEFAULT_TIME_SCALE) return "標準 1.00x";
  if (timeScale < DEFAULT_TIME_SCALE) return `ゆっくり ${timeScale.toFixed(2)}x`;
  return `速い ${timeScale.toFixed(2)}x`;
};

const calculateGravityDirection = (gravity: number): -1 | 1 => {
  return gravity < 0 ? -1 : 1;
};

const clampEntityGravityVelocity = (velocity: number, gravity: number): number => {
  const maxSpeed = ENTITY_MAX_GRAVITY_SPEED * Math.max(0.5, Math.abs(gravity));
  return Math.max(-maxSpeed, Math.min(maxSpeed, velocity));
};

// 水中の速度クランプ。沈む向きは従来の上限で抑えつつ、重力と逆向き(水面へ跳び出す向き)だけ
// 脱出ジャンプが通るよう強めの速度を許可する(カエル・白クマが水から自力で上がれるようにするため)。
const clampSwimVelocity = (velocity: number, gravityDirection: -1 | 1, sinkLimit: number, escapeLimit: number): number => {
  const downLimit = gravityDirection > 0 ? sinkLimit : escapeLimit;
  const upLimit = gravityDirection > 0 ? escapeLimit : sinkLimit;
  return Math.max(-upLimit, Math.min(downLimit, velocity));
};

const hasBoundsOverlap = (
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean => {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
};

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
};

// Helper to convert hex to rgb array
const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
};

// Helper to convert hex string to Uint32 (0xAARRGGBB)
const hexToUint32 = (hex: string): number => {
  const rgb = hexToRgb(hex);
  return (0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
};

// Helper to convert Uint32 (0xAARRGGBB) to rgb array
const uint32ToRgb = (uint32: number): [number, number, number] => {
  const r = (uint32 >> 16) & 0xff;
  const g = (uint32 >> 8) & 0xff;
  const b = uint32 & 0xff;
  return [r, g, b];
};

const calculateTemperatureTintStrength = (temperature: number): number => {
  const deadZone = 3;
  if (temperature < AMBIENT_TEMP - deadZone) {
    const coldRange = Math.max(1, AMBIENT_TEMP - deadZone);
    return -Math.min(0.72, ((AMBIENT_TEMP - deadZone - temperature) / coldRange) * 0.72);
  }
  if (temperature > AMBIENT_TEMP + deadZone) {
    const hotRange = Math.max(1, TEMPERATURE_INTERNAL_MAX - AMBIENT_TEMP - deadZone);
    return Math.min(0.78, ((temperature - AMBIENT_TEMP - deadZone) / hotRange) * 0.78);
  }
  return 0;
};

const blendColorChannel = (base: number, tint: number, strength: number): number => {
  return Math.max(0, Math.min(255, Math.round(base * (1 - strength) + tint * strength)));
};

const calculateTemperatureProgress = (temperature: number, threshold: number): number => {
  if (temperature <= threshold) return 0;
  return Math.min(1, (temperature - threshold) / Math.max(1, TEMPERATURE_INTERNAL_MAX - threshold));
};

const calculateThawWarmChance = (ambient: number, meltTemp: number, baseChance: number, chanceScale: number): number => {
  const progress = calculateTemperatureProgress(ambient, meltTemp);
  if (progress <= 0) return 0;
  return Math.min(1, baseChance + progress * chanceScale);
};

const calculateThawWarmRate = (ambient: number, meltTemp: number, rateScale: number): number => {
  const progress = calculateTemperatureProgress(ambient, meltTemp);
  return Math.max(1, Math.round(1 + progress * rateScale));
};

const calculateMeltChance = (temperature: number, meltTemp: number, baseChance: number, maxChance: number): number => {
  const progress = calculateTemperatureProgress(temperature, meltTemp);
  if (progress <= 0) return 0;
  return baseChance + progress * (maxChance - baseChance);
};

const VARIATION = 15;

const randomOffset = (): number => Math.floor(Math.random() * VARIATION * 2) - VARIATION;

// 行ごとの平常温度。上から25%の行で上空温度→地表温度に補間し、高所ほど寒くする。
// これにより上昇した蒸気が空で冷えて雲になる(水循環の駆動)。
const buildAmbientByRow = (height: number, environmentTemperatureCelsius: number): Uint8Array => {
  const rows = new Uint8Array(height);
  const surfaceTemp = calculateTemperatureValueFromCelsius(environmentTemperatureCelsius);
  const skyTemp = calculateTemperatureValueFromCelsius(environmentTemperatureCelsius - SKY_COOLING_CELSIUS);
  const skyRows = Math.max(1, Math.floor(height * 0.25));
  for (let y = 0; y < height; y++) {
    if (y < skyRows) {
      rows[y] = Math.round(skyTemp + ((surfaceTemp - skyTemp) * y) / skyRows);
    } else {
      rows[y] = surfaceTemp;
    }
  }
  return rows;
};

const fillTemperatureGridByAmbient = (temperature: Uint8Array, width: number, ambientByRow: Uint8Array): void => {
  for (let y = 0; y < ambientByRow.length; y++) {
    temperature.fill(ambientByRow[y], y * width, (y + 1) * width);
  }
};

// --- 空(時間帯 + 太陽/月/星)。これは「見た目だけ」の機能で、温度シミュレーションには一切影響しない。
// 「夜は寒い」のような温度結合は、保存済みの作品の水が勝手に凍るなど既存挙動を壊すため、あえて行わない。
// 空セルの背景色として skyPixels をサンプルするだけの、追加的・任意(off可)の描画レイヤーとして実装する。 ---
type SkyMode = "off" | "morning" | "day" | "evening" | "night";

const SKY_MODES: { value: SkyMode; label: string }[] = [
  { value: "off", label: "なし" },
  { value: "morning", label: "朝" },
  { value: "day", label: "昼" },
  { value: "evening", label: "夕" },
  { value: "night", label: "夜" },
];

const isSkyMode = (value: unknown): value is SkyMode => SKY_MODES.some((mode) => mode.value === value);

type SkyBody = { kind: "sun" | "moon"; nx: number; ny: number; radius: number; color: [number, number, number]; glow: [number, number, number] };

// 時間帯ごとの空。gradientTop/Bottom は縦グラデーション、body は天体、hasStars は星の有無。
const SKY_PALETTES: Record<Exclude<SkyMode, "off">, { top: [number, number, number]; bottom: [number, number, number]; body: SkyBody; hasStars: boolean }> = {
  // 朝: 左下から昇る太陽、うっすら暖色の地平線
  morning: {
    top: [74, 111, 165],
    bottom: [255, 214, 168],
    body: { kind: "sun", nx: 0.2, ny: 0.72, radius: 0.06, color: [255, 236, 160], glow: [255, 205, 140] },
    hasStars: false,
  },
  // 昼: 明るい青空、高い太陽
  day: {
    top: [109, 179, 242],
    bottom: [207, 234, 255],
    body: { kind: "sun", nx: 0.76, ny: 0.17, radius: 0.06, color: [255, 246, 200], glow: [255, 236, 170] },
    hasStars: false,
  },
  // 夕: 右下に沈む赤い太陽、紫〜橙の空
  evening: {
    top: [70, 53, 107],
    bottom: [255, 140, 82],
    body: { kind: "sun", nx: 0.8, ny: 0.72, radius: 0.075, color: [255, 158, 77], glow: [255, 110, 70] },
    hasStars: false,
  },
  // 夜: 濃紺の空、右上の月、星
  night: {
    top: [8, 12, 34],
    bottom: [26, 34, 70],
    body: { kind: "moon", nx: 0.78, ny: 0.2, radius: 0.055, color: [238, 241, 248], glow: [120, 130, 170] },
    hasStars: true,
  },
};

const mixSkyChannel = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

// 時間帯に応じた空の背景ピクセル(RGBA)を1枚作る。時間帯や画面サイズが変わった時だけ呼ぶ(毎フレームではない)。
const buildSkyPixels = (width: number, height: number, skyMode: SkyMode): Uint8ClampedArray | null => {
  if (skyMode === "off" || width <= 0 || height <= 0) return null;
  const palette = SKY_PALETTES[skyMode];
  const pixels = new Uint8ClampedArray(width * height * 4);

  // 1) 縦グラデーションで空を塗る
  for (let y = 0; y < height; y++) {
    const t = height > 1 ? y / (height - 1) : 0;
    const r = mixSkyChannel(palette.top[0], palette.bottom[0], t);
    const g = mixSkyChannel(palette.top[1], palette.bottom[1], t);
    const b = mixSkyChannel(palette.top[2], palette.bottom[2], t);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255;
    }
  }

  // 2) 星(夜のみ)。決まった数を散りばめる。sky は再構築時のみ作るのでフレーム間でちらつかない。
  if (palette.hasStars) {
    const starCount = Math.max(12, Math.floor((width * height) / 1400));
    for (let s = 0; s < starCount; s++) {
      const sx = Math.floor(Math.random() * width);
      // 星は空の上側(上から65%まで)に置く
      const sy = Math.floor(Math.random() * height * 0.65);
      const brightness = 200 + Math.floor(Math.random() * 55);
      const p = (sy * width + sx) * 4;
      pixels[p] = brightness;
      pixels[p + 1] = brightness;
      pixels[p + 2] = Math.min(255, brightness + 15);
    }
  }

  // 3) 太陽/月の円盤 + まわりのグロー。円の外接矩形だけ走査して塗る。
  const body = palette.body;
  const cx = body.nx * width;
  const cy = body.ny * height;
  const radius = Math.max(3, body.radius * height);
  const glowRadius = radius * 2.2;
  const minX = Math.max(0, Math.floor(cx - glowRadius));
  const maxX = Math.min(width - 1, Math.ceil(cx + glowRadius));
  const minY = Math.max(0, Math.floor(cy - glowRadius));
  const maxY = Math.min(height - 1, Math.ceil(cy + glowRadius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      const p = (y * width + x) * 4;
      if (dist <= radius) {
        pixels[p] = body.color[0];
        pixels[p + 1] = body.color[1];
        pixels[p + 2] = body.color[2];
      } else if (dist <= glowRadius) {
        // 円盤の外はグロー色へ、既存の空の色へ滑らかに戻す
        const t = (dist - radius) / (glowRadius - radius);
        pixels[p] = mixSkyChannel(body.glow[0], pixels[p], t);
        pixels[p + 1] = mixSkyChannel(body.glow[1], pixels[p + 1], t);
        pixels[p + 2] = mixSkyChannel(body.glow[2], pixels[p + 2], t);
      }
    }
  }

  return pixels;
};

// --- 水の波(見た目のみ)。水面(上が空)のセルだけ、時間で流れる正弦波の明暗をのせて波打って見せる。
// シミュレーション(粒子の動き)には手を入れないため、性能への影響も既存挙動への影響も無い。 ---
const WATER_WAVE_FREQ = 0.35; // 波の細かさ(大きいほど細かい)
const WATER_WAVE_SPEED = 0.09; // 波が横に流れる速さ/フレーム
const WATER_WAVE_AMPLITUDE = 22; // 明暗の振れ幅

// マグマの「熱さ」を 0(固化寸前)〜1(灼熱)で返す。16段階に量子化して描画コストを抑える。
const calculateMagmaHeatFactor = (temp: number): number => {
  const raw = (temp - MAGMA_SOLIDIFY_TEMP) / (255 - MAGMA_SOLIDIFY_TEMP);
  const clamped = Math.max(0, Math.min(1, raw));
  return Math.round(clamped * 16) / 16;
};

// 落雷を1本生成する。始点から重力方向へジグザグに進み、最初の障害物で着弾処理して止まる。
// シミュレーションループと雷ペンの両方から呼ぶ純関数。
const castLightningBolt = (
  grid: Uint8Array,
  pColorGrid: Uint32Array,
  offsets: Int8Array,
  tempGrid: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  gravityDirection: -1 | 1,
  // 「雷の色を変えても色が変わらない」対策: 既定色のハードコードをやめ、
  // 呼び出し側からユーザーが選択中の雷色を受け取る。
  lightningColor: number,
): void => {
  const steamColor = hexToUint32(DEFAULT_COLORS[TYPES.STEAM]);
  const fireColor = hexToUint32(DEFAULT_COLORS[TYPES.FIRE]);
  const waterColor = hexToUint32(DEFAULT_COLORS[TYPES.WATER]);

  let x = startX;
  let y = startY;

  for (let steps = 0; steps < height; steps++) {
    y += gravityDirection;
    const jitter = Math.random();
    if (jitter < 0.25) x -= 1;
    else if (jitter > 0.75) x += 1;
    if (x < 0) x = 0;
    if (x >= width) x = width - 1;
    if (y < 0 || y >= height) return;

    const idx = y * width + x;
    const cell = grid[idx];

    if (cell === TYPES.EMPTY || cell === TYPES.STEAM || isCloudType(cell)) {
      grid[idx] = TYPES.LIGHTNING;
      pColorGrid[idx] = lightningColor;
      offsets[idx] = randomOffset();
      tempGrid[idx] = 255;
      continue;
    }

    if (cell === TYPES.WATER) {
      const wet = [idx, idx - 1, idx + 1];
      let converted = 0;
      for (const w of wet) {
        if (w >= 0 && w < width * height && grid[w] === TYPES.WATER && converted < 3) {
          grid[w] = TYPES.STEAM;
          pColorGrid[w] = steamColor;
          offsets[w] = randomOffset();
          tempGrid[w] = 180;
          converted++;
        }
      }
      return;
    }

    if (cell === TYPES.SAND) {
      tempGrid[idx] = Math.min(255, tempGrid[idx] + 120);
      return;
    }

    if (cell === TYPES.PLANT || cell === TYPES.FOOD) {
      // 着弾点の周囲3×3の植物・食べ物をまとめて発火させ、大きな火種にする(延焼の起点)
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ci = ny * width + nx;
          if (ci === idx || grid[ci] === TYPES.PLANT || grid[ci] === TYPES.FOOD) {
            grid[ci] = TYPES.FIRE;
            pColorGrid[ci] = fireColor;
            offsets[ci] = randomOffset();
            tempGrid[ci] = 255;
          }
        }
      }
      return;
    }

    if (cell === TYPES.SNOW) {
      grid[idx] = TYPES.WATER;
      pColorGrid[idx] = waterColor;
      offsets[idx] = randomOffset();
      tempGrid[idx] = 30;
      return;
    }

    if (cell === TYPES.ICE) {
      tempGrid[idx] = 255;
      return;
    }

    // STONE / WALL / OBSIDIAN / GLASS / MAGMA / FIRE などは加熱だけして止まる
    tempGrid[idx] = Math.min(255, tempGrid[idx] + 120);
    return;
  }
};

export const SunaPaintPage = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const backgroundImageInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState<BrushSelection>(TYPES.SAND);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [bgColor, setBgColor] = useState(DEFAULT_COLORS[TYPES.EMPTY]);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [gravity, setGravity] = useState(DEFAULT_GRAVITY);
  const [timeScale, setTimeScale] = useState(DEFAULT_TIME_SCALE);
  const [environmentTemperatureCelsius, setEnvironmentTemperatureCelsius] = useState(DEFAULT_ENVIRONMENT_TEMPERATURE_CELSIUS);
  const [temperatureViewMode, setTemperatureViewMode] = useState<TemperatureViewMode>("normal");
  const [undoDepth, setUndoDepth] = useState(0);
  // 塗りつぶしが実行できなかったときに一時表示する文言
  const [fillHint, setFillHint] = useState<string | null>(null);
  const fillHintTimerRef = useRef<number | null>(null);
  const [isToolbarScrollHintVisible, setIsToolbarScrollHintVisible] = useState(false);
  const [isDetachedMenu, setIsDetachedMenu] = useState(false);
  const [savePreviewUrl, setSavePreviewUrl] = useState<string | null>(null);
  const [savePreviewFileName, setSavePreviewFileName] = useState("suna-paint.png");
  const [saveShareMessage, setSaveShareMessage] = useState<string | null>(null);
  // 空(時間帯 + 太陽/月/星)。既定は "off"(黒背景=従来通り)なので、選ばない限り見た目は変わらない。
  const [skyMode, setSkyMode] = useState<SkyMode>("off");

  const gridRef = useRef<Uint8Array | null>(null);
  const particleColorGridRef = useRef<Uint32Array | null>(null);
  const colorOffsetRef = useRef<Int8Array | null>(null);
  const temperatureRef = useRef<Uint8Array | null>(null);
  const ambientByRowRef = useRef<Uint8Array | null>(null);
  const backgroundImagePixelsRef = useRef<Uint8ClampedArray | null>(null);

  const entitiesRef = useRef<Entity[]>([]);
  // 打ち上げ中の花火弾。グリッド外の演出オブジェクトなので保存対象にしない
  const fireworksRef = useRef<FireworkShell[]>([]);
  // 開花後の火花も一時演出としてrefで管理し、毎フレームのReact再描画を避ける。
  const fireworkSparksRef = useRef<FireworkSpark[]>([]);
  const nextEntityId = useRef(0);
  const undoHistoryRef = useRef<SunaPaintSnapshot[]>([]);

  const gridWidthRef = useRef(0);
  const gridHeightRef = useRef(0);

  const isDragging = useRef(false);
  const lastSpawnRef = useRef(0);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  // ポインタ位置に表示するカーソル(風の範囲リングや塗りブラシの輪)。draw() から参照する。
  const cursorRef = useRef<{ x: number; y: number; radius: number; isWind: boolean; dx: number; dy: number } | null>(null);

  const saveTimeoutRef = useRef<number | null>(null);
  const viewportResizeFrameRef = useRef<number | null>(null);
  // 空(時間帯)の描画用。skyPixels は空セルの背景としてサンプルする1枚絵。
  // skyModeRef は resize や draw が最新の時間帯を stale クロージャなしで読むためのミラー。
  const skyPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const skyModeRef = useRef<SkyMode>("off");
  // 水の波のアニメーション位相に使う描画フレームカウンタ(draw のたびに増える)。
  const renderFrameRef = useRef(0);

  const updateToolbarScrollHint = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) {
      setIsToolbarScrollHintVisible(false);
      return;
    }

    const maxScrollLeft = toolbar.scrollWidth - toolbar.clientWidth;
    const shouldShow = maxScrollLeft > 1 && toolbar.scrollLeft < maxScrollLeft - 2;
    setIsToolbarScrollHintVisible((prev) => (prev === shouldShow ? prev : shouldShow));
  }, []);

  const updateBackgroundImagePixels = useCallback((imageUrl: string | null) => {
    const width = gridWidthRef.current;
    const height = gridHeightRef.current;

    if (!imageUrl || width <= 0 || height <= 0) {
      backgroundImagePixelsRef.current = null;
      return;
    }

    const image = new Image();
    image.onload = () => {
      const bufferCanvas = document.createElement("canvas");
      bufferCanvas.width = width;
      bufferCanvas.height = height;
      const bufferContext = bufferCanvas.getContext("2d", { alpha: false });
      if (!bufferContext) return;

      bufferContext.drawImage(image, 0, 0, width, height);
      backgroundImagePixelsRef.current = bufferContext.getImageData(0, 0, width, height).data;
    };
    image.onerror = () => {
      backgroundImagePixelsRef.current = null;
    };
    image.src = imageUrl;
  }, []);

  const isSolid = useCallback((px: number, py: number) => {
    if (!gridRef.current) return false;
    const width = gridWidthRef.current;
    const height = gridHeightRef.current;
    if (px < 0 || px >= width || py < 0 || py >= height) return true;
    const type = gridRef.current[py * width + px];
    return (
      type === TYPES.STONE ||
      type === TYPES.WALL ||
      type === TYPES.PLANT ||
      type === TYPES.SAND ||
      type === TYPES.FOOD ||
      type === TYPES.ICE ||
      type === TYPES.OBSIDIAN ||
      type === TYPES.GLASS ||
      type === TYPES.SNOW
    );
  }, []);

  const createSnapshot = useCallback((): SunaPaintSnapshot | null => {
    if (!gridRef.current || !particleColorGridRef.current || !colorOffsetRef.current || !temperatureRef.current) return null;

    return {
      grid: new Uint8Array(gridRef.current),
      particleColorGrid: new Uint32Array(particleColorGridRef.current),
      colorOffset: new Int8Array(colorOffsetRef.current),
      temperature: new Uint8Array(temperatureRef.current),
      entities: entitiesRef.current.map((entity) => ({ ...entity })),
      nextEntityId: nextEntityId.current,
    };
  }, []);

  const clearFireworkEffects = useCallback(() => {
    // Undo・全消去・リサイズ後に古い座標の花火が描画や着色を続けないよう、一時演出をまとめて破棄する。
    fireworksRef.current = [];
    fireworkSparksRef.current = [];
  }, []);

  const pushUndoSnapshot = useCallback(() => {
    const snapshot = createSnapshot();
    if (!snapshot) return;

    const nextHistory = [...undoHistoryRef.current, snapshot].slice(-MAX_UNDO_HISTORY);
    undoHistoryRef.current = nextHistory;
    setUndoDepth(nextHistory.length);
  }, [createSnapshot]);

  const restoreSnapshot = useCallback((snapshot: SunaPaintSnapshot) => {
    gridRef.current = new Uint8Array(snapshot.grid);
    particleColorGridRef.current = new Uint32Array(snapshot.particleColorGrid);
    colorOffsetRef.current = new Int8Array(snapshot.colorOffset);
    temperatureRef.current = new Uint8Array(snapshot.temperature);
    entitiesRef.current = snapshot.entities.map((entity) => ({ ...entity }));
    nextEntityId.current = snapshot.nextEntityId;
    clearFireworkEffects();
  }, [clearFireworkEffects]);

  const hasEntityPixelInCircle = useCallback((entity: Entity, shape: EntityShape, cx: number, cy: number, radius: number) => {
    const width = calculateEntityWidth(shape, entity.scale);
    const height = calculateEntityHeight(shape, entity.scale);
    const startX = Math.floor(entity.x);
    const startY = Math.floor(entity.y);
    const radiusSquared = radius * radius;
    if (cx + radius < startX || cx - radius >= startX + width || cy + radius < startY || cy - radius >= startY + height) {
      return false;
    }

    for (let sy = 0; sy < height; sy++) {
      for (let sx = 0; sx < width; sx++) {
        if (!findShapePixel(shape, entity.scale, sx, sy, entity.dir)) continue;

        const dx = startX + sx - cx;
        const dy = startY + sy - cy;
        if (dx * dx + dy * dy <= radiusSquared) {
          return true;
        }
      }
    }

    return false;
  }, []);

  const eraseEntitiesInCircle = useCallback(
    (cx: number, cy: number, radius: number) => {
      entitiesRef.current = entitiesRef.current.filter((entity) => {
        const shape = findEntityShape(entity.type);
        if (!shape) return true;
        return !hasEntityPixelInCircle(entity, shape, cx, cy, radius);
      });
    },
    [hasEntityPixelInCircle],
  );

  const drawCircle = useCallback(
    (cx: number, cy: number) => {
      if (!gridRef.current || !particleColorGridRef.current || !colorOffsetRef.current) return;
      // 風と花火はグリッドへ直接描かないペン。drawCircle は要素ペンのみが使う。
      if (!isElementBrush(selectedType)) return;
      const grid = gridRef.current;
      const pColorGrid = particleColorGridRef.current;
      const offsets = colorOffsetRef.current;
      const width = gridWidthRef.current;
      const height = gridHeightRef.current;
      const r = brushSize;

      if (selectedType === TYPES.EMPTY) {
        eraseEntitiesInCircle(cx, cy, r);
      }

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            const px = cx + dx;
            const py = cy + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = py * width + px;
              const current = grid[idx];
              if (selectedType === TYPES.EMPTY) {
                grid[idx] = TYPES.EMPTY;
                pColorGrid[idx] = hexToUint32(bgColor);
                // 消去時は平常温度へ戻す
                if (temperatureRef.current) {
                  temperatureRef.current[idx] = ambientByRowRef.current?.[py] ?? AMBIENT_TEMP;
                }
              } else {
                if (
                  current === TYPES.EMPTY ||
                  current === TYPES.WATER ||
                  current === TYPES.STEAM ||
                  isCloudType(current) ||
                  selectedType === TYPES.WALL
                ) {
                  grid[idx] = selectedType;
                  pColorGrid[idx] = hexToUint32(colors[selectedType]);
                  offsets[idx] = randomOffset();
                  // 新規粒子の温度設定。火/マグマ/雷は灼熱、雪/氷は極寒、他は平常温度。
                  if (temperatureRef.current) {
                    if (selectedType === TYPES.FIRE || selectedType === TYPES.MAGMA || selectedType === TYPES.LIGHTNING) {
                      temperatureRef.current[idx] = 255;
                    } else if (selectedType === TYPES.STEAM) {
                      temperatureRef.current[idx] = 130;
                    } else if (selectedType === TYPES.SNOW || selectedType === TYPES.ICE) {
                      temperatureRef.current[idx] = 0;
                    } else {
                      temperatureRef.current[idx] = ambientByRowRef.current?.[py] ?? AMBIENT_TEMP;
                    }
                  }
                } else if (
                  selectedType === TYPES.FIRE ||
                  selectedType === TYPES.MAGMA ||
                  selectedType === TYPES.LIGHTNING
                ) {
                  // 「火がおかしい、燃えない」対策。
                  // ペンは砂や植物などの固体セルを上書きしない規則のため、火を直接塗っても
                  // 何も起きないように見えていた。熱源のペンに限っては、上書きの代わりに
                  // 対象セルを加熱する。可燃物は既存の温度による着火規則で燃え始め、
                  // 不燃物は熱を受けるだけで見た目どおりの挙動になる。
                  if (temperatureRef.current) {
                    temperatureRef.current[idx] = 255;
                  }
                }
              }
            }
          }
        }
      }
    },
    [brushSize, selectedType, colors, bgColor, eraseEntitiesInCircle],
  );

  const drawLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        drawCircle(x0, y0);

        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x0 += sx;
        }
        if (e2 < dx) {
          err += dx;
          y0 += sy;
        }
      }
    },
    [drawCircle],
  );

  // 風ペン: ポインタの移動方向へ、ブラシ半径内の軽い/中量の粒子を押し流す。
  // 押す向きと逆順に走査して、同一の突風で粒子を二重に動かさない。
  const applyWind = useCallback(
    (cx: number, cy: number, dx: number, dy: number) => {
      const grid = gridRef.current;
      const pColorGrid = particleColorGridRef.current;
      const offsets = colorOffsetRef.current;
      const tempGrid = temperatureRef.current;
      if (!grid || !pColorGrid || !offsets || !tempGrid) return;
      const width = gridWidthRef.current;
      const height = gridHeightRef.current;

      const vlen = Math.hypot(dx, dy);
      if (vlen < 0.4) return;
      const cap = Math.min(vlen, WIND_MAX_DELTA);
      const ux = dx / vlen;
      const uy = dy / vlen;

      const r = brushSize * WIND_RADIUS_SCALE;
      const r2 = r * r;

      const swapCells = (fromIdx: number, toIdx: number) => {
        grid[toIdx] = grid[fromIdx];
        pColorGrid[toIdx] = pColorGrid[fromIdx];
        const o = offsets[fromIdx];
        offsets[fromIdx] = offsets[toIdx];
        offsets[toIdx] = o;
        const h = tempGrid[fromIdx];
        tempGrid[fromIdx] = tempGrid[toIdx];
        tempGrid[toIdx] = h;
        grid[fromIdx] = TYPES.EMPTY;
        pColorGrid[fromIdx] = hexToUint32(bgColor);
      };

      // 風下側のセルから処理する(下流を先に処理しておけば二重移動が起きない)
      const colStart = ux >= 0 ? r : -r;
      const colEnd = ux >= 0 ? -r - 1 : r + 1;
      const colStep = ux >= 0 ? -1 : 1;
      const rowStart = uy >= 0 ? r : -r;
      const rowEnd = uy >= 0 ? -r - 1 : r + 1;
      const rowStep = uy >= 0 ? -1 : 1;

      for (let oy = rowStart; oy !== rowEnd; oy += rowStep) {
        for (let ox = colStart; ox !== colEnd; ox += colStep) {
          if (ox * ox + oy * oy > r2) continue;
          const px = cx + ox;
          const py = cy + oy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          const idx = py * width + px;
          const t = grid[idx];
          if (t === TYPES.EMPTY) continue;

          // 軽い物と中量の物だけ飛ばす。重い固体(石/氷/黒曜石/ガラス)や壁は動かさない。
          let maxPush = 0;
          let chance = 0;
          // 火の粉も軽い粒子として風に流される(花火が風で流れる演出になる)
          if (t === TYPES.STEAM || t === TYPES.FIRE || t === TYPES.LIGHTNING || t === TYPES.SNOW || t === TYPES.EMBER || isCloudType(t)) {
            maxPush = WIND_LIGHT_PUSH;
            chance = WIND_LIGHT_CHANCE;
          } else if (t === TYPES.WATER || t === TYPES.SAND || t === TYPES.FOOD || t === TYPES.PLANT) {
            maxPush = WIND_MEDIUM_PUSH;
            chance = WIND_MEDIUM_CHANCE;
          }
          if (maxPush === 0 || Math.random() >= chance) continue;

          const steps = Math.max(1, Math.round((maxPush * cap) / WIND_MAX_DELTA));
          let curIdx = idx;
          for (let s = 1; s <= steps; s++) {
            const nx = Math.round(px + ux * s);
            const ny = Math.round(py + uy * s);
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
            const nIdx = ny * width + nx;
            if (nIdx === curIdx) continue;
            if (grid[nIdx] !== TYPES.EMPTY) break;
            swapCells(curIdx, nIdx);
            curIdx = nIdx;
          }
        }
      }

      // 生き物も吹き飛ばす(位置を動かしつつ速度も与える)
      const strength = cap / WIND_MAX_DELTA;
      for (const en of entitiesRef.current) {
        const shape = findEntityShape(en.type);
        if (!shape) continue;
        const ew = calculateEntityWidth(shape, en.scale);
        const eh = calculateEntityHeight(shape, en.scale);
        const ddx = en.x + ew / 2 - cx;
        const ddy = en.y + eh / 2 - cy;
        if (ddx * ddx + ddy * ddy > r2) continue;
        en.x = Math.max(0, Math.min(width - ew, en.x + ux * WIND_ENTITY_PUSH * strength));
        en.y = Math.max(0, Math.min(height - eh, en.y + uy * WIND_ENTITY_PUSH * strength));
        en.vx += ux * WIND_ENTITY_VELOCITY * strength;
        en.vy += uy * WIND_ENTITY_VELOCITY * strength;
      }
    },
    [brushSize, bgColor],
  );

  const initEmptyGrid = useCallback((width: number, height: number, environmentTemperatureCelsiusValue: number) => {
    gridRef.current = new Uint8Array(width * height);
    particleColorGridRef.current = new Uint32Array(width * height);
    particleColorGridRef.current.fill(hexToUint32(DEFAULT_COLORS[TYPES.EMPTY]));
    colorOffsetRef.current = new Int8Array(width * height);
    const ambientByRow = buildAmbientByRow(height, environmentTemperatureCelsiusValue);
    ambientByRowRef.current = ambientByRow;
    const temperature = new Uint8Array(width * height);
    fillTemperatureGridByAmbient(temperature, width, ambientByRow);
    temperatureRef.current = temperature;
    for (let i = 0; i < colorOffsetRef.current.length; i++) {
      colorOffsetRef.current[i] = randomOffset();
    }
  }, []);

  const createSerializedSunaPaintState = useCallback(
    (kind: SerializedSunaPaintStateKind): SunaPaintSerializedState | null => {
      if (!gridRef.current || !particleColorGridRef.current) return null;

      const width = gridWidthRef.current;
      const height = gridHeightRef.current;
      const selectedTypeForState = kind === "share" || isElementBrush(selectedType) ? selectedType : TYPES.SAND;
      const backgroundImageUrlForState = kind === "storage" ? backgroundImageUrl : null;

      return {
        version: SHARE_STATE_VERSION,
        width,
        height,
        gridRLE: encodeNumberRle(gridRef.current),
        particleColorGridRle: encodeNumberRle(particleColorGridRef.current),
        colors,
        brushSize,
        // storage は旧ビルドへのロールバック安全を優先し、URL共有だけペン専用ツール選択を保持する。
        selectedType: selectedTypeForState,
        entities: entitiesRef.current.map((entity) => ({ ...entity })),
        nextEntityId: nextEntityId.current,
        bgColor,
        gravity,
        timeScale,
        environmentTemperatureCelsius,
        temperatureViewMode,
        // 背景画像はlocalStorageには残すが、共有URLには載せない(URL肥大化を避けるため)。
        backgroundImageUrl: backgroundImageUrlForState,
        skyMode,
      };
    },
    [
      backgroundImageUrl,
      bgColor,
      brushSize,
      colors,
      environmentTemperatureCelsius,
      gravity,
      selectedType,
      skyMode,
      temperatureViewMode,
      timeScale,
    ],
  );

  const restoreSerializedStateToViewport = useCallback(
    (state: SunaPaintSerializedState, width: number, height: number): boolean => {
      const cellCount = state.width * state.height;
      const sourceGrid = decodeGridRle(state.gridRLE, cellCount);
      const sourceParticleColorGrid = decodeParticleColorRle(state.particleColorGridRle, cellCount);
      if (!sourceGrid || !sourceParticleColorGrid) return false;

      const nextGrid = new Uint8Array(width * height);
      const nextParticleColorGrid = new Uint32Array(width * height);
      const nextColorOffset = new Int8Array(width * height);
      const nextTemperature = new Uint8Array(width * height);
      const ambientByRow = buildAmbientByRow(height, state.environmentTemperatureCelsius);
      const emptyColor = hexToUint32(state.bgColor);
      nextParticleColorGrid.fill(emptyColor);
      fillTemperatureGridByAmbient(nextTemperature, width, ambientByRow);

      const copyWidth = Math.min(state.width, width);
      const copyHeight = Math.min(state.height, height);
      // 共有元と閲覧側の画面サイズが違う場合も、作品の中心が残るように中央基準で貼り直す。
      const sourceStartX = Math.max(0, Math.floor((state.width - width) / 2));
      const sourceStartY = Math.max(0, Math.floor((state.height - height) / 2));
      const targetStartX = Math.max(0, Math.floor((width - state.width) / 2));
      const targetStartY = Math.max(0, Math.floor((height - state.height) / 2));
      const entityOffsetX = targetStartX - sourceStartX;
      const entityOffsetY = targetStartY - sourceStartY;

      for (let y = 0; y < copyHeight; y++) {
        const sourceStart = (sourceStartY + y) * state.width + sourceStartX;
        const targetStart = (targetStartY + y) * width + targetStartX;
        nextGrid.set(sourceGrid.subarray(sourceStart, sourceStart + copyWidth), targetStart);
        nextParticleColorGrid.set(sourceParticleColorGrid.subarray(sourceStart, sourceStart + copyWidth), targetStart);
      }

      for (let i = 0; i < nextColorOffset.length; i++) {
        if (nextGrid[i] !== TYPES.EMPTY) {
          nextColorOffset[i] = randomOffset();
        }
      }

      const nextEntities = state.entities.flatMap((entity): Entity[] => {
        const shape = findEntityShape(entity.type);
        if (!shape) return [];

        const entityWidth = calculateEntityWidth(shape, entity.scale);
        const entityHeight = calculateEntityHeight(shape, entity.scale);
        const x = Math.max(0, Math.min(Math.max(0, width - entityWidth), entity.x + entityOffsetX));
        const y = Math.max(0, Math.min(Math.max(0, height - entityHeight), entity.y + entityOffsetY));
        return [{ ...entity, x, y }];
      });

      gridRef.current = nextGrid;
      particleColorGridRef.current = nextParticleColorGrid;
      colorOffsetRef.current = nextColorOffset;
      temperatureRef.current = nextTemperature;
      ambientByRowRef.current = ambientByRow;
      backgroundImagePixelsRef.current = null;
      entitiesRef.current = nextEntities;
      nextEntityId.current = calculateNextEntityId(nextEntities, state.nextEntityId);
      undoHistoryRef.current = [];
      cursorRef.current = null;
      clearFireworkEffects();

      setColors(state.colors);
      setBrushSize(state.brushSize);
      setSelectedType(state.selectedType);
      setBgColor(state.bgColor);
      setGravity(state.gravity);
      setTimeScale(state.timeScale);
      setEnvironmentTemperatureCelsius(state.environmentTemperatureCelsius);
      setTemperatureViewMode(state.temperatureViewMode);
      setBackgroundImageUrl(state.backgroundImageUrl);
      setSkyMode(state.skyMode);
      setUndoDepth(0);
      updateBackgroundImagePixels(state.backgroundImageUrl);
      return true;
    },
    [clearFireworkEffects, updateBackgroundImagePixels],
  );

  // 直近でグリッドを作り直したときの物理ピクセル幅。ズームと実リサイズの区別に使う。
  const lastPhysicalViewportWidthRef = useRef<number | null>(null);

  const resizeCanvasToViewport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ピンチズーム中は visualViewport が縮んで見えるだけで画面自体は変わっていない。
    // ここで追従リサイズするとグリッドが切り詰められて「拡大したら絵が勝手に消える」ため、
    // ズームが解除される(scale=1に戻る)までリサイズを保留する。
    const visualViewportScale = window.visualViewport?.scale ?? 1;
    if (visualViewportScale > 1.001) return;

    // ブラウザのズーム(Ctrl + / ⌘ +)は visualViewport.scale を変えないため上のガードを素通りし、
    // innerWidth だけが縮んでグリッドが切り詰められる。これも「拡大したら絵が消える」の経路。
    // ズームでは CSS ピクセル幅が変わっても物理ピクセル幅は変わらない性質を使って見分ける。
    const physicalWidth = Math.round(window.innerWidth * window.devicePixelRatio);
    const lastPhysicalWidth = lastPhysicalViewportWidthRef.current;
    if (lastPhysicalWidth !== null && Math.abs(physicalWidth - lastPhysicalWidth) <= 2) {
      // ウィンドウの実サイズは変わっていない = ズーム操作。描画サイズだけ合わせて中身は保つ。
      const zoomedClientWidth = window.innerWidth;
      const zoomedClientHeight = calculateCanvasClientHeight();
      canvas.style.width = `${zoomedClientWidth}px`;
      canvas.style.height = `${zoomedClientHeight}px`;
      return;
    }
    lastPhysicalViewportWidthRef.current = physicalWidth;

    const clientWidth = window.innerWidth;
    const clientHeight = calculateCanvasClientHeight();
    const nextWidth = Math.max(1, Math.ceil(clientWidth / CELL_SIZE));
    const nextHeight = Math.max(1, Math.ceil(clientHeight / CELL_SIZE));

    canvas.style.width = `${clientWidth}px`;
    canvas.style.height = `${clientHeight}px`;
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;

    const currentWidth = gridWidthRef.current;
    const currentHeight = gridHeightRef.current;
    if (currentWidth === nextWidth && currentHeight === nextHeight) return;

    clearFireworkEffects();

    const oldGrid = gridRef.current;
    const oldPColorGrid = particleColorGridRef.current;
    const oldOffsets = colorOffsetRef.current;
    const oldTemperature = temperatureRef.current;
    const currentCellCount = currentWidth * currentHeight;

    gridWidthRef.current = nextWidth;
    gridHeightRef.current = nextHeight;

    if (
      !oldGrid ||
      !oldPColorGrid ||
      !oldOffsets ||
      !oldTemperature ||
      currentWidth <= 0 ||
      currentHeight <= 0 ||
      oldGrid.length !== currentCellCount ||
      oldPColorGrid.length !== currentCellCount ||
      oldOffsets.length !== currentCellCount ||
      oldTemperature.length !== currentCellCount
    ) {
      initEmptyGrid(nextWidth, nextHeight, environmentTemperatureCelsius);
      updateBackgroundImagePixels(backgroundImageUrl);
      return;
    }

    const nextGrid = new Uint8Array(nextWidth * nextHeight);
    const nextPColorGrid = new Uint32Array(nextWidth * nextHeight);
    const nextOffsets = new Int8Array(nextWidth * nextHeight);
    const nextTemperature = new Uint8Array(nextWidth * nextHeight);
    const nextAmbientByRow = buildAmbientByRow(nextHeight, environmentTemperatureCelsius);
    const emptyColor = hexToUint32(bgColor);
    const copyWidth = Math.min(currentWidth, nextWidth);
    const copyHeight = Math.min(currentHeight, nextHeight);

    nextPColorGrid.fill(emptyColor);
    fillTemperatureGridByAmbient(nextTemperature, nextWidth, nextAmbientByRow);

    for (let y = 0; y < copyHeight; y++) {
      const oldStart = y * currentWidth;
      const nextStart = y * nextWidth;
      nextGrid.set(oldGrid.subarray(oldStart, oldStart + copyWidth), nextStart);
      nextPColorGrid.set(oldPColorGrid.subarray(oldStart, oldStart + copyWidth), nextStart);
      nextOffsets.set(oldOffsets.subarray(oldStart, oldStart + copyWidth), nextStart);
      nextTemperature.set(oldTemperature.subarray(oldStart, oldStart + copyWidth), nextStart);
    }

    gridRef.current = nextGrid;
    particleColorGridRef.current = nextPColorGrid;
    colorOffsetRef.current = nextOffsets;
    temperatureRef.current = nextTemperature;
    ambientByRowRef.current = nextAmbientByRow;
    cursorRef.current = null;

    entitiesRef.current = entitiesRef.current.map((entity) => {
      const shape = findEntityShape(entity.type);
      if (!shape) return entity;

      const entityWidth = calculateEntityWidth(shape, entity.scale);
      const entityHeight = calculateEntityHeight(shape, entity.scale);
      const maxX = Math.max(0, nextWidth - entityWidth);
      const maxY = Math.max(0, nextHeight - entityHeight);
      const x = Math.max(0, Math.min(maxX, entity.x));
      const y = Math.max(0, Math.min(maxY, entity.y));
      if (x === entity.x && y === entity.y) return entity;

      return { ...entity, x, y };
    });

    updateBackgroundImagePixels(backgroundImageUrl);
  }, [
    backgroundImageUrl,
    bgColor,
    clearFireworkEffects,
    environmentTemperatureCelsius,
    initEmptyGrid,
    updateBackgroundImagePixels,
  ]);

  // Initialize Grid
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const clientWidth = window.innerWidth;
    const clientHeight = calculateCanvasClientHeight();

    canvas.style.width = `${clientWidth}px`;
    canvas.style.height = `${clientHeight}px`;

    const width = Math.ceil(clientWidth / CELL_SIZE);
    const height = Math.ceil(clientHeight / CELL_SIZE);

    canvas.width = width;
    canvas.height = height;

    gridWidthRef.current = width;
    gridHeightRef.current = height;

    const sharedState = readSunaPaintShareStateFromLocation();
    if (sharedState && restoreSerializedStateToViewport(sharedState, width, height)) {
      return;
    }

    const saved = readLocalStorageItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const storedEnvironmentTemperatureCelsius = clampEnvironmentTemperatureCelsius(data.environmentTemperatureCelsius);
        if (data.width === width && data.height === height) {
          console.log("Loading saved state...");
          const storedColors = normalizeStoredColors(data.colors);
          setColors(storedColors);
          if (data.brushSize) setBrushSize(data.brushSize);
          if (isParticleType(data.selectedType) || data.selectedType === WIND_TOOL || data.selectedType === FIREWORK_TOOL)
            setSelectedType(data.selectedType);
          if (typeof data.gravity === "number") setGravity(Math.max(MIN_GRAVITY, Math.min(MAX_GRAVITY, data.gravity)));
          setTimeScale(normalizeTimeScale(data.timeScale));
          setEnvironmentTemperatureCelsius(storedEnvironmentTemperatureCelsius);
          if (isTemperatureViewMode(data.temperatureViewMode)) setTemperatureViewMode(data.temperatureViewMode);
          if (typeof data.backgroundImageUrl === "string") setBackgroundImageUrl(data.backgroundImageUrl);
          if (isSkyMode(data.skyMode)) setSkyMode(data.skyMode);
          if (data.nextEntityId) nextEntityId.current = data.nextEntityId;
          // bgColor is intentionally NOT loaded

          entitiesRef.current = createEntitiesFromUnknown(data.entities, storedColors);

          // Restore Grid (RLE)
          const grid = new Uint8Array(width * height);
          const rle = data.gridRLE;
          let ptr = 0;
          for (let i = 0; i < rle.length; i += 2) {
            const val = rle[i];
            const count = rle[i + 1];
            for (let j = 0; j < count; j++) {
              grid[ptr++] = val;
            }
          }
          gridRef.current = grid;

          // Restore Particle Colors (RLE)
          const pColorGrid = new Uint32Array(width * height);
          const pColorRle = data.particleColorGridRle;
          if (pColorRle) {
            ptr = 0;
            for (let i = 0; i < pColorRle.length; i += 2) {
              const val = pColorRle[i];
              const count = pColorRle[i + 1];
              for (let j = 0; j < count; j++) {
                const isLegacyFoodParticle = grid[ptr] === TYPES.FOOD && val === hexToUint32(LEGACY_FOOD_COLOR);
                pColorGrid[ptr] = isLegacyFoodParticle ? hexToUint32(DEFAULT_COLORS[TYPES.FOOD]) : val;
                ptr++;
              }
            }
          } else {
            pColorGrid.fill(hexToUint32(DEFAULT_COLORS[TYPES.EMPTY]));
          }
          particleColorGridRef.current = pColorGrid;

          // Re-init Offsets/Temp(温度は永続化しないので平常温度で初期化する)
          colorOffsetRef.current = new Int8Array(width * height);
          const ambientByRow = buildAmbientByRow(height, storedEnvironmentTemperatureCelsius);
          ambientByRowRef.current = ambientByRow;
          const temperature = new Uint8Array(width * height);
          fillTemperatureGridByAmbient(temperature, width, ambientByRow);
          temperatureRef.current = temperature;
          for (let i = 0; i < colorOffsetRef.current.length; i++) {
            if (grid[i] !== TYPES.EMPTY) {
              colorOffsetRef.current[i] = randomOffset();
            }
          }
        } else {
          console.log(`Grid size mismatch (saved: ${data.width}x${data.height}, current: ${width}x${height}). Resetting.`);
          setEnvironmentTemperatureCelsius(storedEnvironmentTemperatureCelsius);
          initEmptyGrid(width, height, storedEnvironmentTemperatureCelsius);
        }
      } catch (e) {
        console.error("Failed to load save", e);
        initEmptyGrid(width, height, DEFAULT_ENVIRONMENT_TEMPERATURE_CELSIUS);
      }
    } else {
      initEmptyGrid(width, height, DEFAULT_ENVIRONMENT_TEMPERATURE_CELSIUS);
    }
  }, [initEmptyGrid, restoreSerializedStateToViewport]);

  const updateEnvironmentTemperature = useCallback((nextTemperatureCelsius: number) => {
    const nextTemperature = clampEnvironmentTemperatureCelsius(nextTemperatureCelsius);
    setEnvironmentTemperatureCelsius(nextTemperature);
    const height = gridHeightRef.current;
    if (height > 0) {
      ambientByRowRef.current = buildAmbientByRow(height, nextTemperature);
    }
  }, []);

  useEffect(() => {
    const height = gridHeightRef.current;
    if (height <= 0) return;
    ambientByRowRef.current = buildAmbientByRow(height, environmentTemperatureCelsius);
  }, [environmentTemperatureCelsius]);

  const saveToStorage = useCallback(() => {
    const data = createSerializedSunaPaintState("storage");
    if (!data) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Storage full or error", e);
    }
  }, [createSerializedSunaPaintState]);

  const undoCanvas = useCallback(() => {
    const history = undoHistoryRef.current;
    const snapshot = history[history.length - 1];
    if (!snapshot) return;

    const nextHistory = history.slice(0, history.length - 1);
    undoHistoryRef.current = nextHistory;
    restoreSnapshot(snapshot);
    setUndoDepth(nextHistory.length);
    saveToStorage();
  }, [restoreSnapshot, saveToStorage]);

  useEffect(() => {
    const undoByKeyboard = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.key.toLowerCase() !== "z") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey) return;

      event.preventDefault();
      undoCanvas();
    };

    window.addEventListener("keydown", undoByKeyboard);
    return () => window.removeEventListener("keydown", undoByKeyboard);
  }, [undoCanvas]);

  useEffect(() => {
    updateBackgroundImagePixels(backgroundImageUrl);
  }, [backgroundImageUrl, updateBackgroundImagePixels]);

  // 現在のグリッドサイズと時間帯で空の背景を作り直す。時間帯変更のたびに呼ぶ。
  const updateSkyPixels = useCallback(() => {
    skyPixelsRef.current = buildSkyPixels(gridWidthRef.current, gridHeightRef.current, skyModeRef.current);
  }, []);

  // 時間帯が変わったら空を作り直す(温度など他の状態には触れない=見た目だけ)。
  useEffect(() => {
    skyModeRef.current = skyMode;
    updateSkyPixels();
  }, [skyMode, updateSkyPixels]);

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_TOOLBAR_QUERY);
    const updateDetachedMenuState = () => {
      setIsDetachedMenu(mobileQuery.matches);
    };

    updateDetachedMenuState();
    if (typeof mobileQuery.addEventListener === "function") {
      mobileQuery.addEventListener("change", updateDetachedMenuState);
      return () => mobileQuery.removeEventListener("change", updateDetachedMenuState);
    }

    mobileQuery.addListener(updateDetachedMenuState);
    return () => mobileQuery.removeListener(updateDetachedMenuState);
  }, []);

  const requestViewportResize = useCallback(() => {
    if (viewportResizeFrameRef.current !== null) return;

    viewportResizeFrameRef.current = window.requestAnimationFrame(() => {
      viewportResizeFrameRef.current = null;
      resizeCanvasToViewport();
      updateToolbarScrollHint();
    });
  }, [resizeCanvasToViewport, updateToolbarScrollHint]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const settleTimeout = window.setTimeout(requestViewportResize, 250);

    window.addEventListener("resize", requestViewportResize);
    visualViewport?.addEventListener("resize", requestViewportResize);
    visualViewport?.addEventListener("scroll", requestViewportResize);

    return () => {
      window.removeEventListener("resize", requestViewportResize);
      visualViewport?.removeEventListener("resize", requestViewportResize);
      visualViewport?.removeEventListener("scroll", requestViewportResize);
      window.clearTimeout(settleTimeout);
      if (viewportResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportResizeFrameRef.current);
        viewportResizeFrameRef.current = null;
      }
    };
  }, [requestViewportResize]);

  useEffect(() => {
    updateToolbarScrollHint();
    window.addEventListener("resize", updateToolbarScrollHint);
    const toolbar = toolbarRef.current;
    const resizeObserver = toolbar && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateToolbarScrollHint) : null;
    if (toolbar && resizeObserver) {
      resizeObserver.observe(toolbar);
      Array.from(toolbar.children).forEach((child) => { resizeObserver.observe(child); });
    }
    const timeout = window.setTimeout(updateToolbarScrollHint, 250);

    return () => {
      window.removeEventListener("resize", updateToolbarScrollHint);
      resizeObserver?.disconnect();
      window.clearTimeout(timeout);
    };
  }, [updateToolbarScrollHint]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: この依存配列は既存の再計算・再初期化タイミングを定義しており、提案を適用すると処理回数や発火条件が変わるため
  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(updateToolbarScrollHint);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    activeMenu,
    brushSize,
    selectedType,
    undoDepth,
    isPaused,
    gravity,
    timeScale,
    environmentTemperatureCelsius,
    temperatureViewMode,
    backgroundImageUrl,
    updateToolbarScrollHint,
  ]);

  useEffect(() => {
    const closeMenuOutsideToolbar = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.closest(`.${styles.dropdownContainer}`)) return;
      if (event.target.closest(`.${styles.dropdownMenu}`)) return;

      setActiveMenu(null);
    };

    document.addEventListener("pointerdown", closeMenuOutsideToolbar);
    return () => document.removeEventListener("pointerdown", closeMenuOutsideToolbar);
  }, []);

  useEffect(() => {
    if (!savePreviewUrl) return;

    const closeSavePreviewByKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSavePreviewUrl(null);
    };

    window.addEventListener("keydown", closeSavePreviewByKeyboard);
    return () => window.removeEventListener("keydown", closeSavePreviewByKeyboard);
  }, [savePreviewUrl]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: この依存配列は既存の再計算・再初期化タイミングを定義しており、提案を適用すると処理回数や発火条件が変わるため
  useEffect(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      saveToStorage();
    }, 2000);
  }, [
    colors,
    brushSize,
    selectedType,
    isPaused,
    bgColor,
    gravity,
    timeScale,
    environmentTemperatureCelsius,
    temperatureViewMode,
    backgroundImageUrl,
    skyMode,
    saveToStorage,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) saveToStorage();
    }, 5000);
    return () => clearInterval(interval);
  }, [isPaused, saveToStorage]);

  useEffect(() => {
    const handleUnload = () => {
      saveToStorage();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [saveToStorage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let animationId: number;
    let lastTime = 0;
    let simulationAccumulator = 0;
    const interval = 1000 / FPS;
    // 標準以下では1回、高速時だけ2回まで更新し、遅い端末が遅延分を追いかけて重くなるのを防ぐ。
    const maxSimulationUpdates = timeScale > DEFAULT_TIME_SCALE ? MAX_SIMULATION_UPDATES_PER_FRAME : 1;

    const updateHeat = () => {
      if (!gridRef.current || !temperatureRef.current) return;
      const grid = gridRef.current;
      const tempGrid = temperatureRef.current;
      const width = gridWidthRef.current;
      const height = gridHeightRef.current;
      const ambientByRow = ambientByRowRef.current;
      const ambientAt = (y: number) => ambientByRow?.[y] ?? AMBIENT_TEMP;

      // 平常温度へ近づける(暖かければ冷やし、冷たければ温める双方向の緩和)
      const relaxToward = (i: number, ambient: number, rate: number) => {
        const t = tempGrid[i];
        if (t > ambient) tempGrid[i] = Math.max(ambient, t - rate);
        else if (t < ambient) tempGrid[i] = Math.min(ambient, t + rate);
      };

      for (let i = 0; i < width * height; i++) {
        const currentType = grid[i];
        const x = i % width;
        const y = (i - x) / width;
        const ambient = ambientAt(y);

        const up = y > 0 ? i - width : -1;
        const down = y < height - 1 ? i + width : -1;
        const left = x > 0 ? i - 1 : -1;
        const right = x < width - 1 ? i + 1 : -1;

        // 空セルは平常温度へ素早く緩和する
        if (currentType === TYPES.EMPTY) {
          relaxToward(i, ambient, AMBIENT_RELAX);
          continue;
        }

        // 雪: 氷点下では冷源、暖かい環境では融ける方向へ温まる
        if (currentType === TYPES.SNOW) {
          if (ambient > SNOW_MELT_TEMP) {
            if (
              Math.random() <
              calculateThawWarmChance(
                ambient,
                SNOW_MELT_TEMP,
                SNOW_THAW_WARM_BASE_CHANCE,
                SNOW_THAW_WARM_CHANCE_SCALE,
              )
            ) {
              relaxToward(i, ambient, calculateThawWarmRate(ambient, SNOW_MELT_TEMP, SNOW_THAW_WARM_RATE_SCALE));
            }
            continue;
          }
          tempGrid[i] = Math.max(0, tempGrid[i] - SNOW_SELF_COOL);
          for (const n of [up, down, left, right]) {
            if (n !== -1) tempGrid[n] = Math.max(0, tempGrid[n] - SNOW_NEIGHBOR_CHILL);
          }
          continue;
        }

        // 氷: 氷点下では少し冷源、暖かい環境では融ける方向へ温まる
        if (currentType === TYPES.ICE) {
          if (ambient > ICE_MELT_TEMP) {
            if (
              Math.random() <
              calculateThawWarmChance(ambient, ICE_MELT_TEMP, ICE_THAW_WARM_BASE_CHANCE, ICE_THAW_WARM_CHANCE_SCALE)
            ) {
              relaxToward(i, ambient, calculateThawWarmRate(ambient, ICE_MELT_TEMP, ICE_THAW_WARM_RATE_SCALE));
            }
          } else if (tempGrid[i] <= FREEZE_TEMP) {
            for (const n of [up, down, left, right]) {
              if (n !== -1) tempGrid[n] = Math.max(0, tempGrid[n] - ICE_NEIGHBOR_CHILL);
            }
            if (Math.random() < 0.1) tempGrid[i] = Math.min(FREEZE_TEMP, tempGrid[i] + 1);
          } else {
            relaxToward(i, ambient, 1);
          }
          continue;
        }

        // マグマ: 断熱モデル。マグマ同士は熱を逃がさない(内部はほぼ永久に溶融)。
        // 空気・固体に触れた面はゆっくり(確率的に)冷えて溶岩らしく長く溶けた状態を保ち、
        // 水・雪・氷に触れた面は急冷されて黒曜石になる。
        if (currentType === TYPES.MAGMA) {
          let waterContact = false;
          let airExposed = false;
          for (const n of [up, down, left, right]) {
            if (n === -1) continue;
            const nt = grid[n];
            if (nt === TYPES.MAGMA) continue; // 断熱
            if (nt === TYPES.WATER || nt === TYPES.SNOW || nt === TYPES.ICE) waterContact = true;
            else airExposed = true;
          }
          if (waterContact) {
            tempGrid[i] = Math.max(0, tempGrid[i] - MAGMA_WATER_COOL);
          } else if (airExposed) {
            // 環境温度が低いほど空冷を速める。平常(20度)では従来の確率のままなので、
            // 通常プレイの「溶岩が長く溶けている」見た目は変えずに、極寒設定でだけ固化が進む。
            const coldRatio = ambient < AMBIENT_TEMP ? (AMBIENT_TEMP - ambient) / AMBIENT_TEMP : 0;
            if (Math.random() < MAGMA_AIR_COOL_CHANCE * (1 + coldRatio * MAGMA_COLD_AIR_COOL_BOOST)) {
              tempGrid[i] = Math.max(0, tempGrid[i] - 1);
            }
          }
          continue;
        }

        // 固体ブロック(石/壁/砂/食べ物/黒曜石/ガラス): 熱源に隣接しなければ速く平常へ
        if (
          currentType === TYPES.STONE ||
          currentType === TYPES.WALL ||
          currentType === TYPES.SAND ||
          currentType === TYPES.FOOD ||
          currentType === TYPES.OBSIDIAN ||
          currentType === TYPES.GLASS
        ) {
          let adjacentToHeat = false;
          const neighbors = [i - width, i + width, i - 1, i + 1, i - width - 1, i - width + 1, i + width - 1, i + width + 1];
          for (const nIdx of neighbors) {
            if (nIdx >= 0 && nIdx < width * height) {
              const neighborType = grid[nIdx];
              if (neighborType === TYPES.FIRE || neighborType === TYPES.MAGMA) {
                adjacentToHeat = true;
                break;
              }
              if (tempGrid[nIdx] > 150) {
                adjacentToHeat = true;
                break;
              }
            }
          }

          if (!adjacentToHeat) {
            relaxToward(i, ambient, 5);
          }
          continue;
        }

        // その他の粒子(水・植物・蒸気・雲など): 平常へ緩和 + 温度差ベースの拡散
        if (Math.random() < 0.2) {
          relaxToward(i, ambient, 2);
        }
        if (Math.random() < 0.1) {
          const dir = Math.floor(Math.random() * 4);
          let neighbor = -1;
          if (dir === 0) neighbor = up;
          else if (dir === 1) neighbor = down;
          else if (dir === 2) neighbor = left;
          else neighbor = right;

          if (neighbor >= 0) {
            // 温度差の20%を移動(冷気も熱と同じ仕組みで拡散する)
            const delta = Math.trunc((tempGrid[i] - tempGrid[neighbor]) * 0.2);
            if (delta !== 0) {
              tempGrid[i] = Math.max(0, Math.min(255, tempGrid[i] - delta));
              tempGrid[neighbor] = Math.max(0, Math.min(255, tempGrid[neighbor] + delta));
            }
          }
        }
      }

    };

    const updateParticles = () => {
      if (!gridRef.current || !temperatureRef.current || !colorOffsetRef.current || !particleColorGridRef.current) return;

      const grid = gridRef.current;
      const pColorGrid = particleColorGridRef.current;
      const tempGrid = temperatureRef.current;
      const width = gridWidthRef.current;
      const height = gridHeightRef.current;
      const offsets = colorOffsetRef.current;

      const moveParticle = (fromIdx: number, toIdx: number) => {
        grid[toIdx] = grid[fromIdx];
        pColorGrid[toIdx] = pColorGrid[fromIdx];
        grid[fromIdx] = TYPES.EMPTY;
        pColorGrid[fromIdx] = hexToUint32(bgColor);

        const offset = offsets[fromIdx];
        offsets[fromIdx] = offsets[toIdx];
        offsets[toIdx] = offset;

        const heat = tempGrid[fromIdx];
        tempGrid[fromIdx] = tempGrid[toIdx];
        tempGrid[toIdx] = heat;
      };

      const gravityDirection = calculateGravityDirection(gravity);
      const gravityPower = Math.abs(gravity);
      const hasGravity = gravityPower > GRAVITY_EPSILON;
      const gravityChance = Math.min(1, gravityPower);
      const gravityDistanceMultiplier = Math.max(1, gravityPower);
      const fallStartY = gravityDirection > 0 ? height - 1 : 0;
      const fallEndY = gravityDirection > 0 ? -1 : height;
      const fallStepY = gravityDirection > 0 ? -1 : 1;
      const riseDirection = gravityDirection > 0 ? -1 : 1;
      const riseStartY = riseDirection < 0 ? 0 : height - 1;
      const riseEndY = riseDirection < 0 ? height : -1;
      const riseStepY = riseDirection < 0 ? 1 : -1;

      const isInsideY = (targetY: number) => {
        return targetY >= 0 && targetY < height;
      };

      const shouldMoveByGravity = () => {
        return hasGravity && Math.random() < gravityChance;
      };

      const calculateGravityDistance = (baseDistance: number) => {
        return Math.max(1, Math.min(8, Math.ceil(baseDistance * gravityDistanceMultiplier)));
      };

      const turnWaterToSteam = (targetIdx: number, heat: number) => {
        grid[targetIdx] = TYPES.STEAM;
        pColorGrid[targetIdx] = hexToUint32(DEFAULT_COLORS[TYPES.STEAM]);
        offsets[targetIdx] = Math.floor(Math.random() * VARIATION * 2) - VARIATION;
        tempGrid[targetIdx] = heat;
      };

      // マグマの固化。水で急冷されたなら黒曜石、ゆっくり空冷なら石。
      // 石は HOT_STONE_FALL_TEMP より高い温度で出来るので、出来たての岩は少し崩れ落ちる。
      const solidifyMagma = (targetIdx: number, toObsidian: boolean) => {
        if (toObsidian) {
          grid[targetIdx] = TYPES.OBSIDIAN;
          pColorGrid[targetIdx] = hexToUint32(DEFAULT_COLORS[TYPES.OBSIDIAN]);
          tempGrid[targetIdx] = 120;
        } else {
          grid[targetIdx] = TYPES.STONE;
          pColorGrid[targetIdx] = hexToUint32(DEFAULT_COLORS[TYPES.STONE]);
          tempGrid[targetIdx] = 150;
        }
        offsets[targetIdx] = randomOffset();
      };

      // 4近傍に水・蒸気・氷・雪があれば true(急冷判定に使う)
      const hasWetNeighbor = (cx: number, cy: number) => {
        const cidx = cy * width + cx;
        const candidates = [
          cy > 0 ? cidx - width : -1,
          cy < height - 1 ? cidx + width : -1,
          cx > 0 ? cidx - 1 : -1,
          cx < width - 1 ? cidx + 1 : -1,
        ];
        for (const n of candidates) {
          if (n === -1) continue;
          const nt = grid[n];
          if (nt === TYPES.WATER || nt === TYPES.STEAM || nt === TYPES.ICE || nt === TYPES.SNOW) return true;
        }
        return false;
      };

      // 凍結の核になるのは冷たい「雪」だけ。氷を核にすると、氷で作った水槽の水が
      // 低温設定のたびに全面凍結してしまう(ユーザー要望「氷で水が凍る機能を外して、雪はOK」)ため、
      // 氷は核から除外した。-20度以下の自然凍結(SPONTANEOUS_FREEZE_TEMP)は従来通り。
      const hasColdSnowNeighbor = (cx: number, cy: number) => {
        const cidx = cy * width + cx;
        const candidates = [
          cy > 0 ? cidx - width : -1,
          cy < height - 1 ? cidx + width : -1,
          cx > 0 ? cidx - 1 : -1,
          cx < width - 1 ? cidx + 1 : -1,
        ];
        for (const n of candidates) {
          if (n === -1) continue;
          if (grid[n] === TYPES.SNOW && tempGrid[n] < FREEZE_TEMP) return true;
        }
        return false;
      };

      // 8近傍のうち type 判定が真になる数を数える(雲の密度判定などに使う)
      const countNeighbors = (cx: number, cy: number, predicate: (t: number) => boolean) => {
        let count = 0;
        for (let ddy = -1; ddy <= 1; ddy++) {
          for (let ddx = -1; ddx <= 1; ddx++) {
            if (ddx === 0 && ddy === 0) continue;
            const nx = cx + ddx;
            const ny = cy + ddy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (predicate(grid[ny * width + nx])) count++;
          }
        }
        return count;
      };

      // 雲はその場で漂う(横へゆっくり揺れる)だけ。空セルにのみ移動する。風で動かせる。
      const driftCloud = (cIdx: number, cx: number, cy: number) => {
        if (Math.random() < 0.5) {
          const dir = Math.random() > 0.5 ? 1 : -1;
          const sideX = cx + dir;
          if (sideX >= 0 && sideX < width && grid[cy * width + sideX] === TYPES.EMPTY) {
            moveParticle(cIdx, cy * width + sideX);
          }
        }
      };

      for (let y = fallStartY; y !== fallEndY; y += fallStepY) {
        const startX = Math.random() > 0.5 ? 0 : width - 1;
        const stepX = startX === 0 ? 1 : -1;

        for (let i = 0; i < width; i++) {
          const x = startX + i * stepX;
          const idx = y * width + x;
          const type = grid[idx];

          if (type === TYPES.EMPTY) continue;

          // 落雷セル: 短命。周囲を加熱し、可燃物を発火させてから消える(温度255は残す)
          if (type === TYPES.LIGHTNING) {
            for (const n of [
              y > 0 ? idx - width : -1,
              y < height - 1 ? idx + width : -1,
              x > 0 ? idx - 1 : -1,
              x < width - 1 ? idx + 1 : -1,
            ]) {
              if (n === -1) continue;
              tempGrid[n] = Math.min(255, tempGrid[n] + 80);
              if ((grid[n] === TYPES.PLANT || grid[n] === TYPES.FOOD) && Math.random() < 0.5) {
                grid[n] = TYPES.FIRE;
                pColorGrid[n] = hexToUint32(DEFAULT_COLORS[TYPES.FIRE]);
                offsets[n] = randomOffset();
                tempGrid[n] = 255;
              }
            }
            if (Math.random() < LIGHTNING_DECAY_CHANCE) {
              grid[idx] = TYPES.EMPTY;
              pColorGrid[idx] = hexToUint32(bgColor);
              // 温度はそのまま(updateHeat が平常へ戻す)
            }
            continue;
          }

          // Heat Sources
          if (type === TYPES.FIRE) {
            tempGrid[idx] = 255;
            // Propagate Heat
            if (y > 0) tempGrid[idx - width] = Math.min(255, tempGrid[idx - width] + 50);
            if (y < height - 1) tempGrid[idx + width] = Math.min(255, tempGrid[idx + width] + 50);
            if (x > 0) tempGrid[idx - 1] = Math.min(255, tempGrid[idx - 1] + 50);
            if (x < width - 1) tempGrid[idx + 1] = Math.min(255, tempGrid[idx + 1] + 50);
          } else if (type === TYPES.MAGMA) {
            // マグマは自分の温度から放熱する(温度は updateHeat の断熱モデルが管理)
            const radiate = tempGrid[idx] > IGNITE_TEMP ? 30 : tempGrid[idx] > MAGMA_SOLIDIFY_TEMP ? 10 : 0;
            if (radiate > 0) {
              for (const n of [
                y > 0 ? idx - width : -1,
                y < height - 1 ? idx + width : -1,
                x > 0 ? idx - 1 : -1,
                x < width - 1 ? idx + 1 : -1,
              ]) {
                if (n !== -1 && grid[n] !== TYPES.MAGMA) tempGrid[n] = Math.min(255, tempGrid[n] + radiate);
              }
            }
          }

          if ((type === TYPES.PLANT || type === TYPES.FOOD) && tempGrid[idx] > IGNITE_TEMP && Math.random() < 0.05) {
            grid[idx] = TYPES.FIRE;
            pColorGrid[idx] = hexToUint32(DEFAULT_COLORS[TYPES.FIRE]);
            offsets[idx] = randomOffset();
            tempGrid[idx] = 255;
            continue;
          }

          // 氷: 暖まると水に戻る。それ以外は不動
          if (type === TYPES.ICE) {
            if (
              tempGrid[idx] > ICE_MELT_TEMP &&
              Math.random() < calculateMeltChance(tempGrid[idx], ICE_MELT_TEMP, ICE_MELT_CHANCE, ICE_MAX_MELT_CHANCE)
            ) {
              grid[idx] = TYPES.WATER;
              pColorGrid[idx] = hexToUint32(DEFAULT_COLORS[TYPES.WATER]);
              offsets[idx] = randomOffset();
              tempGrid[idx] = 30;
            }
            continue;
          }

          // 雪: 暖まると水に戻る。ゆっくり横ドリフトしながら落ちて積もる
          if (type === TYPES.SNOW) {
            if (
              tempGrid[idx] > SNOW_MELT_TEMP &&
              Math.random() < calculateMeltChance(tempGrid[idx], SNOW_MELT_TEMP, SNOW_MELT_CHANCE, SNOW_MAX_MELT_CHANCE)
            ) {
              grid[idx] = TYPES.WATER;
              pColorGrid[idx] = hexToUint32(DEFAULT_COLORS[TYPES.WATER]);
              offsets[idx] = randomOffset();
              tempGrid[idx] = 25;
              continue;
            }

            if (shouldMoveByGravity() && Math.random() < SNOW_FALL_CHANCE) {
              const belowY = y + gravityDirection;
              if (isInsideY(belowY)) {
                const belowIdx = belowY * width + x;
                const belowType = grid[belowIdx];
                // 横ドリフト優先
                if (Math.random() < SNOW_DRIFT_CHANCE) {
                  const dir = Math.random() > 0.5 ? 1 : -1;
                  const sideX = x + dir;
                  if (sideX >= 0 && sideX < width) {
                    const sideBelowIdx = belowY * width + sideX;
                    if (grid[sideBelowIdx] === TYPES.EMPTY) {
                      moveParticle(idx, sideBelowIdx);
                      continue;
                    }
                  }
                }
                if (belowType === TYPES.EMPTY) {
                  moveParticle(idx, belowIdx);
                  continue;
                }
                // 雲の中はすり抜ける(降雪)
                if (isCloudType(belowType)) {
                  moveParticle(idx, belowIdx);
                  continue;
                }
                // 水面には載る(下の水を冷やして氷の張る土台になる)
              }
            }
            continue;
          }

          // 火の粉(花火): 雪よりやや速くドリフト落下し、着地すると同じ色の砂になって積もる。
          // ごく低確率で燃え尽きて消える(全弾積もると画面が埋まるための間引き)
          if (type === TYPES.EMBER) {
            if (Math.random() < EMBER_FADE_CHANCE) {
              grid[idx] = TYPES.EMPTY;
              continue;
            }
            if (shouldMoveByGravity() && Math.random() < EMBER_FALL_CHANCE) {
              const belowY = y + gravityDirection;
              if (isInsideY(belowY)) {
                const belowIdx = belowY * width + x;
                const belowType = grid[belowIdx];
                // 横ドリフト優先(雪と同じ揺らめき)
                if (Math.random() < EMBER_DRIFT_CHANCE) {
                  const dir = Math.random() > 0.5 ? 1 : -1;
                  const sideX = x + dir;
                  if (sideX >= 0 && sideX < width) {
                    const sideBelowIdx = belowY * width + sideX;
                    if (grid[sideBelowIdx] === TYPES.EMPTY) {
                      moveParticle(idx, sideBelowIdx);
                      continue;
                    }
                  }
                }
                if (belowType === TYPES.EMPTY || isCloudType(belowType)) {
                  moveParticle(idx, belowIdx);
                  continue;
                }
                // 水に落ちた火の粉は消える(じゅっと消える演出)
                if (belowType === TYPES.WATER) {
                  grid[idx] = TYPES.EMPTY;
                  continue;
                }
                // 着地: 花火の色をそのまま引き継いだ砂になる(=描いた絵の上に色砂が積もる)
                grid[idx] = TYPES.SAND;
                continue;
              }
              // 画面下端に到達した場合もその場で色砂化する
              grid[idx] = TYPES.SAND;
            }
            continue;
          }

          if (type === TYPES.STONE && tempGrid[idx] > HOT_STONE_FALL_TEMP && shouldMoveByGravity()) {
            let fallTargetIdx: number | null = null;
            const fallDistance = calculateGravityDistance(1);

            for (let fallStep = 1; fallStep <= fallDistance; fallStep++) {
              const targetY = y + gravityDirection * fallStep;
              if (!isInsideY(targetY)) break;

              const targetIdx = targetY * width + x;
              if (grid[targetIdx] === TYPES.EMPTY) {
                fallTargetIdx = targetIdx;
              } else {
                break;
              }
            }

            if (fallTargetIdx !== null) {
              moveParticle(idx, fallTargetIdx);
              continue;
            }
          }

          if (
            type === TYPES.WALL ||
            type === TYPES.STONE ||
            type === TYPES.PLANT ||
            type === TYPES.OBSIDIAN ||
            type === TYPES.GLASS
          ) {
            if (type === TYPES.PLANT && tempGrid[idx] > IGNITE_TEMP && Math.random() < 0.05) {
              grid[idx] = TYPES.FIRE;
              pColorGrid[idx] = hexToUint32(DEFAULT_COLORS[TYPES.FIRE]);
              offsets[idx] = randomOffset();
            }
            continue;
          }

          if (type === TYPES.FIRE || type === TYPES.STEAM) continue;

          if (type === TYPES.MAGMA) {
            const neighbors = [
              y > 0 ? idx - width : -1,
              y < height - 1 ? idx + width : -1,
              x > 0 ? idx - 1 : -1,
              x < width - 1 ? idx + 1 : -1,
            ];

            for (const nIdx of neighbors) {
              if (nIdx === -1) continue;

              if (grid[nIdx] === TYPES.WATER) {
                // 水を蒸気に変え、自分は急冷される(温度モデル経由で固化→黒曜石になる)
                turnWaterToSteam(nIdx, 180);
                tempGrid[idx] = Math.max(0, tempGrid[idx] - 40);
              } else if (grid[nIdx] === TYPES.PLANT || grid[nIdx] === TYPES.FOOD) {
                grid[nIdx] = TYPES.FIRE;
                pColorGrid[nIdx] = hexToUint32(DEFAULT_COLORS[TYPES.FIRE]);
                offsets[nIdx] = randomOffset();
                tempGrid[nIdx] = 255;
              } else if (grid[nIdx] === TYPES.SAND && Math.random() < MAGMA_SAND_TO_GLASS_CHANCE) {
                // マグマの熱で砂が溶けてガラスになる
                grid[nIdx] = TYPES.GLASS;
                pColorGrid[nIdx] = hexToUint32(DEFAULT_COLORS[TYPES.GLASS]);
                offsets[nIdx] = randomOffset();
                tempGrid[nIdx] = 200;
              }
            }

            // 温度が固化点を下回ったら固化。水気があれば黒曜石、なければ石。
            if (tempGrid[idx] < MAGMA_SOLIDIFY_TEMP) {
              solidifyMagma(idx, hasWetNeighbor(x, y));
              continue;
            }

            // 冷えるほど粘性が上がり流れにくくなる(0=固化寸前, 1=灼熱)
            const heatFactor = calculateMagmaHeatFactor(tempGrid[idx]);

            // 垂直落下は重力に従い無条件
            if (shouldMoveByGravity()) {
              let magmaMoved = false;
              const targetY = y + gravityDirection;
              if (isInsideY(targetY)) {
                const belowIdx = targetY * width + x;
                if (grid[belowIdx] === TYPES.EMPTY) {
                  moveParticle(idx, belowIdx);
                  continue;
                }
                if (grid[belowIdx] === TYPES.WATER) {
                  turnWaterToSteam(belowIdx, 180);
                  tempGrid[idx] = Math.max(0, tempGrid[idx] - 40);
                  continue;
                }
              }

              // 斜め流動は粘性次第(灼熱ほど起きやすい)
              if (Math.random() < 0.3 + 0.7 * heatFactor) {
                const startDir = Math.random() > 0.5 ? 1 : -1;
                const directions = [startDir, startDir * -1];
                for (const dir of directions) {
                  const targetX = x + dir;
                  const sideY = y + gravityDirection;
                  if (targetX < 0 || targetX >= width || !isInsideY(sideY)) continue;

                  const diagonalIdx = sideY * width + targetX;
                  if (grid[diagonalIdx] === TYPES.EMPTY) {
                    moveParticle(idx, diagonalIdx);
                    magmaMoved = true;
                  } else if (grid[diagonalIdx] === TYPES.WATER) {
                    turnWaterToSteam(diagonalIdx, 180);
                    tempGrid[idx] = Math.max(0, tempGrid[idx] - 40);
                    magmaMoved = true;
                  }

                  if (magmaMoved) break;
                }

                if (magmaMoved) continue;
              }
            }

            // 横流動も粘性でスケールする
            if (Math.random() < MAGMA_HORIZONTAL_FLOW_CHANCE * heatFactor) {
              const dir = Math.random() > 0.5 ? 1 : -1;
              const sideX = x + dir;
              if (sideX >= 0 && sideX < width) {
                const sideIdx = y * width + sideX;
                if (grid[sideIdx] === TYPES.EMPTY) {
                  moveParticle(idx, sideIdx);
                  continue;
                }
              }
            }
          }

          if (type === TYPES.WATER) {
            // 凍結: 強い氷点下では単体でも、軽い氷点下では冷たい雪を核にして氷になる(氷は核にしない)。
            const ambient = ambientByRowRef.current?.[y] ?? AMBIENT_TEMP;
            if (ambient < FREEZE_TEMP && tempGrid[idx] < FREEZE_TEMP && Math.random() < FREEZE_CHANCE) {
              if (ambient <= SPONTANEOUS_FREEZE_TEMP || hasColdSnowNeighbor(x, y)) {
                grid[idx] = TYPES.ICE;
                pColorGrid[idx] = hexToUint32(DEFAULT_COLORS[TYPES.ICE]);
                offsets[idx] = randomOffset();
                tempGrid[idx] = Math.min(tempGrid[idx], FREEZE_TEMP - 1);
                continue;
              }
            }

            // 雲の上に水が溜まらないよう、直下が雲系なら入れ替えてすり抜ける
            if (hasGravity) {
              const belowY = y + gravityDirection;
              if (isInsideY(belowY) && isCloudType(grid[belowY * width + x]) && Math.random() < 0.8) {
                moveParticle(idx, belowY * width + x);
                continue;
              }
            }

            let waterMoved = false;
            let fallTargetIdx: number | null = null;
            const fallDistance = shouldMoveByGravity() ? pickWaterFlowDistance(calculateGravityDistance(WATER_FALL_STEPS)) : 0;

            for (let fallStep = 1; fallStep <= fallDistance; fallStep++) {
              const targetY = y + gravityDirection * fallStep;
              if (!isInsideY(targetY)) break;

              const targetIdx = targetY * width + x;
              if (grid[targetIdx] === TYPES.EMPTY) {
                fallTargetIdx = targetIdx;
              } else {
                break;
              }
            }

            if (fallTargetIdx !== null) {
              moveParticle(idx, fallTargetIdx);
              continue;
            }

            const startDir = Math.random() > 0.5 ? 1 : -1;
            const directions = [startDir, startDir * -1];
            for (const dir of directions) {
              let diagonalTargetIdx: number | null = null;
              const diagonalDistance = hasGravity
                ? pickWaterFlowDistance(calculateGravityDistance(WATER_DIAGONAL_FLOW_DISTANCE))
                : 0;

              for (let slide = 1; slide <= diagonalDistance; slide++) {
                const targetX = x + dir * slide;
                const targetY = y + gravityDirection;
                if (targetX < 0 || targetX >= width || !isInsideY(targetY)) break;

                const targetIdx = targetY * width + targetX;
                if (grid[targetIdx] === TYPES.EMPTY) {
                  diagonalTargetIdx = targetIdx;
                } else {
                  break;
                }
              }

              if (diagonalTargetIdx !== null) {
                moveParticle(idx, diagonalTargetIdx);
                waterMoved = true;
              }

              if (waterMoved) break;
            }

            if (waterMoved) continue;
          }

          const canFall = type === TYPES.SAND || type === TYPES.FOOD;

          if (canFall && shouldMoveByGravity()) {
            let fallTargetIdx: number | null = null;
            const fallDistance = calculateGravityDistance(1);

            for (let fallStep = 1; fallStep <= fallDistance; fallStep++) {
              const targetY = y + gravityDirection * fallStep;
              if (!isInsideY(targetY)) break;

              const targetIdx = targetY * width + x;
              if (grid[targetIdx] === TYPES.EMPTY) {
                fallTargetIdx = targetIdx;
              } else {
                break;
              }
            }

            if (fallTargetIdx !== null) {
              moveParticle(idx, fallTargetIdx);
              continue;
            } else {
              const dir = Math.random() > 0.5 ? 1 : -1;
              const targetY = y + gravityDirection;
              const belowSide = targetY * width + (x + dir);

              if (isInsideY(targetY) && x + dir >= 0 && x + dir < width && grid[belowSide] === TYPES.EMPTY) {
                moveParticle(idx, belowSide);
                continue;
              }

              // 雲の上に砂が積もらないよう、直下が雲系ならすり抜ける
              const belowIdx = targetY * width + x;
              if (isInsideY(targetY) && isCloudType(grid[belowIdx])) {
                moveParticle(idx, belowIdx);
                continue;
              }
            }
          }

          // Sand Sinking in Water
          if ((type === TYPES.SAND || type === TYPES.FOOD) && hasGravity) {
            const targetY = y + gravityDirection;
            const belowIdx = targetY * width + x;
            if (isInsideY(targetY) && grid[belowIdx] === TYPES.WATER) {
              const waterColor = pColorGrid[belowIdx];
              const particleColor = pColorGrid[idx];

              grid[belowIdx] = type;
              pColorGrid[belowIdx] = particleColor;

              grid[idx] = TYPES.WATER;
              pColorGrid[idx] = waterColor;

              const t = offsets[idx];
              offsets[idx] = offsets[belowIdx];
              offsets[belowIdx] = t;
              continue;
            }
          }

          if (type === TYPES.WATER) {
            if (tempGrid[idx] > WATER_BOIL_TEMP) {
              if (Math.random() < 0.1) {
                const dir = Math.random() > 0.5 ? 1 : -1;
                let spawnIdx = idx;
                if (x + dir >= 0 && x + dir < width && grid[idx + dir] === TYPES.EMPTY) {
                  spawnIdx = idx + dir;
                }

                grid[spawnIdx] = TYPES.STEAM;
                pColorGrid[spawnIdx] = hexToUint32(DEFAULT_COLORS[TYPES.STEAM]);
                offsets[spawnIdx] = Math.floor(Math.random() * VARIATION * 2) - VARIATION;
                tempGrid[spawnIdx] = 100;

                if (spawnIdx !== idx) {
                  grid[idx] = TYPES.EMPTY;
                  pColorGrid[idx] = hexToUint32(bgColor);
                }

                tempGrid[idx] = Math.max(0, tempGrid[idx] - 50);
                continue;
              } else {
                tempGrid[idx] = Math.max(0, tempGrid[idx] - 5);
              }
            }

            let targetIdx: number | null = null;
            if (Math.random() > WATER_HORIZONTAL_FLOW_CHANCE) continue;

            const startDir = Math.random() > 0.5 ? 1 : -1;
            const directions = [startDir, startDir * -1];
            for (const dir of directions) {
              let openDistance = 0;

              for (let slide = 1; slide <= WATER_HORIZONTAL_FLOW_DISTANCE; slide++) {
                const targetX = x + dir * slide;
                if (targetX < 0 || targetX >= width) break;

                const side = y * width + targetX;
                if (grid[side] === TYPES.EMPTY) {
                  openDistance = slide;
                  const targetY = y + gravityDirection;
                  const belowSide = targetY * width + targetX;
                  if (isInsideY(targetY) && grid[belowSide] === TYPES.EMPTY) break;
                } else {
                  break;
                }
              }

              if (openDistance > 0) {
                const flowDistance = pickWaterFlowDistance(openDistance);
                targetIdx = y * width + (x + dir * flowDistance);
                break;
              }
            }

            if (targetIdx !== null) {
              moveParticle(idx, targetIdx);
            }
          }
        }
      }

      for (let y = riseStartY; y !== riseEndY; y += riseStepY) {
        const startX = Math.random() > 0.5 ? 0 : width - 1;
        const stepX = startX === 0 ? 1 : -1;

        for (let i = 0; i < width; i++) {
          const x = startX + i * stepX;
          const idx = y * width + x;
          const type = grid[idx];

          if (type !== TYPES.STEAM && type !== TYPES.FIRE && !isCloudType(type)) continue;

          if (type === TYPES.STEAM) {
            // 蒸気は上って消えていく(雲には自動でならない。雲はペンで置く)
            if (Math.random() < 0.005) {
              grid[idx] = TYPES.EMPTY;
              pColorGrid[idx] = hexToUint32(bgColor);
              tempGrid[idx] = ambientByRowRef.current?.[y] ?? AMBIENT_TEMP;
              continue;
            }
          }

          // --- 雲系(雲 / 雨雲 / 雷雲)。各分岐は必ず continue で終え、汎用上昇に到達させない ---
          // 置いた種類のまま振る舞う(勝手に昇格しない)。雨は雨雲、雷は雷雲からのみ。
          if (isCloudType(type)) {
            if (Math.random() > CLOUD_TICK_CHANCE) continue; // 処理を間引く

            // 暖まると再び蒸気へ(ヒステリシス)
            if (tempGrid[idx] > CLOUD_REEVAPORATE_TEMP) {
              turnWaterToSteam(idx, tempGrid[idx]);
              continue;
            }

            // 孤立した雲は消える
            if (countNeighbors(x, y, isCloudType) === 0 && Math.random() < CLOUD_LONELY_FADE_CHANCE) {
              grid[idx] = TYPES.EMPTY;
              pColorGrid[idx] = hexToUint32(bgColor);
              continue;
            }

            // ただの雲は雨を降らせない。その場で漂う(横揺れ)だけ。風で動かせる。
            if (type === TYPES.CLOUD) {
              driftCloud(idx, x, y);
              continue;
            }

            // 雨雲・雷雲: 雨(寒ければ雪)を落とす。置いた雨雲は降り続ける(勝手に枯れない)。
            if (hasGravity && Math.random() < RAIN_EMIT_CHANCE) {
              const belowY = y + gravityDirection;
              if (isInsideY(belowY)) {
                const belowIdx = belowY * width + x;
                if (grid[belowIdx] === TYPES.EMPTY) {
                  const snowy = tempGrid[idx] < SNOWFALL_TEMP;
                  grid[belowIdx] = snowy ? TYPES.SNOW : TYPES.WATER;
                  pColorGrid[belowIdx] = hexToUint32(DEFAULT_COLORS[snowy ? TYPES.SNOW : TYPES.WATER]);
                  offsets[belowIdx] = randomOffset();
                  tempGrid[belowIdx] = snowy ? 0 : (ambientByRowRef.current?.[belowY] ?? AMBIENT_TEMP);
                }
              }
            }

            // 雷雲は雨に加えてまれに落雷する(雷雲のまま居続ける)
            if (type === TYPES.THUNDER_CLOUD && Math.random() < THUNDER_STRIKE_CHANCE) {
              // 落雷にもユーザーが選択中の雷色を反映する
              castLightningBolt(grid, pColorGrid, offsets, tempGrid, width, height, x, y, gravityDirection, hexToUint32(colors[TYPES.LIGHTNING]));
            }

            driftCloud(idx, x, y); // 雨雲・雷雲もその場で漂う
            continue;
          }

          if (type === TYPES.FIRE) {
            const neighbors = [
              y > 0 ? idx - width : -1,
              y < height - 1 ? idx + width : -1,
              x > 0 ? idx - 1 : -1,
              x < width - 1 ? idx + 1 : -1,
            ];

            for (const nIdx of neighbors) {
              if (nIdx !== -1) {
                // 可燃物の扱いを温度経路・マグマ経路(PLANT と FOOD の両方)へ揃える。
                // ここだけ植物限定だったため、食べ物は隣に火があっても燃えなかった。
                if (grid[nIdx] === TYPES.PLANT || grid[nIdx] === TYPES.FOOD) {
                  if (Math.random() < FIRE_SPREAD_TO_PLANT_CHANCE / STEPS_PER_FRAME) {
                    grid[nIdx] = TYPES.FIRE;
                    pColorGrid[nIdx] = hexToUint32(DEFAULT_COLORS[TYPES.FIRE]);
                    offsets[nIdx] = Math.floor(Math.random() * VARIATION * 2) - VARIATION;
                    tempGrid[nIdx] = 255;
                  }
                } else if (grid[nIdx] === TYPES.WATER) {
                  grid[nIdx] = TYPES.STEAM;
                  pColorGrid[nIdx] = hexToUint32(DEFAULT_COLORS[TYPES.STEAM]);
                  offsets[nIdx] = Math.floor(Math.random() * VARIATION * 2) - VARIATION;
                  tempGrid[nIdx] = 150;
                  if (Math.random() < 0.1) grid[idx] = TYPES.EMPTY;
                }
              }
            }

            if (Math.random() < 0.05) {
              grid[idx] = TYPES.EMPTY;
              pColorGrid[idx] = hexToUint32(bgColor);
              tempGrid[idx] = 0;
              if (Math.random() < 0.3) {
                grid[idx] = TYPES.STEAM;
                pColorGrid[idx] = hexToUint32(DEFAULT_COLORS[TYPES.STEAM]);
              }
              continue;
            }
          }

          // Enhanced Steam Logic (Force Rise)
          if (type === TYPES.STEAM) {
            let moved = false;
            const riseDistance = hasGravity ? calculateGravityDistance(5) : 2;
            // biome-ignore lint/correctness/noUnreachable: typeは実行時のグリッド値で、蒸気が消滅しなかった場合に到達する
            for (let step = 1; step <= riseDistance; step++) {
              const targetY = y + riseDirection * step;
              if (!isInsideY(targetY)) {
                // 上端まで上り切った蒸気は消える
                grid[idx] = TYPES.EMPTY;
                pColorGrid[idx] = hexToUint32(bgColor);
                tempGrid[idx] = ambientByRowRef.current?.[y] ?? AMBIENT_TEMP;
                moved = true;
                break;
              }

              const aboveIdx = targetY * width + x;
              const aboveType = grid[aboveIdx];

              if (aboveType === TYPES.EMPTY) {
                grid[aboveIdx] = TYPES.STEAM;
                pColorGrid[aboveIdx] = pColorGrid[idx];
                grid[idx] = TYPES.EMPTY;
                pColorGrid[idx] = hexToUint32(bgColor);

                const t = offsets[idx];
                offsets[idx] = offsets[aboveIdx];
                offsets[aboveIdx] = t;

                const h = tempGrid[idx];
                tempGrid[idx] = 0; // Leaving spot cools down
                tempGrid[aboveIdx] = h;

                moved = true;
                break;
              } else if (aboveType === TYPES.WATER) {
                // Swap
                grid[aboveIdx] = TYPES.STEAM;
                const waterColor = pColorGrid[aboveIdx];
                pColorGrid[aboveIdx] = pColorGrid[idx];

                grid[idx] = TYPES.WATER;
                pColorGrid[idx] = waterColor;

                const t = offsets[idx];
                offsets[idx] = offsets[aboveIdx];
                offsets[aboveIdx] = t;

                // 蒸気は自己発熱しない(冷えて凝結できるように)。上った蒸気はわずかに冷える
                tempGrid[aboveIdx] = Math.max(0, tempGrid[idx] - 1);
                tempGrid[idx] = Math.min(255, tempGrid[idx] + 5);

                moved = true;
                break;
              } else {
                break;
              }
            }
            if (moved) continue;

            const dir = Math.random() > 0.5 ? 1 : -1;
            const sideY = y + riseDirection;
            const aboveSide = sideY * width + (x + dir);
            if (isInsideY(sideY) && x + dir >= 0 && x + dir < width) {
              const aboveSideType = grid[aboveSide];
              if (aboveSideType === TYPES.EMPTY || aboveSideType === TYPES.WATER) {
                if (aboveSideType === TYPES.WATER) {
                  grid[aboveSide] = TYPES.STEAM;
                  const waterColor = pColorGrid[aboveSide];
                  pColorGrid[aboveSide] = pColorGrid[idx];

                  grid[idx] = TYPES.WATER;
                  pColorGrid[idx] = waterColor;

                  const t = offsets[idx];
                  offsets[idx] = offsets[aboveSide];
                  offsets[aboveSide] = t;
                } else {
                  grid[aboveSide] = type;
                  pColorGrid[aboveSide] = pColorGrid[idx];
                  grid[idx] = TYPES.EMPTY;
                  pColorGrid[idx] = hexToUint32(bgColor);

                  // Clear heat from old spot
                  tempGrid[aboveSide] = tempGrid[idx];
                  tempGrid[idx] = 0;

                  const t = offsets[idx];
                  offsets[idx] = offsets[aboveSide];
                  offsets[aboveSide] = t;
                }
                continue;
              }
            }
          }

          const targetY = y + riseDirection;
          const aboveIdx = targetY * width + x;
          if (isInsideY(targetY) && grid[aboveIdx] === TYPES.EMPTY) {
            grid[aboveIdx] = type;
            pColorGrid[aboveIdx] = pColorGrid[idx];
            grid[idx] = TYPES.EMPTY;
            pColorGrid[idx] = hexToUint32(bgColor);
            const t = offsets[idx];
            offsets[idx] = offsets[aboveIdx];
            offsets[aboveIdx] = t;
            const h = tempGrid[idx];
            tempGrid[idx] = tempGrid[aboveIdx];
            tempGrid[aboveIdx] = h;
          } else if (isInsideY(targetY)) {
            const dir = Math.random() > 0.5 ? 1 : -1;
            const aboveSide = targetY * width + (x + dir);
            if (x + dir >= 0 && x + dir < width && grid[aboveSide] === TYPES.EMPTY) {
              grid[aboveSide] = type;
              pColorGrid[aboveSide] = pColorGrid[idx];
              grid[idx] = TYPES.EMPTY;
              pColorGrid[idx] = hexToUint32(bgColor);
              const t = offsets[idx];
              offsets[idx] = offsets[aboveSide];
              offsets[aboveSide] = t;
            }
          }
        }
      }
    };

    const updateEntities = () => {
      if (!gridRef.current || !temperatureRef.current || !colorOffsetRef.current || !particleColorGridRef.current) return;
      const grid = gridRef.current;
      const pColorGrid = particleColorGridRef.current;
      const offsets = colorOffsetRef.current;
      const tempGrid = temperatureRef.current;
      const width = gridWidthRef.current;
      const height = gridHeightRef.current;

      const entities = entitiesRef.current;
      const gravityDirection = calculateGravityDirection(gravity);
      const gravityAcceleration = ENTITY_GRAVITY_ACCELERATION * gravity;
      const consumedEntityIds = new Set<number>();

      const findEntityCollision = (sourceId: number, x: number, y: number, w: number, h: number): Entity | null => {
        for (const other of entities) {
          if (other.id === sourceId) continue;
          if (consumedEntityIds.has(other.id)) continue;

          const otherShape = findEntityShape(other.type);
          if (!otherShape) continue;

          const otherW = calculateEntityWidth(otherShape, other.scale);
          const otherH = calculateEntityHeight(otherShape, other.scale);
          if (hasBoundsOverlap(x, y, w, h, other.x, other.y, otherW, otherH)) {
            return other;
          }
        }

        return null;
      };

      const findNearestFood = (centerX: number, centerY: number, range: number): { x: number; y: number } | null => {
        let bestX = 0;
        let bestY = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let dy = -range; dy <= range; dy++) {
          const sy = centerY + dy;
          if (sy < 0 || sy >= height) continue;

          for (let dx = -range; dx <= range; dx++) {
            const sx = centerX + dx;
            if (sx < 0 || sx >= width) continue;

            if (grid[sy * width + sx] !== TYPES.FOOD) continue;

            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
              bestDistance = distance;
              bestX = sx;
              bestY = sy;
            }
          }
        }

        if (!Number.isFinite(bestDistance)) return null;
        return { x: bestX, y: bestY };
      };

      const findNearestParticle = (centerX: number, centerY: number, targetType: ParticleType, range: number): { x: number; y: number } | null => {
        let bestX = 0;
        let bestY = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let dy = -range; dy <= range; dy++) {
          const sy = centerY + dy;
          if (sy < 0 || sy >= height) continue;

          for (let dx = -range; dx <= range; dx++) {
            const sx = centerX + dx;
            if (sx < 0 || sx >= width) continue;
            if (grid[sy * width + sx] !== targetType) continue;

            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
              bestDistance = distance;
              bestX = sx;
              bestY = sy;
            }
          }
        }

        if (!Number.isFinite(bestDistance)) return null;
        return { x: bestX, y: bestY };
      };

      const findNearestEntity = (source: Entity, targetType: ParticleType, range: number): Entity | null => {
        const sourceShape = findEntityShape(source.type);
        if (!sourceShape) return null;

        const sourceW = calculateEntityWidth(sourceShape, source.scale);
        const sourceH = calculateEntityHeight(sourceShape, source.scale);
        const sourceX = source.x + sourceW / 2;
        const sourceY = source.y + sourceH / 2;
        let nearest: Entity | null = null;
        let bestDistance = range * range;

        for (const other of entities) {
          if (other.id === source.id || other.type !== targetType) continue;
          if (consumedEntityIds.has(other.id)) continue;

          const otherShape = findEntityShape(other.type);
          if (!otherShape) continue;

          const otherW = calculateEntityWidth(otherShape, other.scale);
          const otherH = calculateEntityHeight(otherShape, other.scale);
          const dx = other.x + otherW / 2 - sourceX;
          const dy = other.y + otherH / 2 - sourceY;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            nearest = other;
          }
        }

        return nearest;
      };

      const hasNearbyEntity = (source: Entity, targetType: ParticleType, reach: number): boolean => {
        const sourceShape = findEntityShape(source.type);
        if (!sourceShape) return false;

        const sourceW = calculateEntityWidth(sourceShape, source.scale);
        const sourceH = calculateEntityHeight(sourceShape, source.scale);
        const sourceX = source.x - reach;
        const sourceY = source.y - reach;
        const sourceReachW = sourceW + reach * 2;
        const sourceReachH = sourceH + reach * 2;

        for (const other of entities) {
          if (other.id === source.id || other.type !== targetType) continue;
          if (consumedEntityIds.has(other.id)) continue;

          const otherShape = findEntityShape(other.type);
          if (!otherShape) continue;

          const otherW = calculateEntityWidth(otherShape, other.scale);
          const otherH = calculateEntityHeight(otherShape, other.scale);
          if (hasBoundsOverlap(sourceX, sourceY, sourceReachW, sourceReachH, other.x, other.y, otherW, otherH)) {
            return true;
          }
        }

        return false;
      };

      const consumeNearbyEntity = (source: Entity, targetType: ParticleType, reach: number): boolean => {
        const sourceShape = findEntityShape(source.type);
        if (!sourceShape) return false;

        const sourceW = calculateEntityWidth(sourceShape, source.scale);
        const sourceH = calculateEntityHeight(sourceShape, source.scale);
        const sourceX = source.x - reach;
        const sourceY = source.y - reach;
        const sourceReachW = sourceW + reach * 2;
        const sourceReachH = sourceH + reach * 2;

        for (const other of entities) {
          if (other.id === source.id || other.type !== targetType) continue;
          if (consumedEntityIds.has(other.id)) continue;

          const otherShape = findEntityShape(other.type);
          if (!otherShape) continue;

          const otherW = calculateEntityWidth(otherShape, other.scale);
          const otherH = calculateEntityHeight(otherShape, other.scale);
          if (hasBoundsOverlap(sourceX, sourceY, sourceReachW, sourceReachH, other.x, other.y, otherW, otherH)) {
            consumedEntityIds.add(other.id);
            return true;
          }
        }

        return false;
      };

      const getCell = (x: number, y: number): ParticleType | null => {
        if (x < 0 || x >= width || y < 0 || y >= height) return null;
        const particleType = grid[y * width + x];
        return isParticleType(particleType) ? particleType : null;
      };

      // 進行方向の壁が「登れる段差」かを判定する(階段を登れない・引っかかる問題への対応)。
      // ブラシで描いた壁は足元より少し上から始まることがあるため、足元の1セルだけでなく
      // 前方カラムの登坂可能帯(footY〜maxClimbセル上)全体を走査して一番高い固体を探す。
      // その1つ上が空いていれば段差の高さを返し、登れない高い壁なら null を返す。
      const measureClimbableStepHeight = (frontX: number, footY: number, gravityDirection: -1 | 1, maxClimb: number): number | null => {
        let highestSolidOffset = -1;
        for (let k = 0; k <= maxClimb; k++) {
          const checkY = footY - gravityDirection * k;
          if (checkY < 0 || checkY >= height) break;
          if (isSolid(frontX, checkY)) highestSolidOffset = k;
        }
        if (highestSolidOffset === -1) return null; // 前方に壁が無い
        if (highestSolidOffset >= maxClimb) return null; // 登れない高さの壁
        const clearY = footY - gravityDirection * (highestSolidOffset + 1);
        if (clearY < 0 || clearY >= height) return null;
        if (isSolid(frontX, clearY)) return null; // 段差の上も塞がっている
        return highestSolidOffset + 1;
      };

      const eatNearbyFood = (entity: Entity, w: number, h: number) => {
        const startX = Math.max(0, Math.floor(entity.x) - 2);
        const endX = Math.min(width - 1, Math.floor(entity.x + w) + 2);
        const startY = Math.max(0, Math.floor(entity.y) - 2);
        const endY = Math.min(height - 1, Math.floor(entity.y + h) + 2);
        const maxFoodCells = Math.max(8, Math.ceil((w * h) / 18));
        let eatenCount = 0;

        for (let y = startY; y <= endY; y++) {
          for (let x = startX; x <= endX; x++) {
            const idx = y * width + x;
            if (grid[idx] !== TYPES.FOOD) continue;

            grid[idx] = TYPES.EMPTY;
            pColorGrid[idx] = hexToUint32(bgColor);
            offsets[idx] = 0;
            tempGrid[idx] = ambientByRowRef.current?.[y] ?? AMBIENT_TEMP;
            eatenCount++;
            if (eatenCount >= maxFoodCells) {
              entity.hunger = DEFAULT_ENTITY_HUNGER;
              return;
            }
          }
        }

        if (eatenCount > 0) {
          entity.hunger = DEFAULT_ENTITY_HUNGER;
        }
      };

      // const dropHumanGrave = (entity: Entity, entityWidth: number, entityHeight: number) => {
      //   const graveScale = Math.max(2, entity.scale);
      //   const graveShape = findEntityShape(TYPES.GRAVE);
      //   if (!graveShape) return;
      //   const graveWidth = calculateEntityWidth(graveShape, graveScale);
      //   const graveHeight = calculateEntityHeight(graveShape, graveScale);
      //   entities.push({
      //     id: nextEntityId.current++,
      //     type: TYPES.GRAVE,
      //     x: entity.x + entityWidth / 2 - graveWidth / 2,
      //     y: entity.y + entityHeight / 2 - graveHeight / 2,
      //     dir: 1,
      //     vx: 0,
      //     vy: 0,
      //     color: DEFAULT_COLORS[TYPES.GRAVE],
      //     scale: graveScale,
      //     hunger: DEFAULT_ENTITY_HUNGER,
      //   });
      // };

      for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        if (consumedEntityIds.has(e.id)) {
          entities.splice(i, 1);
          continue;
        }

        const shape = findEntityShape(e.type);
        if (!shape) continue;
        if (!Number.isFinite(e.hunger)) e.hunger = DEFAULT_ENTITY_HUNGER;

        const definition = getCreatureDefinition(e.type);
        const scale = e.scale;
        const w = calculateEntityWidth(shape, scale);
        const h = calculateEntityHeight(shape, scale);

        let onGround = false;
        let inWater = false;
        let touchFire = false;

        // Unstuck / Burial Check
        const centerX = Math.floor(e.x + w / 2);
        const centerY = Math.floor(e.y + h / 2);
        if (isSolid(centerX, centerY)) {
          e.y -= gravityDirection;
          e.vx = 0;
          e.vy = 0;
        }

        let waterCount = 0;
        let totalChecks = 0;

        for (let cy = Math.floor(e.y); cy < e.y + h; cy++) {
          for (let cxx = Math.floor(e.x); cxx < e.x + w; cxx++) {
            if (cxx >= 0 && cxx < width && cy >= 0 && cy < height) {
              const cell = grid[cy * width + cxx];
              if (cell === TYPES.WATER) waterCount++;
              if (cell === TYPES.FIRE || cell === TYPES.MAGMA || cell === TYPES.LIGHTNING) touchFire = true;
              totalChecks++;
            }
          }
        }
        const waterRatio = totalChecks > 0 ? waterCount / totalChecks : 0;
        inWater = waterRatio > 0.1;

        // Physics (Gravity/Buoyancy)
        const isAgainstBoundary = gravityDirection > 0 ? e.y + h >= height : e.y <= 0;
        // 画面端(床)に立っている時も、跳び上がり中(重力と逆向きの速度)は vy を 0 に
        // 戻さない。無条件に戻すと床の上では段差ジャンプや逃走ジャンプが毎フレーム
        // 打ち消されて、壁の前で固まってしまう。
        const isJumpingOffBoundary = e.vy * gravityDirection < 0;
        if (isAgainstBoundary && !isJumpingOffBoundary) {
          onGround = true;
          e.y = gravityDirection > 0 ? height - h : 0;
          e.vy = 0;
        } else {
          const supportY = gravityDirection > 0 ? Math.floor(e.y + h) : Math.floor(e.y - 1);
          const groundBlockedByTerrain = isSolid(Math.floor(e.x), supportY) || isSolid(Math.floor(e.x + w - 1), supportY);
          const groundBlockedByEntity = findEntityCollision(e.id, e.x, e.y + gravityDirection, w, h);
          const isMovingAwayFromGround = e.vy * gravityDirection < 0;

          if (!isMovingAwayFromGround && (groundBlockedByTerrain || groundBlockedByEntity)) {
            onGround = true;
            e.vy = 0;
            if (groundBlockedByEntity) {
              const groundShape = findEntityShape(groundBlockedByEntity.type);
              if (groundShape) {
                const groundH = calculateEntityHeight(groundShape, groundBlockedByEntity.scale);
                e.y = gravityDirection > 0 ? groundBlockedByEntity.y - h : groundBlockedByEntity.y + groundH;
              }
            } else {
              e.y = Math.floor(e.y);
            }
          } else if (inWater) {
            const gravityProfile = definition?.gravityProfile ?? "land";
            if (gravityProfile === "human") {
              e.vy -= 0.03 * gravityDirection;
              e.vy = Math.max(-0.5, Math.min(0.5, e.vy));
            } else if (gravityProfile === "swimmer") {
              e.vy *= 0.95;
              e.vy = Math.max(-0.7, Math.min(0.7, e.vy));
            } else if (gravityProfile === "flyer") {
              e.vy += gravityAcceleration * 0.08;
            } else if (gravityProfile === "amphibian") {
              e.vy += gravityAcceleration * 0.18;
              // 沈降は従来通り0.8まで、水面への跳び出しは2.2まで許可(池からの自力脱出用)
              e.vy = clampSwimVelocity(e.vy, gravityDirection, 0.8, 2.2);
            } else if (gravityProfile === "heavySwimmer") {
              e.vy += gravityAcceleration * 0.2;
              // 白クマも同様に、上向きだけ岸へ上がるジャンプ速度を許可する
              e.vy = clampSwimVelocity(e.vy, gravityDirection, 1, 2);
            } else {
              e.vy += gravityAcceleration * 0.5;
            }
          } else if (definition?.gravityProfile === "flyer") {
            e.vy += gravityAcceleration * 0.08;
          } else {
            e.vy += gravityAcceleration;
          }
        }

        e.vy = clampEntityGravityVelocity(e.vy, gravity);

        // --- Continuous Collision Detection (CCD) for Y ---
        if (e.vy !== 0) {
          const steps = Math.ceil(Math.abs(e.vy));
          const stepSize = e.vy / steps;

          for (let s = 0; s < steps; s++) {
            const nextY = e.y + stepSize;
            let collision = false;
            let collisionEntity: Entity | null = null;

            const checkY = stepSize > 0 ? Math.floor(nextY + h - 0.01) : Math.floor(nextY);
            const startX = Math.floor(e.x);
            const endX = Math.floor(e.x + w - 0.01);
            for (let px = startX; px <= endX; px++) {
              if (isSolid(px, checkY)) {
                collision = true;
                break;
              }
            }

            if (!collision) {
              collisionEntity = findEntityCollision(e.id, e.x, nextY, w, h);
              collision = collisionEntity !== null;
            }

            if (collision) {
              e.vy = 0;
              if (collisionEntity) {
                const otherShape = findEntityShape(collisionEntity.type);
                if (otherShape) {
                  const otherH = calculateEntityHeight(otherShape, collisionEntity.scale);
                  e.y = stepSize > 0 ? collisionEntity.y - h : collisionEntity.y + otherH;
                }
              } else if (stepSize > 0) {
                e.y = Math.floor(nextY + h) - h;
              } else {
                e.y = Math.floor(nextY) + 1;
              }
              break;
            } else {
              e.y = nextY;
            }
          }
        }

        // --- Continuous Collision Detection (CCD) for X ---
        let blockedX = false;
        if (e.vx !== 0) {
          const steps = Math.ceil(Math.abs(e.vx));
          const stepSize = e.vx / steps;

          for (let s = 0; s < steps; s++) {
            const nextX = e.x + stepSize;
            let collision = false;
            let collisionEntity: Entity | null = null;

            const checkX = stepSize > 0 ? Math.floor(nextX + w - 0.01) : Math.floor(nextX);
            const startY = Math.floor(e.y);
            const endY = Math.floor(e.y + h - 0.01);
            for (let py = startY; py <= endY; py++) {
              if (isSolid(checkX, py)) {
                collision = true;
                break;
              }
            }

            if (!collision) {
              collisionEntity = findEntityCollision(e.id, nextX, e.y, w, h);
              collision = collisionEntity !== null;
            }

            if (collision) {
              blockedX = true;
              e.vx = 0;
              // 段差ジャンプの上昇中の歩行生物は向きを保つ。ここで反転すると、
              // 壁面に触れるたびに登りかけの段差から引き返してしまう(階段が登れない原因)。
              const isRisingClimb = definition?.canDefaultWalk === true && e.vy * gravityDirection < -0.01;
              if (!isRisingClimb) {
                e.dir *= -1; // Bounce
              }
              if (collisionEntity) {
                const otherShape = findEntityShape(collisionEntity.type);
                if (otherShape) {
                  const otherW = calculateEntityWidth(otherShape, collisionEntity.scale);
                  e.x = stepSize > 0 ? collisionEntity.x - w : collisionEntity.x + otherW;
                }
              } else if (stepSize > 0) {
                e.x = Math.floor(nextX + w) - w;
              } else {
                e.x = Math.floor(nextX) + 1;
              }
              break;
            } else {
              e.x = nextX;
            }
          }
        }

        // AI Movement & Danger Avoidance
        let panicVx = 0;
        const scanRange = 10;
        const scanCenterX = Math.floor(e.x + w / 2);
        const scanCenterY = Math.floor(e.y + h / 2);
        for (let dy = -scanRange; dy <= scanRange; dy++) {
          for (let dx = -scanRange; dx <= scanRange; dx++) {
            const sx = scanCenterX + dx;
            const sy = scanCenterY + dy;
            if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
              if (grid[sy * width + sx] === TYPES.FIRE || grid[sy * width + sx] === TYPES.MAGMA) {
                panicVx -= Math.sign(dx);
              }
            }
          }
        }
        if (panicVx !== 0) {
          e.vx = (panicVx > 0 ? 1 : -1) * 0.3;
        }

        const behaviorContext: EntityBehaviorContext = {
          width,
          height,
          findNearestFood,
          findNearestParticle,
          findNearestEntity,
          hasNearbyEntity,
          consumeNearbyEntity,
          eatNearbyFood,
          getCell,
        };
        const behaviorState: EntityBehaviorState = {
          w,
          h,
          centerX,
          centerY,
          onGround,
          inWater,
          blockedX,
          panicVx,
          touchFire,
          waterRatio,
          gravityDirection,
        };
        const behaviorResult = definition?.updateBehavior(e, behaviorState, behaviorContext) ?? {
          dead: false,
          skipDefaultWalk: true,
        };
        const waterDeathChance = definition?.waterDeathChance ?? 0;
        const fireDeathChance = definition?.fireDeathChance ?? 0.1;
        let dead = behaviorResult.dead;

        if (waterDeathChance > 0 && inWater && Math.random() < waterDeathChance) {
          dead = true;
        }

        if (touchFire && Math.random() < fireDeathChance) {
          dead = true;
        }

        if (dead) {
          entities.splice(i, 1);

          // if (e.type === TYPES.HUMAN) {
          //   dropHumanGrave(e, w, h);
          //   continue;
          // }

          const startY = Math.floor(e.y);
          const startX = Math.floor(e.x);

          for (let sy = 0; sy < h; sy++) {
            for (let sx = 0; sx < w; sx++) {
              if (findShapePixel(shape, scale, sx, sy, e.dir)) {
                const gx = startX + sx;
                const gy = startY + sy;
                if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
                  const gIdx = gy * width + gx;
                  if (grid[gIdx] === TYPES.EMPTY || grid[gIdx] === TYPES.WATER) {
                    grid[gIdx] = TYPES.SAND;
                    // 死骸は骨色の砂として残し、通常の砂と見分けられるようにする
                    pColorGrid[gIdx] = hexToUint32(CORPSE_SAND_COLOR);
                    offsets[gIdx] = Math.floor(Math.random() * VARIATION * 2) - VARIATION;
                  }
                }
              }
            }
          }
        } else if (definition?.canDefaultWalk && !behaviorResult.skipDefaultWalk && panicVx === 0) {
          if (onGround) {
            if (Math.random() < 0.01) e.dir *= -1;
            e.vx = e.dir * definition.walkSpeed;

            // 自分の背丈くらいまでの段差はジャンプで登れる(それより高い壁は登れず反転)
            const maxClimb = Math.max(4, Math.round(h * 1.1));
            // 段差の高さに応じたジャンプ初速。ちょうど届く高さ+余裕1セル分を逆算する。
            const jumpForStep = (stepHeight: number) => {
              // 1.35倍の余裕: 壁のふちに横から当たる前に頂上へ抜けられる高さを確保する
              const climbJumpSpeed = Math.sqrt(2 * Math.max(0.02, Math.abs(gravityAcceleration)) * (stepHeight + 1)) * 1.35 + 0.3;
              e.vy = -gravityDirection * climbJumpSpeed;
              // 空中で減速して段差の上に届かないことがないよう、前進速度も少し上げる
              e.vx = e.dir * Math.max(Math.abs(e.vx), definition.walkSpeed * 1.6);
            };

            const lookAhead = Math.floor(e.x + (e.dir === 1 ? w : 0) + e.dir * 2);
            const footY = gravityDirection > 0 ? Math.floor(e.y + h - 1) : Math.floor(e.y);
            const supportY = footY + gravityDirection;
            if (lookAhead >= 0 && lookAhead < width && footY >= 0 && footY < height) {
              const nextTile = grid[footY * width + lookAhead];
              const hasEntitySupport = findEntityCollision(e.id, e.x + e.dir * 2, e.y + gravityDirection, w, h) !== null;
              if (
                (definition.avoidWater && nextTile === TYPES.WATER) ||
                nextTile === TYPES.FIRE ||
                nextTile === TYPES.MAGMA ||
                (!isSolid(lookAhead, supportY) && !hasEntitySupport)
              ) {
                e.dir *= -1;
                e.vx *= -1;
              } else {
                // 2セル先の壁が低い段差なら、接触する前にジャンプして越える(階段対応)
                const stepHeight = measureClimbableStepHeight(lookAhead, footY, gravityDirection, maxClimb);
                if (stepHeight !== null) {
                  jumpForStep(stepHeight);
                }
              }
            }

            // CCDの衝突で反転させられた直後なら、元の進行方向の壁を調べて、
            // 登れる段差だったら向きを戻してジャンプする(壁のたびに引き返す挙動の防止)。
            if (blockedX) {
              const originalDir = e.dir === 1 ? -1 : 1;
              const wallX = Math.floor(e.x + (originalDir === 1 ? w + 1 : -2));
              if (wallX >= 0 && wallX < width) {
                const stepHeight = measureClimbableStepHeight(wallX, footY, gravityDirection, maxClimb);
                if (stepHeight !== null) {
                  e.dir = originalDir;
                  jumpForStep(stepHeight);
                }
              }
            }

            const footX = Math.floor(e.x + (e.dir === 1 ? w : 0));
            if (isSolid(footX, footY)) {
              // 密着した壁も同様に、登れる高さならジャンプ、登れなければ従来通り反転
              const stepHeight = measureClimbableStepHeight(footX, footY, gravityDirection, maxClimb);
              if (stepHeight !== null) {
                jumpForStep(stepHeight);
              } else {
                e.dir *= -1;
                e.vx *= -1;
              }
            }
          } else if (e.vy * gravityDirection < -0.01) {
            // 段差ジャンプの上昇中は前進力を保ち、壁のふちを越えて段の上へ着地できるようにする
            e.vx = e.dir * definition.walkSpeed * 1.6;
          } else {
            e.vx *= 0.95;
          }
        }
      }

      if (consumedEntityIds.size > 0) {
        entitiesRef.current = entities.filter((entity) => !consumedEntityIds.has(entity.id));
      }
    };

    const createFireworkBurst = (shell: FireworkShell): FireworkSpark[] => {
      const isLargeBurst = Math.random() < FIREWORK_LARGE_BURST_CHANCE;
      const rayBonus = isLargeBurst ? FIREWORK_LARGE_RAY_BONUS : 0;
      const rays =
        FIREWORK_MIN_RAYS +
        rayBonus +
        Math.floor(Math.random() * (FIREWORK_MAX_RAYS - FIREWORK_MIN_RAYS + 1));
      const minRadius = isLargeBurst ? FIREWORK_LARGE_MIN_RADIUS : FIREWORK_MIN_RADIUS;
      const maxRadius = isLargeBurst ? FIREWORK_LARGE_MAX_RADIUS : FIREWORK_MAX_RADIUS;
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      const baseSpeed = radius * FIREWORK_SPARK_SPEED_PER_RADIUS;
      const goldColorUint32 = hexToUint32(FIREWORK_TRAIL_COLOR);
      const burstSparks: FireworkSpark[] = [];

      for (let ray = 0; ray < rays; ray++) {
        // ほぼ均等な放射へ小さな揺らぎを加え、菊型の輪郭を保ちながら機械的な見た目を避ける。
        const angle = (Math.PI * 2 * ray) / rays + (Math.random() - 0.5) * 0.08;
        const directionX = Math.cos(angle);
        const directionY = Math.sin(angle);

        for (let sparkIndex = 0; sparkIndex < FIREWORK_SPARKS_PER_RAY; sparkIndex++) {
          const depthRatio = (sparkIndex + 1) / FIREWORK_SPARKS_PER_RAY;
          const speedRatio = 0.12 + depthRatio * 0.88;
          const speed = baseSpeed * speedRatio * (0.9 + Math.random() * 0.2);
          const startOffset = 1 + sparkIndex * 0.35;
          // 外周の一部を金色にして、単色の輪より奥行きのある光へ見せる。
          const isGoldTip = sparkIndex === FIREWORK_SPARKS_PER_RAY - 1 && Math.random() < 0.18;
          const colorUint32 = isGoldTip ? goldColorUint32 : shell.colorUint32;

          burstSparks.push({
            x: shell.x + directionX * startOffset,
            y: shell.y + directionY * startOffset,
            vx: directionX * speed,
            vy: directionY * speed,
            age: 0,
            lifetime:
              FIREWORK_SPARK_MIN_LIFETIME +
              Math.random() * (FIREWORK_SPARK_MAX_LIFETIME - FIREWORK_SPARK_MIN_LIFETIME),
            colorUint32,
            twinklePhase: Math.random() * Math.PI * 2,
          });
        }
      }

      const coreSparkCount = Math.ceil(rays * FIREWORK_CORE_SPARK_RATIO);
      for (let coreIndex = 0; coreIndex < coreSparkCount; coreIndex++) {
        // 低速・短寿命の火花を中心へ散らし、外周の菊型を崩さず内側の空間だけを埋める。
        const angle = Math.random() * Math.PI * 2;
        const directionX = Math.cos(angle);
        const directionY = Math.sin(angle);
        const speed = baseSpeed * (0.08 + Math.random() * 0.32);
        const isGoldCore = Math.random() < 0.28;

        burstSparks.push({
          x: shell.x + directionX * 0.45,
          y: shell.y + directionY * 0.45,
          vx: directionX * speed,
          vy: directionY * speed,
          age: 0,
          lifetime: FIREWORK_SPARK_MIN_LIFETIME * (0.55 + Math.random() * 0.3),
          colorUint32: isGoldCore ? goldColorUint32 : shell.colorUint32,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }

      return burstSparks;
    };

    // 花火弾と火花の更新。上昇→開花→空気抵抗と重力で垂れる残光→一部を色砂として残す。
    const updateFireworks = () => {
      const shells = fireworksRef.current;
      const sparks = fireworkSparksRef.current;
      if (shells.length === 0 && sparks.length === 0) return;
      const grid = gridRef.current;
      const pColorGrid = particleColorGridRef.current;
      const offsets = colorOffsetRef.current;
      const tempGrid = temperatureRef.current;
      if (!grid || !pColorGrid || !offsets || !tempGrid) return;
      const width = gridWidthRef.current;
      const height = gridHeightRef.current;
      // 花火の垂れ方も重力スライダーへ追従させ、無重力や逆重力の世界観を壊さない。
      const sparkGravity = FIREWORK_SPARK_GRAVITY * gravity;

      const spawnEmber = (x: number, y: number, colorUint32: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const idx = y * width + x;
        // 既存の絵(砂や生き物の巣)は上書きしない。空セルにだけ火の粉を置く
        if (grid[idx] !== TYPES.EMPTY) return;
        grid[idx] = TYPES.EMBER;
        pColorGrid[idx] = colorUint32;
        offsets[idx] = randomOffset();
        // 火の粉から植物が燃えたり雪が溶けたりしないよう、温度は平常のままにする
        tempGrid[idx] = AMBIENT_TEMP;
      };

      const sparkSurvivors: FireworkSpark[] = [];
      for (const spark of sparks) {
        spark.age += 1;
        spark.vx *= FIREWORK_SPARK_DRAG;
        spark.vy = spark.vy * FIREWORK_SPARK_DRAG + sparkGravity;
        spark.x += spark.vx;
        spark.y += spark.vy;

        const isSparkAlive = spark.age < spark.lifetime;
        const isSparkInsideX =
          spark.x >= -FIREWORK_SPARK_BOUNDARY_MARGIN && spark.x < width + FIREWORK_SPARK_BOUNDARY_MARGIN;
        const isSparkInsideY =
          spark.y >= -FIREWORK_SPARK_BOUNDARY_MARGIN && spark.y < height + FIREWORK_SPARK_BOUNDARY_MARGIN;
        if (isSparkAlive && isSparkInsideX && isSparkInsideY) {
          sparkSurvivors.push(spark);
          continue;
        }

        if (!isSparkAlive && Math.random() < FIREWORK_SPARK_SETTLE_CHANCE) {
          // 消え際の一部だけをグリッドへ渡し、余韻が色砂として作品に残る既存仕様を維持する。
          spawnEmber(Math.round(spark.x), Math.round(spark.y), spark.colorUint32);
        }
      }

      const shellSurvivors: FireworkShell[] = [];
      for (const shell of shells) {
        // 尾: 通過位置に金色の火の粉を残す(打ち上げの軌跡)
        if (Math.random() < FIREWORK_TRAIL_CHANCE) {
          spawnEmber(Math.round(shell.x), Math.round(shell.y), hexToUint32(FIREWORK_TRAIL_COLOR));
        }
        shell.wigglePhase += 0.35;
        shell.x += Math.sin(shell.wigglePhase) * 0.4;
        shell.y -= FIREWORK_RISE_SPEED;

        if (shell.y > shell.targetY && shell.y > 2) {
          shellSurvivors.push(shell);
          continue;
        }
        // 開花: 放射線ごとに速度差のある火花を生成し、連続座標で広い菊型へ育てる。
        sparkSurvivors.push(...createFireworkBurst(shell));
      }

      const sparkOverflow = Math.max(0, sparkSurvivors.length - FIREWORK_MAX_ACTIVE_SPARKS);
      // 上限超過時は新しい火花を優先し、連続打ち上げ中のフレーム落ちを抑える。
      fireworkSparksRef.current = sparkOverflow > 0 ? sparkSurvivors.slice(sparkOverflow) : sparkSurvivors;
      fireworksRef.current = shellSurvivors;
    };

    const draw = () => {
      if (!gridRef.current || !colorOffsetRef.current || !particleColorGridRef.current || !temperatureRef.current) return;
      const grid = gridRef.current;
      const pColorGrid = particleColorGridRef.current;
      const offsets = colorOffsetRef.current;
      const tempGrid = temperatureRef.current;
      const width = gridWidthRef.current;
      const height = gridHeightRef.current;

      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      const hexCache = new Map<number, [number, number, number]>(); // Use Uint32 as key
      const getRgbFromUint32 = (uint32: number) => {
        const cachedRgb = hexCache.get(uint32);
        if (cachedRgb) return cachedRgb;
        const rgb = uint32ToRgb(uint32);
        hexCache.set(uint32, rgb);
        return rgb;
      };

      const drawFrogTongue = (entity: Entity, entityWidth: number, entityHeight: number) => {
        const tongueTargetX = entity.tongueTargetX;
        const tongueTargetY = entity.tongueTargetY;
        if (typeof tongueTargetX !== "number" || typeof tongueTargetY !== "number") return;
        if (!Number.isFinite(tongueTargetX) || !Number.isFinite(tongueTargetY)) return;

        // カエルの捕食が分かるように、体の前方から獲物へ伸びる舌を描く。
        const tongueOriginX = entity.x + (entity.dir > 0 ? entityWidth - entity.scale : entity.scale) + 0.5;
        const tongueOriginY = entity.y + entityHeight * 0.45 + 0.5;
        ctx.save();
        ctx.strokeStyle = "#fb7185";
        ctx.lineWidth = Math.max(1, entity.scale);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tongueOriginX, tongueOriginY);
        ctx.lineTo(tongueTargetX + 0.5, tongueTargetY + 0.5);
        ctx.stroke();
        ctx.restore();
      };

      const bgUint32 = hexToUint32(bgColor);
      const bgRgb = getRgbFromUint32(bgUint32);
      const backgroundPixels = backgroundImagePixelsRef.current;

      // 空(時間帯)の背景。サイズが変わった時(skyPixelsの長さが合わない時)だけ作り直す。
      const skyMode = skyModeRef.current;
      let skyPixels = skyPixelsRef.current;
      if (skyMode !== "off" && (!skyPixels || skyPixels.length !== width * height * 4)) {
        skyPixelsRef.current = buildSkyPixels(width, height, skyMode);
        skyPixels = skyPixelsRef.current;
      }

      // 水の波の位相。描画フレームごとに進めて、水面を横に流れる明暗を作る。
      renderFrameRef.current += 1;
      const wavePhase = renderFrameRef.current * WATER_WAVE_SPEED;

      const paintPixel = (pixelIndex: number, red: number, green: number, blue: number, temperature: number) => {
        const dataIndex = pixelIndex * 4;
        if (temperatureViewMode === "temperature") {
          const tintStrength = calculateTemperatureTintStrength(temperature);
          if (tintStrength < 0) {
            const strength = Math.abs(tintStrength);
            data[dataIndex] = blendColorChannel(red, 37, strength);
            data[dataIndex + 1] = blendColorChannel(green, 99, strength);
            data[dataIndex + 2] = blendColorChannel(blue, 235, strength);
            data[dataIndex + 3] = 255;
            return;
          }
          if (tintStrength > 0) {
            const tintRed = temperature > IGNITE_TEMP ? 239 : 249;
            const tintGreen = temperature > IGNITE_TEMP ? 68 : 115;
            const tintBlue = temperature > IGNITE_TEMP ? 68 : 22;
            data[dataIndex] = blendColorChannel(red, tintRed, tintStrength);
            data[dataIndex + 1] = blendColorChannel(green, tintGreen, tintStrength);
            data[dataIndex + 2] = blendColorChannel(blue, tintBlue, tintStrength);
            data[dataIndex + 3] = 255;
            return;
          }
        }
        data[dataIndex] = red;
        data[dataIndex + 1] = green;
        data[dataIndex + 2] = blue;
        data[dataIndex + 3] = 255;
      };

      // Draw grid particles using their stored color
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === TYPES.EMPTY) {
          // 空セルの背景。優先順位: ユーザー背景画像 > 空(時間帯) > 単色背景。
          if (backgroundPixels) {
            paintPixel(i, backgroundPixels[i * 4], backgroundPixels[i * 4 + 1], backgroundPixels[i * 4 + 2], tempGrid[i]);
          } else if (skyPixels) {
            paintPixel(i, skyPixels[i * 4], skyPixels[i * 4 + 1], skyPixels[i * 4 + 2], tempGrid[i]);
          } else {
            paintPixel(i, bgRgb[0], bgRgb[1], bgRgb[2], tempGrid[i]);
          }
        } else {
          const particleColorUint32 = pColorGrid[i];
          const rgb = getRgbFromUint32(particleColorUint32);
          const offset = offsets[i];

          // マグマは冷えるほど暗くなる(灼熱オレンジ→暗赤)。温度を見た目で表現する。
          if (grid[i] === TYPES.MAGMA) {
            const f = 0.35 + 0.65 * calculateMagmaHeatFactor(tempGrid[i]);
            paintPixel(
              i,
              Math.max(0, Math.min(255, rgb[0] * f + offset)),
              Math.max(0, Math.min(255, rgb[1] * f + offset)),
              Math.max(0, Math.min(255, rgb[2] * f + offset)),
              tempGrid[i],
            );
          } else if (grid[i] === TYPES.WATER) {
            // 水面(直上が空/蒸気/雲)のセルだけ、横に流れる正弦波の明暗をのせて波打たせる。
            // シミュレーションは変えず、見た目だけの波。青を少し強めて水面の照り返しに見せる。
            const cy = (i / width) | 0;
            const cx = i - cy * width;
            const aboveType = cy > 0 ? grid[i - width] : TYPES.EMPTY;
            const isSurface = aboveType === TYPES.EMPTY || aboveType === TYPES.STEAM || isCloudType(aboveType);
            const waveDelta = isSurface ? Math.sin(cx * WATER_WAVE_FREQ + wavePhase) * WATER_WAVE_AMPLITUDE : 0;
            paintPixel(
              i,
              Math.max(0, Math.min(255, rgb[0] + offset + waveDelta)),
              Math.max(0, Math.min(255, rgb[1] + offset + waveDelta)),
              Math.max(0, Math.min(255, rgb[2] + offset + waveDelta * 1.3)),
              tempGrid[i],
            );
          } else {
            paintPixel(
              i,
              Math.max(0, Math.min(255, rgb[0] + offset)),
              Math.max(0, Math.min(255, rgb[1] + offset)),
              Math.max(0, Math.min(255, rgb[2] + offset)),
              tempGrid[i],
            );
          }
        }
      }

      const entities = entitiesRef.current;
      for (const e of entities) {
        const shape = findEntityShape(e.type);
        if (!shape) continue;

        const rgb = hexToRgb(e.color); // Entities use their own color string
        const scale = e.scale;
        const w = calculateEntityWidth(shape, scale);
        const h = calculateEntityHeight(shape, scale);
        const startX = Math.floor(e.x);
        const startY = Math.floor(e.y);

        for (let sy = 0; sy < h; sy++) {
          for (let sx = 0; sx < w; sx++) {
            if (findShapePixel(shape, scale, sx, sy, e.dir)) {
              const gx = startX + sx;
              const gy = startY + sy;
              if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
                const idx = gy * width + gx;
                paintPixel(idx, rgb[0], rgb[1], rgb[2], tempGrid[idx]);
              }
            }
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      for (const e of entities) {
        if (e.type !== TYPES.FROG || !e.tongueTicks || e.tongueTicks <= 0) continue;

        const shape = findEntityShape(e.type);
        if (!shape) continue;

        const w = calculateEntityWidth(shape, e.scale);
        const h = calculateEntityHeight(shape, e.scale);
        drawFrogTongue(e, w, h);
      }

      // ポインタのカーソル表示(風の範囲リング・向き矢印 / 塗りブラシの輪)。
      // putImageData の上にベクターで重ねる。
      const cursor = cursorRef.current;
      if (cursor && cursor.radius >= 1) {
        const cxp = cursor.x + 0.5;
        const cyp = cursor.y + 0.5;
        ctx.save();
        ctx.lineWidth = 1;
        if (cursor.isWind) {
          // 風は範囲リングを出さない。ドラッグ中だけ向きの矢印を出す。
          const len = Math.hypot(cursor.dx, cursor.dy);
          if (len > 0.5) {
            ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
            const ux = cursor.dx / len;
            const uy = cursor.dy / len;
            const tip = Math.max(6, cursor.radius * 0.9);
            const tx = cxp + ux * tip;
            const ty = cyp + uy * tip;
            ctx.beginPath();
            ctx.moveTo(cxp, cyp);
            ctx.lineTo(tx, ty);
            const head = Math.max(3, cursor.radius * 0.28);
            const a = Math.atan2(uy, ux);
            ctx.lineTo(tx - head * Math.cos(a - 0.5), ty - head * Math.sin(a - 0.5));
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - head * Math.cos(a + 0.5), ty - head * Math.sin(a + 0.5));
            ctx.stroke();
          }
        } else {
          // 塗りブラシはサイズの輪(実線)
          ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
          ctx.beginPath();
          ctx.arc(cxp, cyp, cursor.radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 開花後の火花は加算合成した光跡として描き、速度が落ちても残光がゆっくり垂れるように見せる。
      if (fireworkSparksRef.current.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";

        for (const spark of fireworkSparksRef.current) {
          const lifeProgress = Math.min(1, spark.age / spark.lifetime);
          const remainingLifeRatio = 1 - lifeProgress;
          const fadeAlpha = remainingLifeRatio ** 0.68;
          const isTwinklePhase = lifeProgress > 0.55;
          const twinkle = isTwinklePhase
            ? 0.68 + Math.sin(spark.age * 0.45 + spark.twinklePhase) * 0.32
            : 1;
          const alpha = Math.max(0, fadeAlpha * twinkle);
          if (alpha <= 0.02) continue;

          const sparkRgb = getRgbFromUint32(spark.colorUint32);
          const trailFrames = Math.min(FIREWORK_SPARK_TRAIL_FRAMES, spark.age + 1);
          const trailStartX = spark.x - spark.vx * trailFrames;
          const trailStartY = spark.y - spark.vy * trailFrames;
          // 加算合成と線幅で発光を作り、火花ごとに高負荷なぼかし処理を行わない。
          ctx.beginPath();
          ctx.moveTo(trailStartX, trailStartY);
          ctx.lineTo(spark.x, spark.y);
          // 同じ光跡を淡く太い線と鮮明な細い線で重ね、ぼかしなしでも豊かな残光を作る。
          ctx.strokeStyle = `rgba(${sparkRgb[0]}, ${sparkRgb[1]}, ${sparkRgb[2]}, ${alpha * 0.2})`;
          ctx.lineWidth = 1.8 + remainingLifeRatio * 1.2;
          ctx.stroke();
          ctx.strokeStyle = `rgba(${sparkRgb[0]}, ${sparkRgb[1]}, ${sparkRgb[2]}, ${alpha * 0.9})`;
          ctx.lineWidth = 0.55 + remainingLifeRatio * 0.75;
          ctx.stroke();

          const glowSize = 1.7 + remainingLifeRatio * 1.2;
          ctx.fillStyle = `rgba(${sparkRgb[0]}, ${sparkRgb[1]}, ${sparkRgb[2]}, ${alpha * 0.32})`;
          ctx.fillRect(spark.x - glowSize / 2, spark.y - glowSize / 2, glowSize, glowSize);

          // 小さな白い芯を重ね、暗い空と明るい背景のどちらでも発光点が読めるようにする。
          const coreSize = 0.7 + remainingLifeRatio * 0.6;
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.15)})`;
          // 円弧より軽い小さな矩形にし、同時に複数発を上げたときの描画負荷を抑える。
          ctx.fillRect(spark.x - coreSize / 2, spark.y - coreSize / 2, coreSize, coreSize);
        }

        ctx.restore();
      }

      // 打ち上げ中の花火弾を輝点として重ね描きする(グリッドに書き込まない演出レイヤー)
      for (const shell of fireworksRef.current) {
        const shellRgb = uint32ToRgb(shell.colorUint32);
        ctx.save();
        ctx.fillStyle = `rgba(${shellRgb[0]}, ${shellRgb[1]}, ${shellRgb[2]}, 0.95)`;
        ctx.beginPath();
        ctx.arc(shell.x + 0.5, shell.y + 0.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
        // 白い芯で「輝いている」ことを表現する
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(shell.x + 0.5, shell.y + 0.5, 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const runSimulationUpdate = () => {
      updateHeat();
      for (let i = 0; i < STEPS_PER_FRAME; i++) {
        updateParticles();
      }
      updateEntities(); // Run every frame
      updateFireworks(); // 打ち上げ弾と開花後の火花をフレームごとに更新する(一時停止中は止まる)
    };

    const loop = (timestamp: number) => {
      if (lastTime === 0) lastTime = timestamp;
      const elapsedTime = Math.min(timestamp - lastTime, interval * MAX_SIMULATION_UPDATES_PER_FRAME);
      lastTime = timestamp;

      if (!isPaused) {
        // 描画周期はそのまま、倍率分だけ物理更新を蓄積する。
        simulationAccumulator += elapsedTime * timeScale;
        let simulationUpdates = 0;
        while (simulationAccumulator >= interval && simulationUpdates < maxSimulationUpdates) {
          runSimulationUpdate();
          simulationAccumulator -= interval;
          simulationUpdates += 1;
        }
        if (simulationAccumulator >= interval) {
          // 上限を超えた丸ごとの遅延だけを捨て、通常フレームの端数は次回へ持ち越す。
          simulationAccumulator %= interval;
        }
      } else {
        // 一時停止中の経過時間を再開時にまとめて進めない。
        simulationAccumulator = 0;
      }

      draw();
      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationId);
  }, [colors, isPaused, bgColor, gravity, temperatureViewMode, timeScale, isSolid]);

  const handlePointer = (e: React.PointerEvent) => {
    if (activeMenu) {
      if (e.type !== "pointerdown") return;
      setActiveMenu(null);
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const gridX = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const gridY = Math.floor((e.clientY - rect.top) / CELL_SIZE);

    // カーソル(風の範囲リング / 塗りブラシの輪)を更新。エンティティ系ペンでは出さない。
    if (e.type === "pointerleave") {
      cursorRef.current = null;
    } else if (e.type === "pointerdown" || e.type === "pointermove") {
      const prev = lastPointerPosRef.current;
      if (selectedType === WIND_TOOL) {
        cursorRef.current = {
          x: gridX,
          y: gridY,
          radius: brushSize * WIND_RADIUS_SCALE,
          isWind: true,
          dx: prev ? gridX - prev.x : 0,
          dy: prev ? gridY - prev.y : 0,
        };
      } else if (isElementBrush(selectedType) && !findEntityShape(selectedType)) {
        cursorRef.current = { x: gridX, y: gridY, radius: brushSize, isWind: false, dx: 0, dy: 0 };
      } else {
        cursorRef.current = null; // 生き物ペンは輪を出さない
      }
    }

    const strikeLightning = (sx: number, sy: number) => {
      const grid = gridRef.current;
      const pColorGrid = particleColorGridRef.current;
      const offsets = colorOffsetRef.current;
      const tempGrid = temperatureRef.current;
      if (!grid || !pColorGrid || !offsets || !tempGrid) return;
      castLightningBolt(
        grid,
        pColorGrid,
        offsets,
        tempGrid,
        gridWidthRef.current,
        gridHeightRef.current,
        sx,
        sy,
        calculateGravityDirection(gravity),
        // 雷ペンで落とす雷にも選択中の色を使う
        hexToUint32(colors[TYPES.LIGHTNING]),
      );
    };

    // タップ位置(gridX, gridY)を開花高度として、画面下端から花火弾を打ち上げる
    const launchFirework = (targetX: number, targetY: number) => {
      const gridHeight = gridHeightRef.current;
      const clampedTargetY = Math.max(4, Math.min(targetY, gridHeight - 8));
      const colorHex = FIREWORK_PALETTE[Math.floor(Math.random() * FIREWORK_PALETTE.length)];
      fireworksRef.current.push({
        x: targetX,
        y: gridHeight - 2,
        targetY: clampedTargetY,
        colorUint32: hexToUint32(colorHex),
        wigglePhase: Math.random() * Math.PI * 2,
      });
    };

    if (e.type === "pointerdown") {
      isDragging.current = true;
      lastPointerPosRef.current = { x: gridX, y: gridY };

      if (selectedType === WIND_TOOL) {
        pushUndoSnapshot();
        return;
      }
      if (selectedType === FIREWORK_TOOL) {
        // 火の粉は積もって絵になるためUndo対象にする(雷ペンと同じ扱い)
        pushUndoSnapshot();
        launchFirework(gridX, gridY);
        lastSpawnRef.current = Date.now();
        return;
      }
      if (selectedType === TYPES.LIGHTNING) {
        pushUndoSnapshot();
        strikeLightning(gridX, gridY);
        lastSpawnRef.current = Date.now();
        return;
      }

      const selectedShape = isElementBrush(selectedType) ? findEntityShape(selectedType) : null;
      if (selectedShape && isElementBrush(selectedType)) {
        // Spawn entity (no interpolation needed)
        const now = Date.now();
        if (now - lastSpawnRef.current > 200) {
          lastSpawnRef.current = now;
          pushUndoSnapshot();
          const scale = calculateEntityScale(brushSize);
          const dir = Math.random() > 0.5 ? 1 : -1;
          const velocity = calculateInitialEntityVelocity(selectedType, dir);
          entitiesRef.current.push({
            id: nextEntityId.current++,
            type: selectedType,
            x: gridX - calculateEntityWidth(selectedShape, scale) / 2,
            y: gridY - calculateEntityHeight(selectedShape, scale) / 2,
            dir,
            vx: velocity.vx,
            vy: velocity.vy,
            color: colors[selectedType],
            scale,
            hunger: DEFAULT_ENTITY_HUNGER,
          });
        }
      } else {
        pushUndoSnapshot();
        drawCircle(gridX, gridY);
      }
    } else if (e.type === "pointermove") {
      if (isDragging.current) {
        if (selectedType === WIND_TOOL) {
          if (lastPointerPosRef.current) {
            applyWind(gridX, gridY, gridX - lastPointerPosRef.current.x, gridY - lastPointerPosRef.current.y);
          }
          lastPointerPosRef.current = { x: gridX, y: gridY };
        } else if (selectedType === FIREWORK_TOOL) {
          // ドラッグ中は一定間隔で連続打ち上げ(スターマイン)
          const now = Date.now();
          if (now - lastSpawnRef.current > FIREWORK_LAUNCH_INTERVAL_MS) {
            lastSpawnRef.current = now;
            launchFirework(gridX, gridY);
          }
          lastPointerPosRef.current = { x: gridX, y: gridY };
        } else if (selectedType === TYPES.LIGHTNING) {
          const now = Date.now();
          if (now - lastSpawnRef.current > 150) {
            lastSpawnRef.current = now;
            strikeLightning(gridX, gridY);
          }
          lastPointerPosRef.current = { x: gridX, y: gridY };
        } else if (isElementBrush(selectedType) && findEntityShape(selectedType)) {
          // Dragging entity tool? Just update pos, no draw
        } else {
          if (lastPointerPosRef.current) {
            drawLine(lastPointerPosRef.current.x, lastPointerPosRef.current.y, gridX, gridY);
          }
          lastPointerPosRef.current = { x: gridX, y: gridY };
        }
      }
    } else if (e.type === "pointerup" || e.type === "pointerleave") {
      if (isDragging.current) {
        isDragging.current = false;
        lastPointerPosRef.current = null;
        saveToStorage();
      }
    }
  };

  const clearCanvas = () => {
    if (confirm("キャンバスを全消去しますか？")) {
      pushUndoSnapshot();
      gridRef.current?.fill(TYPES.EMPTY);
      particleColorGridRef.current?.fill(hexToUint32(bgColor)); // Clear to background color
      const temperature = temperatureRef.current;
      const ambientByRow = ambientByRowRef.current;
      if (temperature) {
        if (ambientByRow) {
          const width = gridWidthRef.current;
          fillTemperatureGridByAmbient(temperature, width, ambientByRow);
        } else {
          temperature.fill(AMBIENT_TEMP);
        }
      }
      entitiesRef.current = [];
      clearFireworkEffects();
      removeLocalStorageItem(STORAGE_KEY);
      saveToStorage();
    }
  };

  const createCurrentShareUrl = useCallback((): URL | null => {
    const state = createSerializedSunaPaintState("share");
    if (!state) return null;

    try {
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set(SHARE_QUERY_PARAM, encodeSunaPaintShareState(state));
      return shareUrl;
    } catch (error) {
      console.error("Failed to create share URL", error);
      return null;
    }
  }, [createSerializedSunaPaintState]);

  const copyCurrentShareUrl = useCallback(async () => {
    const shareUrl = createCurrentShareUrl();
    if (!shareUrl) {
      setSaveShareMessage("共有URLを作成できませんでした。");
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      replaceCurrentLocationWithShareUrl(shareUrl);
      const backgroundNotice = backgroundImageUrl ? " 背景画像はURLに含まれません。" : "";
      setSaveShareMessage(`状態付き共有URLをコピーしました。${backgroundNotice}`);
    } catch {
      setSaveShareMessage("共有URLのコピーに失敗しました。ブラウザの権限をご確認ください。");
    }
  }, [backgroundImageUrl, createCurrentShareUrl]);

  const openXShareIntent = useCallback(() => {
    const appUrl = new URL(window.location.pathname, window.location.origin);
    const intentUrl = new URL("https://x.com/intent/tweet");
    intentUrl.searchParams.set("text", SAVE_SHARE_TEXT);
    intentUrl.searchParams.set("url", appUrl.toString());
    window.open(intentUrl.toString(), "_blank", "noopener,noreferrer");
    setSaveShareMessage("Xは通常URLで開きました。状態共有はURLコピー、画像共有はダウンロード画像の添付を使ってください。");
  }, []);

  const openSavePreview = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaveShareMessage(null);
    setSavePreviewFileName(`suna-paint-${Date.now()}.png`);
    setSavePreviewUrl(canvas.toDataURL("image/png"));
  };

  const downloadSavePreview = () => {
    if (!savePreviewUrl) return;

    const link = document.createElement("a");
    link.download = savePreviewFileName;
    link.href = savePreviewUrl;
    link.click();
  };

  const shareSavePreviewToX = () => {
    if (!savePreviewUrl) return;
    openXShareIntent();
  };

  const updateColor = (newColor: string) => {
    if (!isElementBrush(selectedType)) return;
    setColors((prev) => ({ ...prev, [selectedType]: newColor }));
  };

  const selectBrushType = (nextType: BrushSelection) => {
    // モバイルでは選択後の固定メニューが透明な操作面として残りやすいため、選択と同時に閉じる。
    setSelectedType(nextType);
    setActiveMenu(null);
  };

  // 「塗りつぶし」は対象の粒子が画面に1つも無いと何も起きない。
  // 名前からペイントバケツを期待して押すと無反応に見え、「塗りつぶしができない」という
  // 報告につながっていたため、実行できなかったことを一時的にボタンのラベルで伝える。
  // アンマウント後に setState が走らないようタイマーを片付ける
  useEffect(() => {
    return () => {
      if (fillHintTimerRef.current !== null) window.clearTimeout(fillHintTimerRef.current);
    };
  }, []);

  const showFillHint = (text: string) => {
    setFillHint(text);
    if (fillHintTimerRef.current !== null) window.clearTimeout(fillHintTimerRef.current);
    fillHintTimerRef.current = window.setTimeout(() => setFillHint(null), 2200);
  };

  const fillSelectedTypeWithColor = () => {
    if (!gridRef.current || !particleColorGridRef.current || !colorOffsetRef.current) return;
    if (!isElementBrush(selectedType)) {
      showFillHint("このペンは対象外");
      return; // 風と花火は塗りつぶし対象外
    }

    const grid = gridRef.current;
    const pColorGrid = particleColorGridRef.current;
    const offsets = colorOffsetRef.current;
    const fillColor = selectedType === TYPES.EMPTY ? bgColor : colors[selectedType];
    const fillColorValue = hexToUint32(fillColor);
    const hasTargetParticle = grid.some((particleType) => particleType === selectedType);
    const hasTargetEntity = entitiesRef.current.some((entity) => entity.type === selectedType);

    if (!hasTargetParticle && !hasTargetEntity) {
      // 置いていない種類は塗り替えようがない。押しても何も起きない状態を見えるようにする
      showFillHint(`${getBrushLabel(selectedType)}がまだ無い`);
      return;
    }

    pushUndoSnapshot();

    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== selectedType) continue;
      pColorGrid[i] = fillColorValue;
      offsets[i] = 0;
    }

    entitiesRef.current = entitiesRef.current.map((entity) => {
      if (entity.type !== selectedType) return entity;
      return { ...entity, color: fillColor };
    });

    saveToStorage();
  };

  const uploadBackgroundImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setBackgroundImageUrl(reader.result);
    };
    reader.readAsDataURL(file);
    event.currentTarget.value = "";
  };

  const clearBackgroundImage = () => {
    setBackgroundImageUrl(null);
    backgroundImagePixelsRef.current = null;
  };

  const renderBrushMenuContent = () => (
    <div className={styles.brushGrid}>
      {BRUSH_GROUPS.map((group) => (
        <Fragment key={group.label}>
          <div className={styles.brushGroupLabel}>{group.label}</div>
          {group.brushes.map((t) => (
            <button type="button"
              key={t}
              className={styles.brushButton}
              data-active={selectedType === t}
              aria-pressed={selectedType === t}
              onClick={() => {
                selectBrushType(t);
              }}
            >
              <span className={styles.brushSwatch} style={{ background: getBrushSwatchColor(t, colors) }} />
              <span className={styles.brushLabel}>{getBrushLabel(t)}</span>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );

  const renderSizeMenuContent = () => (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>
        サイズ <span className={styles.settingValue}>{brushSize}</span>
      </div>
      <input
        type="range"
        min="1"
        max="20"
        value={brushSize}
        onChange={(e) => setBrushSize(Number(e.target.value))}
        className={styles.slider}
      />
    </div>
  );

  const renderGravityMenuContent = () => (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>
        重力 <span className={styles.settingValue}>{formatGravityLabel(gravity)}</span>
      </div>
      <input
        type="range"
        min={MIN_GRAVITY}
        max={MAX_GRAVITY}
        step="0.05"
        value={gravity}
        onChange={(e) => setGravity(Number(e.target.value))}
        className={styles.slider}
      />
      <div className={styles.settingHint}>左は逆重力、中央付近は無重力、右は重めです。</div>
      <div className={styles.presetRow}>
        <button type="button" className={styles.presetButton} onClick={() => setGravity(-1)}>
          逆
        </button>
        <button type="button" className={styles.presetButton} onClick={() => setGravity(0)}>
          0
        </button>
        <button type="button" className={styles.presetButton} onClick={() => setGravity(DEFAULT_GRAVITY)}>
          標準
        </button>
        <button type="button" className={styles.presetButton} onClick={() => setGravity(2)}>
          重い
        </button>
      </div>
    </div>
  );

  const renderTimeMenuContent = () => (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>
        時間の流れ <span className={styles.settingValue}>{formatTimeScaleLabel(timeScale)}</span>
      </div>
      <input
        type="range"
        min={MIN_TIME_SCALE}
        max={MAX_TIME_SCALE}
        step={TIME_SCALE_STEP}
        value={timeScale}
        onChange={(event) => setTimeScale(normalizeTimeScale(Number(event.target.value)))}
        className={styles.slider}
        aria-label="時間の流れの速さ"
      />
      <div className={styles.settingHint}>
        生き物・天気・温度・花火が同じ倍率で進みます。高速ほど端末負荷が増えます。
      </div>
      <div className={styles.presetRow}>
        <button type="button" className={styles.presetButton} onClick={() => setTimeScale(0.5)}>
          ゆっくり
        </button>
        <button type="button" className={styles.presetButton} onClick={() => setTimeScale(DEFAULT_TIME_SCALE)}>
          標準
        </button>
        <button type="button" className={styles.presetButton} onClick={() => setTimeScale(1.5)}>
          速い
        </button>
        <button type="button" className={styles.presetButton} onClick={() => setTimeScale(MAX_TIME_SCALE)}>
          最速
        </button>
      </div>
    </div>
  );

  const renderTemperatureMenuContent = () => (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>
        全体温度 <span className={styles.settingValue}>{formatTemperatureLabel(environmentTemperatureCelsius)}</span>
      </div>
      <input
        type="range"
        min={MIN_ENVIRONMENT_TEMPERATURE_CELSIUS}
        max={MAX_ENVIRONMENT_TEMPERATURE_CELSIUS}
        step="1"
        value={environmentTemperatureCelsius}
        onChange={(e) => updateEnvironmentTemperature(Number(e.target.value))}
        className={styles.slider}
        aria-label="全体温度"
      />
      <div className={styles.presetRow}>
        <button type="button" className={styles.presetButton} onClick={() => updateEnvironmentTemperature(-50)}>
          極寒
        </button>
        <button type="button" className={styles.presetButton} onClick={() => updateEnvironmentTemperature(20)}>
          標準
        </button>
        <button type="button" className={styles.presetButton} onClick={() => updateEnvironmentTemperature(80)}>
          高温
        </button>
        <button type="button" className={styles.presetButton} onClick={() => updateEnvironmentTemperature(300)}>
          灼熱
        </button>
      </div>
      <div className={styles.settingLabel}>
        表示 <span className={styles.settingValue}>{temperatureViewMode === "temperature" ? "温度" : "通常"}</span>
      </div>
      {/** biome-ignore lint/a11y/useSemanticElements: ARIA roleとラベルで同等の意味を提供しておりネイティブ要素への置換が既存のボックスモデルや操作挙動を変えるため */}
      <div className={styles.segmentedControl} role="group" aria-label="表示モード">
        <button type="button"
          className={styles.segmentButton}
          data-active={temperatureViewMode === "normal"}
          aria-pressed={temperatureViewMode === "normal"}
          onClick={() => setTemperatureViewMode("normal")}
        >
          通常
        </button>
        <button type="button"
          className={styles.segmentButton}
          data-active={temperatureViewMode === "temperature"}
          aria-pressed={temperatureViewMode === "temperature"}
          onClick={() => setTemperatureViewMode("temperature")}
        >
          温度
        </button>
      </div>
      <div className={styles.temperatureLegend} aria-hidden="true">
        <span className={styles.temperatureLegendCold}>低</span>
        <span className={styles.temperatureLegendBar} />
        <span className={styles.temperatureLegendHot}>高</span>
      </div>
    </div>
  );

  // 空(時間帯)メニュー。太陽・月・星と朝昼夕夜を切り替える(見た目だけ・温度には影響しない)。
  const renderSkyMenuContent = () => (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>空（時間帯）</div>
      {/** biome-ignore lint/a11y/useSemanticElements: ARIA roleとラベルで同等の意味を提供しておりネイティブ要素への置換が既存のボックスモデルや操作挙動を変えるため */}
      <div className={styles.skyGrid} role="group" aria-label="時間帯">
        {SKY_MODES.map((mode) => (
          <button
            type="button"
            key={mode.value}
            className={styles.segmentButton}
            data-active={skyMode === mode.value}
            aria-pressed={skyMode === mode.value}
            onClick={() => setSkyMode(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className={styles.settingHint}>朝は昇る太陽、夕は沈む太陽、夜は月と星が出ます。気温は変わりません。</div>
    </div>
  );

  const renderActiveMenuContent = () => {
    if (activeMenu === "brush") return renderBrushMenuContent();
    if (activeMenu === "size") return renderSizeMenuContent();
    if (activeMenu === "gravity") return renderGravityMenuContent();
    if (activeMenu === "time") return renderTimeMenuContent();
    if (activeMenu === "temperature") return renderTemperatureMenuContent();
    if (activeMenu === "sky") return renderSkyMenuContent();
    return null;
  };

  const detachedMenu =
    typeof document !== "undefined" && isDetachedMenu && activeMenu
      ? createPortal(
          <div className={styles.dropdownMenu} data-open="true">
            {renderActiveMenuContent()}
          </div>,
          document.body,
        )
      : null;

  const savePreviewModal =
    typeof document !== "undefined" && savePreviewUrl
      ? createPortal(
          // biome-ignore lint/a11y/noStaticElementInteractions: モーダル背景の補助クリック閉じと内容側の伝播制御であり内部に操作要素を含むためbuttonへ変更できない
<div className={styles.saveModalOverlay} role="presentation" onClick={() => setSavePreviewUrl(null)}>
            {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: モーダル背景の補助クリック閉じと内容側の伝播制御であり内部に操作要素を含むためbuttonへ変更できない */}
            {/** biome-ignore lint/a11y/useKeyWithClickEvents: モーダル背景の補助クリック閉じと内容側の伝播制御であり内部に操作要素を含むためbuttonへ変更できない */}
            <div
              className={styles.saveModalCard}
              role="dialog"
              aria-modal="true"
              aria-labelledby="suna-paint-save-preview-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.saveModalHeader}>
                <div>
                  <h2 id="suna-paint-save-preview-title" className={styles.saveModalTitle}>
                    保存プレビュー
                  </h2>
                  <p className={styles.saveModalText}>画像を確認してから保存や共有を選べます。</p>
                </div>
                <button
                  type="button"
                  className={styles.saveModalCloseButton}
                  onClick={() => setSavePreviewUrl(null)}
                  aria-label="保存プレビューを閉じる"
                >
                  <IconX size={18} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.savePreviewFrame}>
                {/** biome-ignore lint/performance/noImgElement: ユーザー入力・生成blob・動的外部URL・ゲーム用ピクセル素材でありnext/imageへの置換が読み込みや描画挙動を変えるため */}
                <img className={styles.savePreviewImage} src={savePreviewUrl} alt="保存画像のプレビュー" />
              </div>
              {saveShareMessage && <p className={styles.saveModalNotice}>{saveShareMessage}</p>}
              <div className={styles.saveModalActions}>
                <button type="button" className={styles.saveModalPrimaryButton} onClick={downloadSavePreview}>
                  <IconDownload size={16} aria-hidden="true" />
                  ダウンロード
                </button>
                <button
                  type="button"
                  className={styles.saveModalSecondaryButton}
                  onClick={() => {
                    void copyCurrentShareUrl();
                  }}
                >
                  <IconLink size={16} aria-hidden="true" />
                  URLで共有
                </button>
                <button type="button" className={styles.saveModalXButton} onClick={shareSavePreviewToX}>
                  <IconBrandX size={16} aria-hidden="true" />
                  Xで共有
                </button>
                <button type="button" className={styles.saveModalSecondaryButton} onClick={() => setSavePreviewUrl(null)}>
                  閉じる
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={styles.page} style={{ backgroundColor: bgColor }}>
      <canvas
        ref={canvasRef}
        className={styles.canvasLayer}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        onPointerUp={handlePointer}
        onPointerLeave={handlePointer}
      />

      <div className={styles.uiLayer}>
        <div ref={toolbarRef} className={styles.toolbar} onScroll={() => updateToolbarScrollHint()}>
          <div className={styles.toolbarLeft}>
            {/* 本家は Weva 共有ロゴを置く枠。単体版では絵文字のブランドマークに置き換えている。 */}
            <div className={styles.logoContainer} aria-hidden="true">
              🏖️
            </div>
            <div className={styles.title}>砂ペイント</div>

            {/* Element Selector */}
            <div className={styles.dropdownContainer}>
              <button type="button"
                className={styles.dropdownTrigger}
                data-active={activeMenu === "brush"}
                onClick={() => setActiveMenu(activeMenu === "brush" ? null : "brush")}
              >
                <span
                  className={styles.dropdownTriggerSwatch}
                  style={{ background: getBrushSwatchColor(selectedType, colors) }}
                />
                <span className={styles.dropdownTriggerText}>{getBrushLabel(selectedType)}</span>▼
              </button>
              <div className={styles.dropdownMenu} data-open={activeMenu === "brush" && !isDetachedMenu}>
                {renderBrushMenuContent()}
              </div>
            </div>

            {/* Size */}
            <div className={styles.dropdownContainer}>
              <button type="button"
                className={styles.dropdownTrigger}
                data-active={activeMenu === "size"}
                onClick={() => setActiveMenu(activeMenu === "size" ? null : "size")}
              >
                ↔ <span className={styles.triggerLabelWord}>サイズ </span>
                {brushSize} ▼
              </button>
              <div className={styles.dropdownMenu} data-open={activeMenu === "size" && !isDetachedMenu}>
                {renderSizeMenuContent()}
              </div>
            </div>

            {/* Gravity */}
            <div className={styles.dropdownContainer}>
              <button type="button"
                className={styles.dropdownTrigger}
                data-active={activeMenu === "gravity"}
                onClick={() => setActiveMenu(activeMenu === "gravity" ? null : "gravity")}
              >
                <span className={styles.triggerLabelWord}>重力 </span>
                {formatGravityLabel(gravity)} ▼
              </button>
              <div className={styles.dropdownMenu} data-open={activeMenu === "gravity" && !isDetachedMenu}>
                {renderGravityMenuContent()}
              </div>
            </div>

            {/* 時間の流れ */}
            <div className={styles.dropdownContainer}>
              <button type="button"
                className={styles.dropdownTrigger}
                data-active={activeMenu === "time"}
                onClick={() => setActiveMenu(activeMenu === "time" ? null : "time")}
              >
                <span className={styles.triggerLabelWord}>時間 </span>
                {timeScale.toFixed(2)}x ▼
              </button>
              <div className={styles.dropdownMenu} data-open={activeMenu === "time" && !isDetachedMenu}>
                {renderTimeMenuContent()}
              </div>
            </div>

            {/* Temperature */}
            <div className={styles.dropdownContainer}>
              <button type="button"
                className={styles.dropdownTrigger}
                data-active={activeMenu === "temperature"}
                onClick={() => setActiveMenu(activeMenu === "temperature" ? null : "temperature")}
              >
                <span className={styles.triggerLabelWord}>温度 </span>
                {formatTemperatureLabel(environmentTemperatureCelsius)} ▼
              </button>
              <div className={styles.dropdownMenu} data-open={activeMenu === "temperature" && !isDetachedMenu}>
                {renderTemperatureMenuContent()}
              </div>
            </div>

            {/* Sky (時間帯: 太陽/月/星) */}
            <div className={styles.dropdownContainer}>
              <button type="button"
                className={styles.dropdownTrigger}
                data-active={activeMenu === "sky"}
                onClick={() => setActiveMenu(activeMenu === "sky" ? null : "sky")}
              >
                🌤 <span className={styles.triggerLabelWord}>空 </span>
                {SKY_MODES.find((mode) => mode.value === skyMode)?.label ?? "なし"} ▼
              </button>
              <div className={styles.dropdownMenu} data-open={activeMenu === "sky" && !isDetachedMenu}>
                {renderSkyMenuContent()}
              </div>
            </div>

            {/* Color Pickers */}
            <div className={styles.colorRow}>
              {/* 風には色がないのでピッカーを隠す */}
              {isElementBrush(selectedType) && (
                <div
                  className={styles.colorPreview}
                  style={{ background: colors[selectedType] }}
                  title={`${TYPE_NAMES[selectedType]}の色`}
                >
                  <input
                    type="color"
                    value={colors[selectedType]}
                    onChange={(e) => updateColor(e.target.value)}
                    className={styles.colorInput}
                  />
                </div>
              )}
              {/* New: Background Color Picker */}
              <div className={styles.colorPreview} style={{ background: bgColor }} title="背景色">
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className={styles.colorInput} />
              </div>
            </div>
          </div>

          <div className={styles.toolbarActions}>
            <input
              ref={backgroundImageInputRef}
              className={styles.fileInput}
              type="file"
              accept="image/*"
              onChange={uploadBackgroundImage}
            />
            <button type="button"
              className={styles.actionButton}
              onClick={() => backgroundImageInputRef.current?.click()}
              title="背景画像を読み込む"
            >
              <IconPhoto size={16} aria-hidden="true" />
              <span className={styles.actionButtonLabel}>背景</span>
              <span className={styles.actionButtonLabelShort}>背景</span>
            </button>
            {backgroundImageUrl && (
              <button type="button" className={styles.clearButton} onClick={clearBackgroundImage} title="背景画像を削除">
                <IconX size={16} aria-hidden="true" />
                <span className={styles.actionButtonLabel}>背景削除</span>
                <span className={styles.actionButtonLabelShort}>削除</span>
              </button>
            )}
            <button type="button"
              className={styles.actionButton}
              onClick={fillSelectedTypeWithColor}
              title={`${getBrushLabel(selectedType)}を現在の色に塗りつぶす`}
            >
              <IconBucket size={16} aria-hidden="true" />
              <span className={styles.actionButtonLabel}>{fillHint ?? "塗りつぶし"}</span>
              <span className={styles.actionButtonLabelShort}>{fillHint ?? "塗り"}</span>
            </button>
            <button type="button"
              className={styles.actionButton}
              onClick={undoCanvas}
              disabled={undoDepth === 0}
              title="元に戻す"
              aria-label="元に戻す"
            >
              <span aria-hidden="true">↶</span>
              <span className={styles.actionButtonLabel}>戻す</span>
              <span className={styles.actionButtonLabelShort}>戻す</span>
            </button>
            <button type="button" className={styles.actionButton} onClick={() => setIsPaused(!isPaused)} title={isPaused ? "再開" : "一時停止"}>
              <span aria-hidden="true">{isPaused ? "▶" : "⏸"}</span>
              <span className={styles.actionButtonLabel}>{isPaused ? "再開" : "一時停止"}</span>
              <span className={styles.actionButtonLabelShort}>{isPaused ? "再開" : "停止"}</span>
            </button>
            <button type="button" className={styles.clearButton} onClick={clearCanvas} title="全消去">
              <span aria-hidden="true">🗑️</span>
              <span className={styles.actionButtonLabel}>全消去</span>
              <span className={styles.actionButtonLabelShort}>消去</span>
            </button>
            <button type="button" className={styles.actionButton} onClick={openSavePreview} title="保存プレビューを開く">
              <IconDownload size={16} aria-hidden="true" />
              <span className={styles.actionButtonLabel}>保存</span>
              <span className={styles.actionButtonLabelShort}>保存</span>
            </button>
          </div>
        </div>
        {isToolbarScrollHintVisible && (
          <div className={styles.toolbarScrollHint} aria-hidden="true">
            ›
          </div>
        )}
      </div>
      {detachedMenu}
      {savePreviewModal}
    </div>
  );
};
