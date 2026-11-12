// The open world's rules: movement, gathering, farming, crafting, building,
// fishing, ball-toss, quests and saving. No rendering in here — the view
// (view.js) draws whatever this says is true, and the tests drive it directly.
import { ITEMS, RECIPES, CROPS, NPCS, PLACES, PLOTS, RIVER, BOUNDS, QUESTS } from './data.js';

export function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const REACH = 2.4;
const NODE = {
  tree:   { r: .7, hp: 3, gives: { wood: 2 }, respawn: 120, verb: 'Chop tree' },
  rubber: { r: .7, hp: 1, gives: { rubber: 1 }, respawn: 25, verb: 'Tap rubber tree' },
  rock:   { r: 1.0, hp: 4, gives: { stone: 2 }, respawn: 150, verb: 'Break rock' },
  jade:   { r: 1.0, hp: 5, gives: { jade: 1, stone: 1 }, respawn: 240, verb: 'Mine jade vein' },
  fiber:  { r: .5, hp: 1, gives: { fiber: 2 }, respawn: 45, verb: 'Gather fiber' },
  clay:   { r: .9, hp: 1, gives: { clay: 1 }, respawn: 20, verb: 'Dig clay' },
};
export const NODE_TYPES = NODE;

/** Seeded layout: the same seed always grows the same forest. */
export function generateWorld(seed = 2026) {
  const rnd = mulberry(seed);
  const nodes = [];
  const clear = (x, z) => {
    if (Math.hypot(x, z) < 15) return false;                                   // village
    if (x > RIVER.x1 - 2 && x < RIVER.x2 + 2) return false;                    // river
    if (x > PLOTS.x0 - 3 && x < PLOTS.x0 + PLOTS.cols * PLOTS.size + 3 && z > PLOTS.z0 - 3 && z < PLOTS.z0 + PLOTS.rows * PLOTS.size + 3) return false;
    if (Math.abs(x) < 3.5 && z > 0) return false;                              // road north to the court
    if (Math.hypot(x - PLACES.gate.x, z - PLACES.gate.z) < 9) return false;
    for (const p of Object.values(PLACES)) if (Math.hypot(x - p.x, z - p.z) < 4) return false;
    for (const n of NPCS) if (Math.hypot(x - n.x, z - n.z) < 3) return false;
    return true;
  };
  const scatter = (type, count, pick) => {
    let guard = 0;
    while (count > 0 && guard++ < 6000) {
      const [x, z] = pick();
      if (!clear(x, z)) continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.z - z) < 2.2)) continue;
      nodes.push({ id: nodes.length, type, x, z, rot: rnd() * 6.28, scale: .85 + rnd() * .4 });
      count -= 1;
    }
  };
  const anywhere = () => [(rnd() * 2 - 1) * (BOUNDS - 3), (rnd() * 2 - 1) * (BOUNDS - 3)];
  const east = () => [RIVER.x2 + 3 + rnd() * (BOUNDS - RIVER.x2 - 6), (rnd() * 2 - 1) * (BOUNDS - 3)];
  scatter('tree', 210, east);
  scatter('rubber', 26, east);
  scatter('rock', 46, anywhere);
  scatter('jade', 8, () => { const a = rnd() * 6.28, r = 38 + rnd() * 16; return [Math.abs(Math.cos(a)) * r - 6, Math.sin(a) * r]; });
  scatter('fiber', 34, east);
  for (let i = 0; i < 6; i++) nodes.push({ id: nodes.length, type: 'clay', x: RIVER.x2 + 1.6, z: -22 + i * 7 + rnd() * 2, rot: 0, scale: 1 });
  return { seed, nodes };
}

const fresh = () => ({
  v: 1, seed: 2026, x: 0, z: -6, facing: 0,
  inv: {}, hot: 0, quest: 0, started: {}, wins: {}, fragments: 0,
  count: { harvested: 0, planted: 0, tossWins: 0, fished: 0, crafted: 0 },
  plots: {},          // "c,r" -> { state: 'tilled'|'planted', crop, at }
  depleted: {},       // node id -> respawn time (ms)
  hits: {},           // node id -> blows landed
  builds: [],         // { x, z, y, item }
});

