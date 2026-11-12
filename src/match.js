import { MODES, POINTS, OTHER_TEAM, DUEL } from './config.js';
import { ringFor } from './ball.js';

/**
 * Match rules on top of the World: score keeping, clock, sudden death, ring
 * hunt combos and the goal/reset flow. Produces presentation events.
 */
export class Match {
  constructor(mode, world, trial = null) {
    this.mode = mode;
    this.trial = trial;
    const base = MODES[mode];
    // A trial reshapes the mode's clock and goal.
    this.def = trial ? { ...base, duration: trial.duration ?? base.duration, target: trial.rounds ?? trial.target ?? base.target } : base;
    this.world = world;
    this.score = { balam: 0, kuk: 0 };
    this.timeLeft = this.def.duration;
    this.phase = 'countdown';
    this.countdown = 3;
    this.goalTimer = 0;
    this.suddenDeath = false;
    this.winner = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.rings = 0;
    this.best = 0;
    this.lastScoreTeam = null;
    this.serveSide = 0;
    this.scoreTimeScale = 1;
    this.stats = { strikes: 0, rings: 0, tackles: 0, longestCombo: 0, hits: 0, kos: 0 };
    this.duel = mode === 'duel';
    this.round = 1;
  }

  get timed() { return this.def.duration > 0; }
  get hasTarget() { return this.def.target > 0; }
  get playing() { return this.phase === 'playing'; }

