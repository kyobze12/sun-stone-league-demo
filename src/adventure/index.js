// The Lost Courts: glue between the Adventure rules, its 3D view and the
// on-screen interface (quest tracker, inventory, prompts, dialogue, crafting).
import { Adventure, loadSave, writeSave } from './state.js';
import { AdventureView } from './view.js';
import { ITEMS, RECIPES, QUESTS } from './data.js';

const $ = (id) => document.getElementById(id);

export class AdventureMode {
  /** @param hooks { audio, launchArena(config, questId, buffs), exit() } */
  constructor(hooks) {
    this.hooks = hooks;
    this.adv = null; this.view = null; this.active = false;
    this.dialog = null; this.prev = {}; this.saveTimer = 0; this.toastTimer = null;
    $('adv-next').addEventListener('click', () => this.advanceDialog());
    $('adv-craft-close').addEventListener('click', () => this.showCraft(false));
    $('adv-reset').addEventListener('click', () => { if (confirm('Start the story over? Your settlement and items will be lost.')) { this.adv = new Adventure(null); writeSave(this.adv); this.rebuild(); this.showCraft(false); } });
  }

  start(lookId) {
    this.lookId = lookId;
    if (!this.adv) this.adv = new Adventure(loadSave());
    this.rebuild();
    this.active = true;
    $('adv-hud').classList.remove('hidden');
    this.refresh(true);
    if (!this.adv.s.started.wake) this.toast('Find Ixmucane, the elder — follow the gold “!”');
  }

  rebuild() { this.view = new AdventureView(this.adv, this.lookId); this.refresh(true); }
  stop() { if (this.adv) writeSave(this.adv); this.active = false; this.dialog = null; for (const id of ['adv-hud', 'adv-dialog', 'adv-meter']) $(id).classList.add('hidden'); $('adv-craft').classList.remove('show'); }
  get scene() { return this.view?.scene; }
  get blocked() { return !!this.dialog || $('adv-craft').classList.contains('show'); }

  // ------------------------------------------------------------ frame
  update(dt, input, camera) {
    const a = this.adv;
    const edge = (key) => input[key] && !this.prev[key];
    const events = [];
    if (this.blocked) { if (this.dialog && edge('strike')) this.advanceDialog(); a.update(dt, {}); }
    else {
      events.push(...a.update(dt, input));
      if (edge('strike')) events.push(...a.act());
      if (edge('lob')) { const held = a.cycle(); this.toast(held ? `Holding: ${ITEMS[held].name}` : 'Nothing to hold yet — craft building pieces or find seeds.'); }
      if (edge('tackle')) this.showCraft(true);
      if (edge('guard')) events.push(...a.breakPiece());
    }
    this.prev = { strike: input.strike, lob: input.lob, tackle: input.tackle, guard: input.guard };
    this.handle(events);
    const target = this.blocked ? null : a.target();
    this.view.sync();
    this.view.update(dt, camera, target);
    $('adv-prompt').textContent = target ? target.label : '';
    $('adv-prompt').classList.toggle('hidden', !target);
    const m = $('adv-meter'); m.classList.toggle('hidden', !a.toss);
    if (a.toss) $('adv-meter-mark').style.left = `${a.tossMeter() * 100}%`;
    this.saveTimer += dt; if (this.saveTimer > 8) { this.saveTimer = 0; writeSave(a); }
  }

  handle(events) {
    const { audio } = this.hooks;
    let dirty = false;
    for (const e of events) {
      dirty = true;
      switch (e.type) {
        case 'say': this.say(e.who, e.lines, e); break;
        case 'gain': this.toast(`+${e.n} ${ITEMS[e.item].icon} ${ITEMS[e.item].name}`); audio.tone(660, .08, 'triangle', .05); break;
        case 'hit': audio.tone(150, .06, 'square', .05); break;
        case 'need': case 'fishMiss': this.toast(e.text); break;
        case 'till': audio.tone(120, .1, 'sawtooth', .04); break;
        case 'plant': this.toast(`Planted ${e.crop}.`); break;
        case 'place': audio.tone(200, .08, 'square', .05); break;
        case 'break': this.toast(`Took back ${ITEMS[e.piece.item].name}.`); break;
        case 'craft': this.toast(`Crafted ${ITEMS[e.item].icon} ${ITEMS[e.item].name}${e.n > 1 ? ' ×' + e.n : ''}`); audio.tone(880, .12, 'triangle', .06); this.renderCraft(); break;
        case 'fishCast': this.toast('Line cast. Wait for the float to dip…'); break;
        case 'fishBite': audio.tone(990, .1, 'square', .06); break;
        case 'tossStart': this.toast('Press USE when the marker is on the gold.'); break;
        case 'tossThrow': audio.tone(e.hit ? 880 : 180, .1, e.hit ? 'triangle' : 'sawtooth', .06); break;
        case 'tossEnd': this.toast(e.text); break;
        case 'openCraft': this.showCraft(true); break;
        case 'questReady': this.toast(`✔ ${e.quest.title} — return to the quest giver.`); audio.tone(740, .2, 'triangle', .06); break;
        case 'openArena': writeSave(this.adv); this.hooks.launchArena(e.config, e.quest, this.adv.matchBuffs(true)); break;
        case 'storyEnd': this.toast('THE LEAGUE IS AWAKE — the story is complete. The world is yours.'); break;
        default: break;
      }
    }
    if (dirty) this.refresh();
  }