export class Adventure {
  constructor(save = null, now = Date.now()) {
    this.s = { ...fresh(), ...(save && save.v === 1 ? save : {}) };
    this.s.count = { ...fresh().count, ...(this.s.count || {}) };
    this.world = generateWorld(this.s.seed);
    this.now = now;
    this.cooldown = 0;
    this.fishing = null;       // { phase: 'wait'|'bite', t }
    this.toss = null;          // { throws, hits, t }
    this.moving = 0;
  }

  static npcName(id) { return NPCS.find((n) => n.id === id)?.name || id; }
  get quest() { return QUESTS[this.s.quest] || null; }
  give(item, n = 1) { if (item === 'fragment') this.s.fragments += n; else this.s.inv[item] = (this.s.inv[item] || 0) + n; }
  take(item, n = 1) { this.s.inv[item] = Math.max(0, (this.s.inv[item] || 0) - n); }
  has(item, n = 1) { return (this.s.inv[item] || 0) >= n; }
  alive(node) { return !(this.s.depleted[node.id] > this.now); }

  /** Things you can hold in the hotbar: seeds and building pieces you own. */
  hotbar() { return Object.keys(ITEMS).filter((id) => (ITEMS[id].build || id.startsWith('seed_')) && this.has(id)); }
  get held() { const bar = this.hotbar(); return bar.length ? bar[this.s.hot % bar.length] : null; }
  cycle() { const bar = this.hotbar(); if (bar.length) this.s.hot = (this.s.hot + 1) % bar.length; return this.held; }