  /** Advance the match. Returns presentation events. */
  update(dt, worldEvents) {
    const events = [];
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = 'playing'; events.push({ type: 'play' }); }
      return events;
    }
    if (this.phase === 'goal') {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) {
        if (this.winner) { this.phase = 'ended'; events.push({ type: 'ended', winner: this.winner }); }
        else if (this.duel) {
          this.round += 1;
          this.world.resetRound(); this.world.frozen = false;
          this.timeLeft = this.def.duration;
          this.phase = 'countdown'; this.countdown = 2;
          events.push({ type: 'round', round: this.round });
        } else { this.world.resetPositions(this.serveSide); this.world.frozen = false; this.phase = 'playing'; events.push({ type: 'resume' }); }
      }
      return events;
    }
    if (this.phase !== 'playing') return events;

    if (this.duel) return this.updateDuel(dt, worldEvents, events);
    if (this.timed) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft === 0) {
        if (this.mode === 'ringhunt') return this.finish(events, this.trial?.goalRings ? 'kuk' : 'balam');
        if (this.score.balam !== this.score.kuk) return this.finish(events, this.score.balam > this.score.kuk ? 'balam' : 'kuk');
        if (!this.suddenDeath) { this.suddenDeath = true; events.push({ type: 'suddenDeath' }); }
      }
    }
    if (this.mode === 'ringhunt' && this.combo > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) { this.combo = 0; events.push({ type: 'comboEnd' }); } }

    for (const event of worldEvents) {
      if (event.type === 'strike') this.stats.strikes += 1;
      if (event.type === 'tackle') this.stats.tackles += 1;
      if (event.type === 'ring') this.onRing(event, events);
      else if (event.type === 'backline') this.onBackline(event, events);
      else if (event.type === 'doubleBounce') this.onDoubleBounce(event, events);
    }
    return events;
  }

  // ------------------------------------------------------------ duel rounds
  updateDuel(dt, worldEvents, events) {
    const world = this.world;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const event of worldEvents) {
      if (event.type === 'strike') this.stats.strikes += 1;
      if (event.type === 'tackle') this.stats.tackles += 1;
      if (event.type === 'hit' && event.damage > 0) this.stats.hits += 1;
      if (event.type === 'ring') {
        // Threading the rival's ring is the Sun-Stone finisher: a crushing blow
        // to whoever defends it, wherever they stand.
        world.ball.scored = false; world.ball.pendingPass[event.ring.id] = 0;
        const victim = world.players.find((p) => p.team === event.ring.defender);
        const attacker = world.players.find((p) => p.team !== event.ring.defender);
        this.stats.rings += 1;
        events.push({ type: 'sunRing', team: attacker?.team, ringSide: event.ring.side });
        if (victim) world.damage(victim, DUEL.ringDamage, attacker, worldEvents, { kind: 'ring', stun: 1 });
        const ko = worldEvents.find((e) => e.type === 'ko');
        if (ko) { this.stats.kos += 1; return this.roundOver(ko.player?.team || attacker.team, 'ko', events); }
      } else if (event.type === 'backline' || event.type === 'doubleBounce') {
        world.ball.scored = false;   // no line calls in a duel; the ball stays live
      } else if (event.type === 'ko') {
        this.stats.kos += 1;
        return this.roundOver(event.player?.team || OTHER_TEAM[event.victim.team], 'ko', events);
      }
    }
    if (this.timeLeft === 0) {
      const [a, b] = world.players;
      if (this.trial?.survive) return this.roundOver(a.hp > 0 ? a.team : b.team, 'time', events);
      const winner = a.hp === b.hp ? null : (a.hp > b.hp ? a.team : b.team);
      return this.roundOver(winner, 'time', events);
    }
    return events;
  }

  roundOver(team, how, events) {
    if (team) this.score[team] += 1;
    else { this.score.balam += 1; this.score.kuk += 1; }   // a draw scores for both
    const target = this.def.target;
    if (this.score.balam >= target || this.score.kuk >= target) {
      this.winner = this.score.balam === this.score.kuk ? (team || 'balam') : (this.score.balam > this.score.kuk ? 'balam' : 'kuk');
    }
    this.phase = 'goal';
    this.world.frozen = how !== 'ko';     // a KO plays out the fall
    this.goalTimer = how === 'ko' ? 3 : 2.2;
    this.lastScoreTeam = team;
    events.push({ type: 'roundOver', team, how, round: this.round, score: { ...this.score }, winner: this.winner });
    return events;
  }

  onRing(event, events) {
    const world = this.world;
    if (this.mode === 'ringhunt') {
      const lit = world.litRing === event.ring.id;
      if (!lit) { world.ball.scored = false; world.ball.pendingPass[event.ring.id] = 0; events.push({ type: 'callout', text: 'WRONG RING — HIT THE LIT ONE', kind: 'muted' }); return; }
      this.combo += 1; this.comboTimer = 9; this.stats.longestCombo = Math.max(this.stats.longestCombo, this.combo);
      const points = Math.min(this.combo, 4);
      this.score.balam += points; this.rings += 1; this.stats.rings += 1;
      world.litRing = world.litRing === 'north' ? 'south' : 'north';
      this.serveSide = 0;
      this.goal({ team: 'balam', points, kind: 'ring', combo: this.combo }, events);
      if (this.trial?.goalRings && this.rings >= this.trial.goalRings) { this.winner = 'balam'; }
      return;
    }
    if (this.mode === 'practice') {
      this.rings += 1; this.score.balam += POINTS.ring; this.stats.rings += 1;
      this.goal({ team: 'balam', points: POINTS.ring, kind: 'ring' }, events);
      return;
    }
    // Rings are only "live" for the attacking team; an own-ring counts for the attacker anyway.
    const scorer = OTHER_TEAM[event.ring.defender];
    this.stats.rings += 1;
    this.award(scorer, POINTS.ring, 'ring', events);
  }

  onBackline(event, events) {
    const defender = ringFor(event.side).defender;
    if (this.mode === 'ringhunt' || this.mode === 'practice') { this.world.ball.scored = false; return; }
    this.award(OTHER_TEAM[defender], POINTS.backline, 'backline', events);
  }

  onDoubleBounce(event, events) {
    if (this.mode === 'ringhunt' || this.mode === 'practice') return;
    const defender = ringFor(event.side).defender;
    this.world.ball.scored = true;
    this.award(OTHER_TEAM[defender], POINTS.doubleBounce, 'doubleBounce', events);
  }

  award(team, points, kind, events) {
    this.score[team] += points;
    this.serveSide = team === 'balam' ? 1 : -1; // loser serves from their own half
    this.goal({ team, points, kind }, events);
  }

  goal(info, events) {
    this.phase = 'goal';
    this.world.frozen = true;
    this.lastScoreTeam = info.team;
    const bigMoment = info.kind === 'ring';
    this.goalTimer = bigMoment ? 2.4 : 1.4;
    if (this.hasTarget && this.score[info.team] >= this.def.target) this.winner = info.team;
    else if (this.suddenDeath && this.mode !== 'ringhunt') this.winner = info.team;
    events.push({ type: 'score', ...info, score: { ...this.score }, winner: this.winner });
  }

  finish(events, winner) {
    this.phase = 'goal'; this.goalTimer = .3; this.winner = winner; this.world.frozen = true;
    return events;
  }

  snapshot() {
    return { score: { ...this.score }, timeLeft: this.timeLeft, phase: this.phase, countdown: this.countdown, suddenDeath: this.suddenDeath, winner: this.winner, combo: this.combo, comboTimer: this.comboTimer, round: this.round };
  }
  applySnapshot(s) { Object.assign(this.score, s.score); this.timeLeft = s.timeLeft; this.phase = s.phase; this.countdown = s.countdown; this.suddenDeath = s.suddenDeath; this.winner = s.winner; this.combo = s.combo; this.comboTimer = s.comboTimer; if (s.round) this.round = s.round; }
}
