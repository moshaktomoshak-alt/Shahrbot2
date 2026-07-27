// MapLoader: produces the passable/impassable tile grid the engine runs on.
//
// Phase 1 uses a simple procedural landmass so we can test the engine without
// any external assets. Phase 2 (once we're happy with the core mechanics)
// swaps this for real map data — e.g. reusing OpenFront's own map bitmaps
// (resources/maps in the original repo, which are just grayscale PNGs where
// pixel brightness encodes land/water/elevation). This file is the ONLY place
// that needs to change to make that swap: everything downstream just reads a
// GameState-shaped grid.

import { GameState, NEUTRAL_OWNER } from "./types.js";

/**
 * Generates a simple pseudo-random landmass for testing.
 * Uses a basic radial falloff + noise so there's a reasonably shaped
 * continent instead of pure random static (which plays badly).
 */
export function generateTestMap(width: number, height: number): GameState {
  const size = width * height;
  const passable = new Uint8Array(size);
  const owner = new Int16Array(size).fill(NEUTRAL_OWNER);
  const garrison = new Uint32Array(size);

  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      // cheap pseudo-noise so coastlines aren't a perfect circle
      const noise =
        Math.sin(x * 0.3) * Math.cos(y * 0.31) * 0.15 +
        Math.sin(x * 0.07 + y * 0.05) * 0.1;
      const land = dist + noise < 0.78;
      passable[idx] = land ? 1 : 0;
    }
  }

  return {
    width,
    height,
    owner,
    garrison,
    passable,
    players: [],
    tick: 0,
    pendingAttacks: [],
    gameOver: false,
    winnerId: null,
  };
}

/**
 * Placeholder for the future real-map loader.
 * Will read a PNG/heightmap from disk (e.g. reused OpenFront assets) and
 * populate `passable` from pixel brightness, same as generateTestMap does
 * with the procedural version.
 */
export async function loadRealMap(_mapName: string): Promise<GameState> {
  throw new Error(
    "loadRealMap not implemented yet — Phase 2. Use generateTestMap for now.",
  );
}

/** Finds all passable tiles adjacent to a given tile (4-directional). */
export function neighbors(
  state: GameState,
  tileIndex: number,
): number[] {
  const { width, height } = state;
  const x = tileIndex % width;
  const y = Math.floor(tileIndex / width);
  const result: number[] = [];
  const candidates: [number, number][] = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of candidates) {
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      result.push(ny * width + nx);
    }
  }
  return result;
}