  // ------------------------------------------------------------ interface
  toast(text) {
    const el = $('adv-toast'); el.textContent = text; el.classList.add('show');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  say(who, lines, extra = {}) {
    this.dialog = { who, lines: [...lines], i: 0, reward: extra.reward };
    $('adv-dialog').classList.remove('hidden');
    this.renderDialog();
  }
  renderDialog() {
    const d = this.dialog; $('adv-who').textContent = d.who; $('adv-line').textContent = d.lines[d.i];
    const last = d.i === d.lines.length - 1;
    $('adv-reward').textContent = last && d.reward ? 'Received: ' + Object.entries(d.reward).map(([item, n]) => item === 'fragment' ? '☀ Sun-Stone fragment' : `${n} ${ITEMS[item].name}`).join(', ') : '';
    $('adv-next').textContent = last ? 'Close' : 'Next ›';
  }
  advanceDialog() {
    if (!this.dialog) return;
    if (++this.dialog.i >= this.dialog.lines.length) { this.dialog = null; $('adv-dialog').classList.add('hidden'); this.refresh(); }
    else this.renderDialog();
  }

  showCraft(open) { $('adv-craft').classList.toggle('show', open); if (open) this.renderCraft(); }
  renderCraft() {
    const a = this.adv;
    $('adv-recipes').innerHTML = RECIPES.map((r) => {
      const needs = Object.entries(r.needs).map(([item, n]) => `<span class="${a.has(item, n) ? 'ok' : 'no'}">${ITEMS[item].icon}${n}</span>`).join(' ');
      return `<button class="recipe" data-id="${r.id}" ${a.canCraft(r) ? '' : 'disabled'}><strong>${ITEMS[r.id].icon} ${ITEMS[r.id].name}${r.makes ? ' ×' + r.makes : ''}</strong><em>${needs}</em><span>${r.note}</span></button>`;
    }).join('');
    $('adv-recipes').querySelectorAll('.recipe').forEach((b) => b.addEventListener('click', () => { this.handle(this.adv.craft(b.dataset.id)); }));
  }

  refresh() {
    const a = this.adv, s = a.s;
    const order = ['wood', 'stone', 'fiber', 'clay', 'rubber', 'jade', 'maize', 'beans', 'cacao', 'fish', 'tamale', 'cacao_drink'];
    $('adv-inv').innerHTML = (s.fragments ? `<span class="chip sun">☀ ${s.fragments}/5</span>` : '') + order.filter((id) => s.inv[id]).map((id) => `<span class="chip">${ITEMS[id].icon} ${s.inv[id]}</span>`).join('')
      + ['axe', 'pick', 'ball', 'yoke', 'charm'].filter((id) => s.inv[id]).map((id) => `<span class="chip gear">${ITEMS[id].icon}</span>`).join('');
    const q = a.quest;
    $('adv-quest-title').textContent = q ? `Chapter ${q.chapter} · ${q.title}` : 'The league is awake';
    $('adv-quest-goal').textContent = q ? (s.started[q.id] ? (q.done(s) ? '✔ Done — report back.' : q.goal) : `Speak with ${a.constructor.npcName(q.npc)}.`) : 'Explore, farm and build freely.';
    const held = a.held;
    $('adv-held').textContent = held ? `${ITEMS[held].icon} ${ITEMS[held].name} ×${s.inv[held]}` : '—';
  }

  /** The arena challenge launched from the gate has ended. */
  arenaResult(questId, won) { this.handle(this.adv.arenaResult(questId, won)); writeSave(this.adv); }
}
