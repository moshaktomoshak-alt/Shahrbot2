// Standalone test: spawns a few bots, has them attack randomly, and prints
// progress every 20 ticks. No networking, no Telegram — just proving the
// engine logic (spawning, attacks, elimination, win condition) works before
// we build anything on top of it.

import { generateTestMap } from "../engine/MapLoader.js";
import { GameEngine } from "../engine/GameEngine.js";
import { NEUTRAL_OWNER } from "../engine/types.js";

const WIDTH = 60;
const HEIGHT = 40;
const NUM_BOTS = 6;

const state = generateTestMap(WIDTH, HEIGHT);
const engine = new GameEngine(state);

const colors = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#9d4edd", "#ffbe0b"];
for (let i = 0; i < NUM_BOTS; i++) {
  const p = engine.addPlayer(1000 + i, `Bot${i}`, colors[i % colors.length]);
  if (!p) console.log(`Failed to spawn bot ${i} (map full?)`);
}

// Each bot picks ONE random far-away land tile as a standing goal and just
// keeps holding it (like a player holding their finger down on the map).
// Every so often it picks a new goal, simulating a player redirecting the push.
function assignRandomGoals(): void {
  const s = engine.getState();
  for (const player of s.players) {
    if (!player.alive) continue;
    if (player.attackGoal !== null && Math.random() > 0.02) continue; // mostly keep pushing the same way
    const landTiles: number[] = [];
    for (let i = 0; i < s.passable.length; i++) if (s.passable[i] === 1) landTiles.push(i);
    const goal = landTiles[Math.floor(Math.random() * landTiles.length)];
    engine.setAttackGoal(player.id, goal);
  }
}

const TOTAL_TICKS = 400;
for (let t = 0; t < TOTAL_TICKS; t++) {
  assignRandomGoals();
  engine.tick();

  if (t % 20 === 0 || engine.getState().gameOver) {
    const s = engine.getState();
    const summary = s.players
      .map((p) => `${p.name}:${p.alive ? p.tileCount : "OUT"}(${Math.floor(p.troops)}tr)`)
      .join(" | ");
    console.log(`tick ${s.tick} -> ${summary}`);
  }

  if (engine.getState().gameOver) {
    console.log(`\nGame over! Winner: ${engine.getState().winnerId}`);
    break;
  }
}

const finalState = engine.getState();
if (!finalState.gameOver) {
  console.log("\nReached tick limit without a winner (expected with random bots).");
}