  // ------------------------------------------------------------ movement
  update(dt, input, now = Date.now()) {
    this.now = now;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const events = [];
    const busy = this.fishing || this.toss;
    let mx = busy ? 0 : input.mx || 0, mz = busy ? 0 : input.mz || 0;
    const len = Math.hypot(mx, mz);
    this.moving = len > .08 ? Math.min(1, len) : 0;
    if (len > .08) {
      if (len > 1) { mx /= len; mz /= len; }
      const s = this.s, speed = 6.2;
      let x = s.x + mx * speed * dt, z = s.z + mz * speed * dt;
      // The river can only be crossed... not at all yet: the far bank is for a later chapter.
      if (x < RIVER.x2 + .6) x = RIVER.x2 + .6;
      x = Math.max(-BOUNDS, Math.min(BOUNDS, x)); z = Math.max(-BOUNDS, Math.min(BOUNDS, z));
      for (const n of this.world.nodes) {
        if (!this.alive(n) || n.type === 'fiber' || n.type === 'clay') continue;
        const r = NODE[n.type].r * n.scale + .45, dx = x - n.x, dz = z - n.z, d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4) { x = n.x + dx / d * r; z = n.z + dz / d * r; }
      }
      for (const b of this.s.builds) {
        if (b.item === 'pot' || b.item === 'torch') continue;
        const dx = x - b.x, dz = z - b.z;
        if (Math.abs(dx) < 1.35 && Math.abs(dz) < 1.35) { if (Math.abs(dx) > Math.abs(dz)) x = b.x + Math.sign(dx) * 1.35; else z = b.z + Math.sign(dz) * 1.35; }
      }
      s.x = x; s.z = z; s.facing = Math.atan2(mx, mz);
    }
    if (this.fishing) {
      this.fishing.t -= dt;
      if (this.fishing.t <= 0) {
        if (this.fishing.phase === 'wait') { this.fishing = { phase: 'bite', t: .95 }; events.push({ type: 'fishBite' }); }
        else { this.fishing = null; events.push({ type: 'fishMiss', text: 'It got away.' }); }
      }
    }
    if (this.toss) this.toss.t += dt;
    return events;
  }

  /** Where the toss marker is now, 0..1; it swings faster with each throw. */
  tossMeter() { if (!this.toss) return 0; const speed = 1.1 + (5 - this.toss.throws) * .22; const p = (this.toss.t * speed) % 2; return p < 1 ? p : 2 - p; }

  // ------------------------------------------------------------ what is in front of me
  front() { return { x: this.s.x + Math.sin(this.s.facing) * 1.4, z: this.s.z + Math.cos(this.s.facing) * 1.4 }; }
  cell() { const f = this.front(); return { x: Math.round(f.x / 2) * 2, z: Math.round(f.z / 2) * 2 }; }
  plotAt(x, z) {
    const c = Math.floor((x - PLOTS.x0) / PLOTS.size), r = Math.floor((z - PLOTS.z0) / PLOTS.size);
    return c >= 0 && c < PLOTS.cols && r >= 0 && r < PLOTS.rows ? `${c},${r}` : null;
  }
  ripe(plot) { return plot?.state === 'planted' && (this.now - plot.at) / 1000 >= CROPS[plot.crop].time; }
  growth(plot) { return plot?.state === 'planted' ? Math.min(1, (this.now - plot.at) / 1000 / CROPS[plot.crop].time) : 0; }

  /** The one thing USE would act on right now, with a label for the prompt. */
  target() {
    const s = this.s;
    if (this.toss) return { kind: 'toss', label: `Throw! (${this.toss.throws} left)` };
    if (this.fishing) return { kind: 'fishing', label: this.fishing.phase === 'bite' ? 'PULL!' : 'Wait for a bite…' };
    let best = null, bestD = REACH;
    for (const n of NPCS) { const d = Math.hypot(n.x - s.x, n.z - s.z); if (d < bestD) { best = { kind: 'npc', npc: n, label: `Talk to ${n.name}` }; bestD = d; } }
    if (best) return best;
    for (const [id, p] of Object.entries(PLACES)) if (Math.hypot(p.x - s.x, p.z - s.z) < p.r) return { kind: 'place', place: id, label: p.label };
    const key = this.plotAt(s.x, s.z);
    if (key) {
      const plot = s.plots[key];
      if (!plot) return { kind: 'plot', key, label: 'Till the soil' };
      if (plot.state === 'tilled') { const seed = this.held?.startsWith('seed_') ? this.held : ['seed_maize', 'seed_beans', 'seed_cacao'].find((id) => this.has(id)); return { kind: 'plot', key, seed, label: seed ? `Plant ${ITEMS[seed].name.replace(' seed', '').toLowerCase()}` : 'No seeds' }; }
      if (this.ripe(plot)) return { kind: 'plot', key, label: `Harvest ${plot.crop}` };
      return { kind: 'plot', key, label: `Growing… ${Math.round(this.growth(plot) * 100)}%`, idle: true };
    }
    const f = this.front();
    for (const n of this.world.nodes) {
      if (!this.alive(n)) continue;
      const d = Math.hypot(n.x - f.x, n.z - f.z);
      if (d < bestD) { best = { kind: 'node', node: n, label: NODE[n.type].verb }; bestD = d; }
    }
    if (best) return best;
    const held = this.held;
    if (held && ITEMS[held].build) return { kind: 'build', item: held, cell: this.cell(), label: `Place ${ITEMS[held].name}` };
    return null;
  }

  // ------------------------------------------------------------ USE
  act(now = Date.now()) {
    this.now = now;
    const events = [];
    if (this.cooldown > 0) return events;
    const t = this.target();
    if (!t || t.idle) return events;
    this.cooldown = .3;
    const s = this.s;
    if (t.kind === 'toss') {
      const m = this.tossMeter(), hit = Math.abs(m - .5) < .13;
      this.toss.throws -= 1; if (hit) this.toss.hits += 1; this.toss.t = 0;
      events.push({ type: 'tossThrow', hit });
      if (this.toss.throws === 0) {
        const won = this.toss.hits >= 3;
        if (won) { s.count.tossWins += 1; this.give('fiber', 1); }
        events.push({ type: 'tossEnd', hits: this.toss.hits, won, text: won ? `${this.toss.hits} of 5 — well thrown!` : `${this.toss.hits} of 5 — try again.` });
        this.toss = null;
      }
    } else if (t.kind === 'fishing') {
      if (this.fishing.phase === 'bite') { this.give('fish'); s.count.fished += 1; events.push({ type: 'gain', item: 'fish', n: 1 }); }
      else events.push({ type: 'fishMiss', text: 'Too soon — wait for the float to dip.' });
      this.fishing = null;
    } else if (t.kind === 'npc') events.push(...this.talk(t.npc));
    else if (t.kind === 'place') {
      if (t.place === 'dock') { this.fishing = { phase: 'wait', t: 1.6 + Math.random() * 3 }; events.push({ type: 'fishCast' }); }
      else if (t.place === 'range') { this.toss = { throws: 5, hits: 0, t: 0 }; events.push({ type: 'tossStart' }); }
      else if (t.place === 'bench') events.push({ type: 'openCraft' });
      else if (t.place === 'gate') {
        const q = this.quest;
        if (q?.arena && s.started[q.id] && !q.done(s)) events.push({ type: 'openArena', quest: q.id, config: q.arena });
        else events.push({ type: 'say', who: 'The court gate', lines: [s.fragments ? 'The court hums quietly. Play any court from the main menu.' : 'Vines hold the gate shut. The stone is cold and silent.'] });
      }
    } else if (t.kind === 'plot') {
      const plot = s.plots[t.key];
      if (!plot) { s.plots[t.key] = { state: 'tilled' }; events.push({ type: 'till', key: t.key }); }
      else if (plot.state === 'tilled') {
        if (!t.seed) events.push({ type: 'need', text: 'You have no seeds.' });
        else { this.take(t.seed); const crop = t.seed.replace('seed_', ''); s.plots[t.key] = { state: 'planted', crop, at: now }; s.count.planted += 1; events.push({ type: 'plant', key: t.key, crop }); }
      } else if (this.ripe(plot)) {
        const crop = plot.crop; this.give(crop, CROPS[crop].gives); this.give(CROPS[crop].seed, 1);
        s.plots[t.key] = { state: 'tilled' }; s.count.harvested += 1;
        events.push({ type: 'harvest', key: t.key, crop }, { type: 'gain', item: crop, n: CROPS[crop].gives });
      }
    } else if (t.kind === 'node') {
      const n = t.node, def = NODE[n.type];
      const power = (n.type === 'tree' && this.has('axe')) || ((n.type === 'rock' || n.type === 'jade') && this.has('pick')) ? 2 : 1;
      s.hits[n.id] = (s.hits[n.id] || 0) + power;
      events.push({ type: 'hit', node: n });
      this.cooldown = .42;
      if (s.hits[n.id] >= def.hp) {
        delete s.hits[n.id];
        s.depleted[n.id] = now + def.respawn * 1000;
        for (const [item, count] of Object.entries(def.gives)) { this.give(item, count); events.push({ type: 'gain', item, n: count }); }
        events.push({ type: 'deplete', node: n });
      }
    } else if (t.kind === 'build') {
      const { x, z } = t.cell;
      if (this.plotAt(x, z) || Math.hypot(x, z) < 6) { events.push({ type: 'need', text: 'Not here — build outside the village square.' }); return events; }
      const stack = s.builds.filter((b) => b.x === x && b.z === z);
      const stackable = t.item === 'block' || t.item === 'wall' || t.item === 'thatch';
      if (stack.length >= (stackable ? 4 : 1) || (stack.length && !stackable)) { events.push({ type: 'need', text: 'No room there.' }); return events; }
      this.take(t.item);
      const piece = { x, z, y: stack.length, item: t.item };
      s.builds.push(piece);
      events.push({ type: 'place', piece });
    }
    events.push(...this.checkQuest());
    return events;
  }

  /** BREAK: take back the top building piece in front of you. */
  breakPiece() {
    const { x, z } = this.cell();
    const stack = this.s.builds.filter((b) => b.x === x && b.z === z);
    if (!stack.length) return [];
    const top = stack.reduce((a, b) => (b.y > a.y ? b : a));
    this.s.builds.splice(this.s.builds.indexOf(top), 1);
    this.give(top.item);
    return [{ type: 'break', piece: top }];
  }

  // ------------------------------------------------------------ crafting
  canCraft(recipe) { return Object.entries(recipe.needs).every(([item, n]) => this.has(item, n)); }
  craft(id) {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe || !this.canCraft(recipe)) return [{ type: 'need', text: 'You do not have the materials.' }];
    if ((ITEMS[id].tool || ITEMS[id].gear) && this.has(id)) return [{ type: 'need', text: `You already carry a ${ITEMS[id].name}.` }];
    for (const [item, n] of Object.entries(recipe.needs)) this.take(item, n);
    this.give(id, recipe.makes || 1);
    this.s.count.crafted += 1;
    return [{ type: 'craft', item: id, n: recipe.makes || 1 }, ...this.checkQuest()];
  }

  // ------------------------------------------------------------ quests & talk
  checkQuest() { const q = this.quest; return q && this.s.started[q.id] && q.done(this.s) && !this.s.ready ? ((this.s.ready = q.id), [{ type: 'questReady', quest: q }]) : []; }

  talk(npc) {
    const s = this.s, q = this.quest;
    if (q && q.npc === npc.id) {
      if (!s.started[q.id]) { s.started[q.id] = true; return [{ type: 'say', who: npc.name, lines: q.start, quest: q }, ...this.checkQuest()]; }
      if (q.done(s)) {
        for (const [item, n] of Object.entries(q.reward || {})) this.give(item, n);
        s.quest += 1; s.ready = null;
        const next = this.quest;
        const lines = [...q.end];
        if (next && next.npc !== npc.id) lines.push(`Go and speak with ${NPCS.find((n) => n.id === next.npc).name}.`);
        const events = [{ type: 'say', who: npc.name, lines, reward: q.reward, completed: q }];
        if (!next) events.push({ type: 'storyEnd' });
        return events;
      }
      return [{ type: 'say', who: npc.name, lines: [q.goal] }];
    }
    const idle = {
      elder: 'The old road ran from here to the sea. Every court on it was a promise between cities.',
      farmer: 'Maize, beans and squash grow best together. The milpa remembers that even when people forget.',
      trainer: 'Hip, not hand. Hold your strike a breath longer and the ball flies.',
      fisher: 'The river goes down to the cenotes. Strange lights in the water lately.',
      rival: s.wins.rival1 ? 'Next time the wind will be at my back.' : 'I can wait. Courts do not wake for the weak.',
    };
    const lines = [idle[npc.id]];
    if (q) lines.push(`(${NPCS.find((n) => n.id === q.npc).name} is waiting for you.)`);
    return [{ type: 'say', who: npc.name, lines }];
  }

  /** Called when an arena challenge launched from the gate ends. */
  arenaResult(questId, won) {
    if (!won) return [];
    this.s.wins[questId] = true;
    return this.checkQuest();
  }

  /** Equipment and food carried onto the court. Food is used up. */
  matchBuffs(consume = false) {
    const b = { hp: 0, meter: 0, speed: 0, power: 0 };
    if (this.has('ball')) b.power += .08;
    if (this.has('yoke')) b.hp += 30;
    if (this.has('charm')) b.meter += 35;
    if (this.has('tamale')) { b.hp += 25; if (consume) this.take('tamale'); }
    if (this.has('cacao_drink')) { b.speed += .08; if (consume) this.take('cacao_drink'); }
    return b;
  }

  serialize() { return JSON.parse(JSON.stringify(this.s)); }
}

const KEY = 'ssl-adventure';
export function loadSave() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
export function writeSave(adventure) { try { localStorage.setItem(KEY, JSON.stringify(adventure.serialize())); } catch { /* storage full or private mode */ } }
