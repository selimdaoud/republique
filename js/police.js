'use strict';
/* ------------------------------------------------------------------ *
 *  police.js — compagnies de CRS : ligne de boucliers, charges,
 *  interpellations, tirs de lacrymogène, repli.
 * ------------------------------------------------------------------ */

class CRS {
  constructor(squad, x, y) {
    this.id = ++AGENT_ID;
    this.squad = squad;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 0.52;
    this.mass = 2.6;
    this.ang = 0;
    this.stamina = 100;
    this.state = 'line';          // line | charge | escort | hurt
    this.target = null;
    this.escortT = 0;
    this.stagger = 0;
    this.slot = [0, 0];
    this.dead = false;
    this.team = 'crs';
  }
  get charging() { return this.state === 'charge'; }

  /* on lâche la personne qu'on tenait : sans ça elle reste collée à vie */
  release() {
    if (this.target && this.target.state === 'grabbed') {
      this.target.state = 'flee';
      this.target.morale = Math.min(this.target.morale, 25);
      this.target.grabbedBy = null;
    }
    this.target = null;
  }

  hit(power) {
    if (this.state === 'hurt') return;
    this.stamina -= power;
    this.stagger = 0.35;
    this.squad.police.rattle(0.05);
    if (this.stamina <= 0) {
      this.stamina = 0;
      this.release();
      this.state = 'hurt';
      this.squad.wounded++;
      this.squad.police.rattle(0.25);
    }
  }

  update(dt, g) {
    const sq = this.squad;
    let tx, ty, speed = 3.6;

    if (this.state === 'escort') {
      /* walk the detainee back behind the line */
      this.escortT -= dt;
      tx = sq.anchor[0] - Math.cos(sq.ang) * 16;
      ty = sq.anchor[1] - Math.sin(sq.ang) * 16;
      speed = 4;
      if (this.escortT <= 0) {
        if (this.target) { g.crowd.remove(this.target, 'arrest'); this.target.state = 'gone'; }
        this.target = null; this.state = 'line';
      }
    } else if (this.state === 'hurt') {
      this.hurtT = (this.hurtT || 0) + dt;
      speed = 3.9;
      if (sq.canReform(g)) {
        /* on souffle juste derrière sa propre ligne : ces hommes repartiront
           au contact dès que la compagnie se reforme */
        tx = sq.anchor[0] + sq.axis[0] * 7;
        ty = sq.anchor[1] + sq.axis[1] * 7;
        if (this.hurtT > 120) this.dead = true;
      } else {
        /* plus de retour possible : on évacue pour de bon */
        const d = sq.tmp;
        if (!g.map.onPlaza(this.x, this.y) && g.map.fieldDir(g.map.fromPlaza, this.x, this.y, true, d)) {
          tx = this.x + d[0] * 20; ty = this.y + d[1] * 20;
        } else { tx = this.x + sq.axis[0] * 20; ty = this.y + sq.axis[1] * 20; }
        if (g.map.distFromPlaza(this.x, this.y) > 70 || this.hurtT > 35) this.dead = true;
      }
    } else if (this.state === 'charge') {
      this.repick = (this.repick || 0) - dt;
      if (!this.target || this.target.state === 'gone' || this.target.state === 'grabbed' || this.repick <= 0) {
        this.target = sq.pickTarget(this, g);
        this.repick = 0.6;
      }
      if (this.target) {
        tx = this.target.x; ty = this.target.y; speed = 6.8;   // outruns a running protester
        /* une compagnie ne peut pas évacuer dix personnes à la fois : au-delà
           de trois escortes en cours, les autres continuent de charger */
        let escorting = 0;
        for (const u of sq.units) if (u.state === 'escort') escorting++;
        if (escorting < 3 && dist2(this.x, this.y, tx, ty) < 2.9) {
          this.target.state = 'grabbed';
          this.target.grabbedBy = this;
          this.state = 'escort';
          this.escortT = 3.4;
          g.fx.shout(this.x, this.y, 'INTERPELLATION');
        }
      } else { tx = sq.slotOf(this)[0]; ty = sq.slotOf(this)[1]; }
    } else {
      const s = sq.slotOf(this);
      /* léger piétinement : un rang qui tient la position bouge toujours un peu */
      this.idle = (this.idle || RNG() * TAU) + dt * 1.3;
      tx = s[0] + Math.cos(this.idle) * 0.35 + Math.cos(this.idle * 0.7) * 0.2;
      ty = s[1] + Math.sin(this.idle * 1.1) * 0.35;
      speed = sq.pressing ? 3.2 : 4.2;
    }

    let dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 0.3) { dx /= d; dy /= d; } else { dx = 0; dy = 0; }

    /* hold the shoulder-to-shoulder line */
    let sx = 0, sy = 0;
    g.crsBins.near(this.x, this.y, 3, (o) => {
      if (o === this) return;
      const ox = o.x - this.x, oy = o.y - this.y;
      const dd = Math.hypot(ox, oy) || 1;
      if (dd < 1.5) { sx -= ox / dd * (1.5 - dd); sy -= oy / dd * (1.5 - dd); }
    });
    dx += sx * 1.4; dy += sy * 1.4;

    const wp = sq.tmp;
    const push = g.map.wallPush(this.x, this.y, wp);
    if (push) { dx += wp[0] * push * 2.5; dy += wp[1] * push * 2.5; }

    const l = Math.hypot(dx, dy);
    if (l > 0.001) { dx /= l; dy /= l; }
    if (this.stagger > 0) { this.stagger -= dt; speed *= 0.45; }
    speed *= 0.55 + this.stamina / 220;

    this.vx = damp(this.vx, dx * speed, 6, dt);
    this.vy = damp(this.vy, dy * speed, 6, dt);
    this.x += this.vx * dt; this.y += this.vy * dt;

    const face = this.state === 'line' ? sq.ang : Math.atan2(this.vy, this.vx);
    this.ang += angDelta(this.ang, face) * clamp(dt * 6, 0, 1);
  }

  draw(ctx, zoom) {
    ctx.save();
    ctx.translate(this.x, this.y); ctx.rotate(this.ang);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0.3, 0.4, 0.62, 0.52, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = this.state === 'hurt' ? '#4b4f58' : '#1b2430';
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.fill();
    if (zoom > 3) {
      /* shield plate facing the crowd */
      ctx.fillStyle = this.stagger > 0 ? '#9fb6cc' : '#6d7f93';
      ctx.beginPath();
      ctx.arc(0.1, 0, this.r + 0.34, -0.95, 0.95);
      ctx.lineTo(0.1, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#39465a';
      ctx.beginPath(); ctx.arc(0, 0, this.r * 0.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

const BREAK_DIST = 20;     // metres a line may be pushed back before it gives up
const ROUT_DEPTH = 42;     // au-delà, une compagnie battue s'arrête et se regroupe
const MAX_REFORMS = 3;

class Squad {
  constructor(police, id, x, y, ang, size) {
    this.police = police;
    this.id = id;
    this.anchor = [x, y];
    this.hold = [x, y];             // where the line was ordered to stand
    this.axis = [-Math.cos(ang), -Math.sin(ang)];   // points out of the square
    this.mission = 'avancer';       // avancer | disperser | nasser | rout
    this.objective = null;
    this.gain = 0;                  // metres pushed back (negative = ground taken)
    this.ratio = 0;                 // crowd pressure / line strength
    this.ang = ang;                 // faces the square
    this.units = [];
    this.tmp = [0, 0];
    this.state = 'hold';            // hold | press | charge | rout
    this.pressing = false;
    this.gasCd = rr(4, 11);
    this.chargeCd = rr(8, 16);
    this.chargeT = 0;
    this.wounded = 0;
    this.routed = false;
    this.counted = false;        // officially pushed off the square
    this.breaking = 0;
    this.calm = 0;               // seconds without any crowd pressure
    this.routT = 0;              // temps passé en décrochage
    this.deepest = 0;            // point le plus avancé atteint (gain minimal)
    this.huntT = 0;
    this.hunt = null;            // groupe de manifestants pris en chasse
    this.idleT = 0;              // seconds with nobody at all in range
    this.reforms = 0;            // how many times this company came back
    this.luck = 1; this.luckT = 0; this.luckTarget = 1;
    this.pressure = 0;
    for (let i = 0; i < size; i++) {
      const s = this.slotPos(i, size);
      this.units.push(new CRS(this, s[0], s[1]));
    }
  }

  slotPos(i, size) {
    const perRank = Math.ceil(size / 2);
    const rank = i < perRank ? 0 : 1;
    const k = (i % perRank) - (perRank - 1) / 2;
    const nx = -Math.sin(this.ang), ny = Math.cos(this.ang);
    return [
      this.anchor[0] + nx * k * 1.5 - Math.cos(this.ang) * rank * 1.6,
      this.anchor[1] + ny * k * 1.5 - Math.sin(this.ang) * rank * 1.6,
    ];
  }
  slotOf(u) {
    const i = this.units.indexOf(u);
    return this.slotPos(i, this.units.length);
  }

  pickTarget(unit, g) {
    let best = null, bestScore = -1;
    for (const p of g.crowd.list) {
      if (p.state === 'grabbed' || p.state === 'gone') continue;
      const d = Math.hypot(p.x - unit.x, p.y - unit.y);
      if (d > 30) continue;
      /* whoever is out in front, isolated or already shaken */
      const isolation = 6 / (3 + g.bins.count(p.x, p.y, 5));
      const score = isolation * 1.6 + (100 - p.morale) / 70 + (30 - d) / 30 * 2;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  get alive() { return this.units.filter((u) => !u.dead && u.state !== 'hurt').length; }

  /* quel cortège va-t-on disperser ? les compagnies se répartissent sur les
     différents groupes au lieu de converger toutes sur le même */
  pickHunt(g, dt) {
    this.huntT -= dt;
    if (this.huntT > 0 && this.hunt) return this.hunt;
    this.huntT = 3.5;
    const groups = (g.groups || []).filter((x) => x.n > 0);
    if (!groups.length) { this.hunt = null; return null; }
    const scored = groups
      .map((x) => ({ x, s: x.n / (40 + Math.hypot(x.x - this.anchor[0], x.y - this.anchor[1])) }))
      .sort((a, b) => b.s - a.s);
    this.hunt = scored[this.id % scored.length].x;
    return this.hunt;
  }

  /* une compagnie battue peut-elle encore revenir au contact ? */
  canReform(g) {
    return this.reforms < MAX_REFORMS && this.units.length >= 3 && !g.isFreed(this);
  }

  update(dt, g) {
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].dead) this.units.splice(i, 1);
    }
    if (!this.units.length) {
      /* plus personne : la compagnie est hors jeu, sa rue doit s'ouvrir */
      this.counted = true;
      this.routed = true;
      this.mission = 'rout';
      return;
    }

    /* ---- how hard is the crowd leaning on this line? ---- */
    let pressure = 0, cx = 0, cy = 0, n = 0, nNear = 0, nRange = 0;
    for (const p of g.crowd.list) {
      const dx = p.x - this.anchor[0], dy = p.y - this.anchor[1];
      const d = Math.hypot(dx, dy);
      if (d < 62) nRange++;
      if (d < 30) nNear++;
      if (d > 16) continue;
      const front = (dx * Math.cos(this.ang) + dy * Math.sin(this.ang)) / (d || 1);
      if (front < -0.2) continue;                 // behind the shields
      const w = (1 - d / 16) * (0.35 + p.morale / 140) * (p.state === 'push' ? 2.1 : 1);
      pressure += w;
      cx += p.x; cy += p.y; n++;
    }
    /* diminishing returns: only so many people reach the shields, the rest
       push on backs. Past the frontage the extra numbers count logarithmically */
    const cap = this.alive * 1.7 + 3;
    if (pressure > cap) pressure = cap * (1 + Math.log1p((pressure - cap) / cap));
    this.pressure = pressure;

    /* limited uncertainty: a slow ±5 % wobble, enough for upsets,
       not enough to drown the player's decisions */
    this.luckT -= dt;
    if (this.luckT <= 0) { this.luckT = rr(1.5, 3.2); this.luckTarget = rr(0.95, 1.05); }
    this.luck = damp(this.luck, this.luckTarget, 1.4, dt);

    const strength = Math.max(0.8, this.alive * (1.15 + this.avgStamina() / 200) * this.luck);
    /* displayed ratio stays in a readable range */

    /* ---- breathing room: a line nobody is pushing gets its wind back ---- */
    if (pressure < 0.6) this.calm += dt; else this.calm = Math.max(0, this.calm - dt * 2.5);
    this.routT = this.mission === 'rout' ? this.routT + dt : 0;
    if (this.calm > 2) {
      const rate = (this.mission === 'rout' ? 7 : 4.5) * dt;
      for (const u of this.units) {
        if (u.state === 'escort') continue;
        u.stamina = Math.min(100, u.stamina + rate);
      }
    }

    /* a beaten company that is left alone long enough reforms and comes back,
       unless its street has already been freed for good */
    if (this.mission === 'rout' && this.routT > 12 && this.calm > 10 &&
      this.avgStamina() > 45 && this.canReform(g)) {
      this.mission = 'avancer';
      this.state = 'hold';
      this.counted = false;
      this.reforms++;
      this.calm = 0;
      this.breaking = 0;
      this.idleT = 0;
      this.patrolling = false;
      /* la ligne se reconstitue là où elle s'est regroupée : sans ça elle reste
         au-delà de son repère de rupture et se fait re-casser dans la seconde */
      this.hold[0] = this.anchor[0];
      this.hold[1] = this.anchor[1];
      this.gain = 0;
      this.deepest = 0;
      for (const u of this.units) {
        u.hurtT = 0;
        if (u.state === 'hurt') { u.release(); u.state = 'line'; u.stagger = 0; }
      }
      this.police.routed = Math.max(0, this.police.routed - 1);
      g.say('La compagnie ' + this.street + ' s\'est reformée et revient sur la place.', 4.5);
      g.fx.shout(this.anchor[0], this.anchor[1], 'ILS REVIENNENT');
    }

    /* ---- orders ---- */
    this.gasCd = Math.max(-2, this.gasCd - dt);
    this.chargeCd = Math.max(-2, this.chargeCd - dt);
    const outnumbered = pressure > strength * 1.15;

    this.ratio = clamp(pressure / strength, 0, 3);
    this.gain = (this.anchor[0] - this.hold[0]) * this.axis[0] + (this.anchor[1] - this.hold[1]) * this.axis[1];

    /* a company is beaten when it has been physically shoved back past its
       break marker — or when there is nobody left to hold the shields */
    if (this.mission !== 'rout') this.deepest = Math.min(this.deepest, this.gain);
    /* on les casse en les repoussant de 20 m depuis leur point le plus avancé :
       sans ça une compagnie qui a traversé la place serait increvable */
    const pushedBack = this.gain - this.deepest;
    const broken = pushedBack > BREAK_DIST || this.alive <= Math.max(1, this.units.length * 0.25);
    if (broken && this.mission !== 'rout') {
      g.fx.shout(this.anchor[0], this.anchor[1], 'LA LIGNE CÈDE');
      for (const u of this.units) {
        if (u.state === 'escort') continue;       // l'escorte va au bout
        u.release();
        u.state = 'hurt';
      }
      this.mission = 'rout';
      this.state = 'rout';
      this.calm = 0;
      this.routT = 0;
    } else if (this.mission !== 'rout') {
      if (this.state !== 'charge' && outnumbered) this.state = 'give';
      else if (this.state === 'give' && pressure < strength * 0.7) this.state = 'hold';
    }

    if (this.state === 'charge') {
      this.chargeT -= dt;
      if (this.chargeT <= 0) {
        this.state = 'hold';
        for (const u of this.units) if (u.state === 'charge') { u.state = 'line'; u.target = null; }
      }
    } else if (this.chargeCd <= 0 && nNear > 2 && pressure < strength * 2.4 && this.state !== 'rout') {
      /* sortie: a few men break out to grab people at the front */
      this.state = 'charge';
      this.chargeT = rr(6, 10);
      this.chargeCd = rr(8, 15);
      const k = Math.max(2, Math.round(this.alive * 0.5));
      let done = 0;
      for (const u of this.units) {
        if (done >= k) break;
        if (u.state === 'line') { u.state = 'charge'; u.target = null; done++; }
      }
      g.fx.shout(this.anchor[0], this.anchor[1], 'CHARGE');
    }

    /* ---- the anchor itself gives ground or presses forward ---- */
    /* metres per second along the street axis: + = shoved back, - = gaining */
    const alarm = this.police.alarm;
    let back = 0;
    if (this.mission === 'rout') {
      /* on décroche, mais pas jusqu'au bout de la rue : passé la profondeur de
         repli, la compagnie s'arrête, se regroupe et repartira au combat */
      this.regrouping = this.canReform(g) && this.gain > ROUT_DEPTH;
      /* repli borné : au-delà ils sont hors jeu et s'effacent sur place */
      back = (this.regrouping || this.gain > 95) ? 0 : 6.8;
    }
    else if (this.ratio > 1) back = clamp((this.ratio - 1) * 3.3, 0.12, 3.9);
    else if (this.mission === 'disperser') back = -2.4 - alarm * 1.05 + clamp((this.ratio - 0.4) * 1.4, 0, 1.0);
    else if (this.mission === 'nasser') back = 0;
    else {
      /* standing orders: push into the square and disperse. Slow at first,
         much quicker once other companies are being attacked. */
      const pace = 1.8 + alarm * 2.4;
      back = -pace * (1 - clamp(this.ratio / 1.1, 0, 0.9));
    }
    /* l'avance en ligne droite reste bornée ; la chasse, elle, est libre */
    const depth = this.mission === 'disperser' ? 110 : 62;
    if (back < 0 && this.gain < -depth) back = 0;

    /* consigne : vider la place. Sans personne devant eux, ils ne patrouillent
       pas en rond — ils marchent sur le cortège le plus proche. */
    let hunting = null;
    if (this.mission !== 'rout' && this.mission !== 'nasser' && nNear < 4 && pressure < 0.6) {
      hunting = this.pickHunt(g, dt);
    } else { this.hunt = null; this.huntT = 0; }

    this.pressing = back < 0;

    let ax = this.anchor[0] + this.axis[0] * back * dt;
    let ay = this.anchor[1] + this.axis[1] * back * dt;

    /* marche de chasse : on va chercher le cortège là où il est */
    if (hunting) {
      const sp = 2.2 + alarm * 1.8;
      const dx = hunting.x - ax, dy = hunting.y - ay;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 9) {
        let nx = ax + dx / d * sp * dt, ny = ay + dy / d * sp * dt;
        if (!g.map.walkable(nx, ny)) {
          if (g.map.walkable(ax + dx / d * sp * dt, ay)) ny = ay;
          else if (g.map.walkable(ax, ay + dy / d * sp * dt)) nx = ax;
          else { nx = ax; ny = ay; }
        }
        ax = nx; ay = ny;
      }
    }

    /* a kettling company walks to its flanking position instead of holding */
    if (this.mission === 'nasser' && this.objective) {
      const dx = this.objective[0] - ax, dy = this.objective[1] - ay;
      const d = Math.hypot(dx, dy) || 1;
      const sp = clamp(2.25 - this.ratio * 1.35, 0.2, 2.25);
      if (d > 3) { ax += dx / d * sp * dt; ay += dy / d * sp * dt; }
    }

    /* being physically shoved moves the line for good: compare where the
       men actually stand with where their slots say they should be */
    if (this.state !== 'rout') {
      let ux = 0, uy = 0, ex = 0, ey = 0;
      for (let i = 0; i < this.units.length; i++) {
        ux += this.units[i].x; uy += this.units[i].y;
        const s = this.slotPos(i, this.units.length);
        ex += s[0]; ey += s[1];
      }
      const nU = this.units.length;
      /* only men actually shoved backwards count, with a dead zone: without it
         the natural lag of an advancing line cancels its own advance */
      const along = (ux / nU - ex / nU) * this.axis[0] + (uy / nU - ey / nU) * this.axis[1];
      if (along > 0.8) {
        const k = (along - 0.8) * clamp(dt * 2.2, 0, 1);
        ax += this.axis[0] * k; ay += this.axis[1] * k;
      }
    }

    /* once off the esplanade the "away from the square" field has a gradient
       again; inside it is flat, so they simply walk back up their own street */
    if (this.state === 'rout' && !this.regrouping && this.gain < 95 && !g.map.onPlaza(ax, ay)) {
      const d = this.tmp;
      if (g.map.fieldDir(g.map.fromPlaza, ax, ay, true, d)) { ax += d[0] * 5.2 * dt; ay += d[1] * 5.2 * dt; }
    }
    if (g.map.walkable(ax, ay)) { this.anchor[0] = ax; this.anchor[1] = ay; }

    /* keep facing the bulk of the crowd */
    if (this.mission !== 'rout') {
      let want = null;
      if (n > 0) want = Math.atan2(cy / n - this.anchor[1], cx / n - this.anchor[0]);
      else if (this.hunt) want = Math.atan2(this.hunt.y - this.anchor[1], this.hunt.x - this.anchor[0]);
      else if (this.objective) want = Math.atan2(this.objective[1] - this.anchor[1], this.objective[0] - this.anchor[0]);
      if (want !== null) this.ang += angDelta(this.ang, want) * clamp(dt * 1.1, 0, 1);
    }

    /* ---- tear gas ---- */
    if (this.gasCd <= 0 && this.state !== 'rout' && nRange > 6) {
      const target = g.crowd.densestNear(this.anchor[0], this.anchor[1], 62, g.bins);
      if (target) {
        const blind = g.fx.smokeBetween(this.anchor[0], this.anchor[1], target.x, target.y);
        const sx = this.anchor[0] + Math.cos(this.ang) * 1.5;
        const sy = this.anchor[1] + Math.sin(this.ang) * 1.5;
        g.fx.launchGas(sx, sy, target.x + rr(-6, 6) * (1 + blind * 3), target.y + rr(-6, 6) * (1 + blind * 3));
        g.fx.shout(sx, sy, 'LACRYMO');
        this.gasCd = rr(6, 12) * (1 + blind);
      } else this.gasCd = 3;
    }

    for (const u of this.units) u.update(dt, g);

    /* pushed off the square for good */
    if (this.mission === 'rout' &&
      (this.alive === 0 || this.gain > BREAK_DIST + 12 ||
        g.map.distFromPlaza(this.anchor[0], this.anchor[1]) > 45)) {
      this.counted = true;
    }
    /* the last man has left the field: drop the company */
    if (this.counted && !this.units.length) this.routed = true;
  }

  get intent() {
    if (this.mission === 'rout') return this.regrouping ? 'SE REGROUPE' : 'DÉCROCHE';
    if (this.state === 'charge') return 'CHARGE';
    if (this.mission === 'disperser') return 'BALAIE';
    if (this.mission === 'nasser') return 'NASSE';
    if (this.ratio > 1) return 'RECULE';
    if (this.ratio > 0.75) return 'TIENT';
    if (this.hunt) return 'EN CHASSE';
    return 'AVANCE';
  }

  avgStamina() {
    let s = 0;
    for (const u of this.units) s += u.stamina;
    return this.units.length ? s / this.units.length : 0;
  }

  draw(ctx, zoom) {
    for (const u of this.units) u.draw(ctx, zoom);
  }
}

/* renfort lourd : arrive par une rue, repousse la foule au jet, se replie
   quand il a pris trop de projectiles */
class WaterCannon {
  constructor(street, target) {
    this.id = ++AGENT_ID;
    this.street = street;
    this.team = 'crs';
    this.vehicle = true;
    this.state = 'approach';     // approach | spray | withdraw
    this.r = 2.4;
    this.hp = 120;
    this.spray = 0;
    this.stamina = 100;
    this.dead = false;
    this.gone = false;
    const L = Math.hypot(street.ex - street.sx, street.ey - street.sy) || 1;
    this.dir = [(street.ex - street.sx) / L, (street.ey - street.sy) / L];
    this.x = lerp(street.sx, street.ex, 0.55);
    this.y = lerp(street.sy, street.ey, 0.55);
    this.ang = Math.atan2(target[1] - this.y, target[0] - this.x);
  }
  hit(power) {
    if (this.state === 'withdraw') return;
    this.hp -= power;
    if (this.hp <= 0) { this.state = 'withdraw'; this.hp = 0; }
  }
  update(dt, g) {
    /* aim at the body of the crowd in front of it, and ignore stragglers:
       contact is a group within range, not one person passing by */
    let near30 = 0, near36 = 0, close = 0, ax = 0, ay = 0, seen = 0;
    g.bins.near(this.x, this.y, 46, (p) => {
      const d2 = dist2(p.x, p.y, this.x, this.y);
      if (d2 > 46 * 46) return;
      if (d2 < 30 * 30) near30++;
      if (d2 < 36 * 36) near36++;
      if (d2 < 11 * 11) close++;
      const w = 1 / (1 + Math.sqrt(d2) / 20);
      ax += p.x * w; ay += p.y * w; seen += w;
    });
    const tx = seen ? ax / seen : g.stats.cx;
    const ty = seen ? ay / seen : g.stats.cy;

    /* hysteresis: start spraying on a group of 8, stop only below 4 */
    const spraying = this.state === 'spray' ? near36 >= 4 : near30 >= 8;

    let mx = 0, my = 0, speed = 0;
    if (this.state === 'withdraw') {
      mx = this.dir[0]; my = this.dir[1]; speed = 10.5;
      if (g.map.distFromPlaza(this.x, this.y) > 120) this.gone = true;
    } else if (!spraying) {
      const dir = [0, 0];
      if (g.map.fieldDir(g.map.cost, this.x, this.y, false, dir)) { mx = dir[0]; my = dir[1]; }
      else {
        const d = Math.hypot(tx - this.x, ty - this.y) || 1;
        mx = (tx - this.x) / d; my = (ty - this.y) / d;
      }
      speed = 8.2;
      this.state = 'approach';
    } else if (close > 3) {
      const d = Math.hypot(tx - this.x, ty - this.y) || 1;
      mx = -(tx - this.x) / d; my = -(ty - this.y) / d; speed = 4.8;
      this.state = 'spray';
    } else {
      this.state = 'spray';
    }

    /* keep off the facades, and slide along them instead of jamming */
    let vx = mx * speed, vy = my * speed;
    const push = [0, 0];
    const pf = g.map.wallPush(this.x, this.y, push);
    if (pf) { vx += push[0] * speed * pf; vy += push[1] * speed * pf; }
    let nx = this.x + vx * dt, ny = this.y + vy * dt;
    if (!g.map.walkable(nx, ny)) {
      if (g.map.walkable(this.x + vx * dt, this.y)) ny = this.y;
      else if (g.map.walkable(this.x, this.y + vy * dt)) nx = this.x;
      else { nx = this.x; ny = this.y; }
    }
    this.x = nx; this.y = ny;

    const want = Math.atan2(ty - this.y, tx - this.x);
    this.ang += angDelta(this.ang, want) * clamp(dt * 1.6, 0, 1);

    /* the jet */
    this.spray = damp(this.spray, this.state === 'spray' ? 1 : 0, 3, dt);
    if (this.spray > 0.25) {
      const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
      const jet = (p) => {
        const dx = p.x - this.x, dy = p.y - this.y;
        const dd = Math.hypot(dx, dy) || 1;
        if (dd > 36) return;
        if ((dx * ca + dy * sa) / dd < 0.9) return;        // outside the jet
        const k = (1 - dd / 36) * this.spray;
        p.vx += dx / dd * 16 * k * dt * 10;
        p.vy += dy / dd * 16 * k * dt * 10;
        if (p.team === 'civil') { p.panic = Math.min(1.6, p.panic + k * dt * 3); return; }
        p.morale = clamp(p.morale - 20 * k * dt, 0, 100);
        p.wet = 1;
      };
      g.bins.near(this.x, this.y, 40, jet);
      g.civBins.near(this.x, this.y, 40, jet);
      if (Math.random() < dt * 14) {
        const a = this.ang + rr(-0.12, 0.12);
        g.fx.burst(this.x + Math.cos(a) * 12, this.y + Math.sin(a) * 12, 2, [190, 215, 235], 9);
      }
    }
  }
  draw(ctx, zoom) {
    ctx.save();
    ctx.translate(this.x, this.y); ctx.rotate(this.ang);
    if (this.spray > 0.2) {
      const g2 = ctx.createRadialGradient(0, 0, 2, 0, 0, 36);
      g2.addColorStop(0, 'rgba(200,225,245,' + (0.5 * this.spray).toFixed(2) + ')');
      g2.addColorStop(1, 'rgba(200,225,245,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.arc(0, 0, 36, -0.45, 0.45); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-4.5, -2.2, 10, 4.6);
    ctx.fillStyle = this.state === 'withdraw' ? '#4a5260' : '#2b3647';
    ctx.fillRect(-5, -2.5, 10, 5);
    ctx.fillStyle = '#5b6b80';
    ctx.fillRect(1.5, -1.6, 3.5, 3.2);
    ctx.fillStyle = '#93a9c0';
    ctx.fillRect(4.5, -0.5, 2.5, 1);
    if (zoom > 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-5, 2, 10 * clamp(this.hp / 120, 0, 1), 0.8);
    }
    ctx.restore();
  }
}

const PHASES = {
  AVANCER: 'Avancer — les compagnies progressent pour disperser le cortège',
  DISPERSER: 'Disperser — elles balaient la place et chargent',
  NASSER: 'Nasser — elles manœuvrent pour encercler le cortège',
};

class Police {
  constructor(game) {
    this.g = game;
    this.squads = [];
    this.routed = 0;
    this.companies = 0;
    this.t = 0;
    this.phase = 'AVANCER';
    this.alarm = 0;
    this.shock = 0;
    this.objT = 0;
    this.cannons = [];
    this.cannonCd = 45;
  }

  deploy(companies, perCompany, map) {
    this.companies = companies;
    this.perCompany = perCompany;
    /* one company per major street mouth, facing the monument */
    const order = [6, 8, 5, 9, 0, 2, 3, 7, 10, 11, 1, 4];
    const c = map.centre;
    for (let i = 0; i < companies; i++) {
      const s = map.streets[order[i % order.length]];
      const mx = lerp(s.mouth[0], s.ex, 0.035), my = lerp(s.mouth[1], s.ey, 0.035);
      const ang = Math.atan2(c[1] - my, c[0] - mx);
      const sq = new Squad(this, i, mx, my, ang, perCompany);
      sq.street = s.name;                 // exact, unlike guessing from position
      sq.streetRef = s;
      this.squads.push(sq);
    }
  }

  get units() {
    let n = 0;
    for (const s of this.squads) n += s.alive;
    return n;
  }
  get hasCannon() { return this.cannons.some((c) => c.state !== 'withdraw'); }
  get onPlaza() {
    let n = 0;
    for (const s of this.squads) {
      for (const u of s.units) if (this.g.map.onPlaza(u.x, u.y)) n++;
    }
    return n;
  }

  nearestTo(x, y, radius) {
    let best = null, bd = radius * radius;
    for (const c of this.cannons) {
      if (c.state === 'withdraw') continue;
      const d = dist2(c.x, c.y, x, y);
      if (d < bd) { bd = d; best = c; }
    }
    for (const s of this.squads) {
      for (const u of s.units) {
        if (u.state === 'hurt') continue;
        const d = dist2(u.x, u.y, x, y);
        if (d < bd) { bd = d; best = u; }
      }
    }
    return best;
  }

  /* an alarm level shared by the whole operation: when one line is attacked,
     the others pick up the pace */
  updateAlarm(dt) {
    let engaged = 0;
    for (const s of this.squads) {
      if (s.mission === 'rout') continue;
      if (s.ratio > 0.45) engaged++;
    }
    /* la préfecture s'impatiente : le seuil d'alerte monte tout seul avec le temps */
    const impatience = clamp((this.t - 60) / 420, 0, 0.35);
    const target = clamp(engaged / Math.max(1, this.companies) * 1.25 + this.shock + impatience, 0, 1);
    this.alarm = damp(this.alarm, target, target > this.alarm ? 2.2 : 0.35, dt);
    this.shock = Math.max(0, (this.shock || 0) - dt * 0.35);
  }

  /* called when a man goes down or takes a projectile */
  rattle(amount) { this.shock = clamp((this.shock || 0) + amount, 0, 0.8); }

  /* the operation escalates: press, then sweep, then kettle */
  escalate(dt) {
    const g = this.g;
    this.t += dt;
    const live = this.squads.filter((s) => s.mission !== 'rout');

    if (this.phase === 'AVANCER' && (this.t > 140 || g.freedCount >= 1)) {
      this.phase = 'DISPERSER';
      const pick = live.slice().sort((a, b) => b.alive - a.alive).slice(0, Math.max(1, Math.floor(live.length / 2)));
      for (const sq of pick) { sq.mission = 'disperser'; sq.objective = [g.map.centre[0], g.map.centre[1]]; }
      g.say('ORDRE : les compagnies ' + pick.map((s) => s.street).join(' et ') + ' avancent pour dégager la place.', 5);
    } else if (this.phase === 'DISPERSER' &&
      (this.t > 320 || g.crowd.count < g.crowd.start * 0.6 || g.freedCount >= Math.ceil(this.companies / 2))) {
      this.phase = 'NASSER';
      const pick = live.slice(0, 2);
      for (const sq of pick) sq.mission = 'nasser';
      g.say('ORDRE : manœuvre d\'encerclement, ils veulent couper le cortège en deux.', 5);
    }

    /* kettling companies keep aiming at the flanks of the crowd */
    this.objT -= dt;
    if (this.objT <= 0) {
      this.objT = 2.5;
      const kett = this.squads.filter((s) => s.mission === 'nasser');
      kett.forEach((sq, i) => {
        const cx = g.stats.cx, cy = g.stats.cy;
        const a = Math.atan2(cy - g.map.centre[1], cx - g.map.centre[0]) + (i % 2 ? 1.5 : -1.5);
        sq.objective = [cx + Math.cos(a) * 34, cy + Math.sin(a) * 34];
      });
    }
  }

  /* heavy reinforcement once the crowd starts winning: up to two, and the
     second one comes in from the opposite side of the square */
  callCannon(dt) {
    const g = this.g;
    this.cannonCd -= dt;
    for (let i = this.cannons.length - 1; i >= 0; i--) {
      const c = this.cannons[i];
      c.update(dt, g);
      if (c.gone) {
        this.cannons.splice(i, 1);
        this.cannonCd = Math.max(this.cannonCd, 70);
        g.say('Un canon à eau se replie.', 3.5);
      }
    }
    if (this.cannons.length >= 2 || this.cannonCd > 0) return;
    if (this.phase === 'AVANCER' || g.freedCount < 1) return;

    const c0 = g.map.centre;
    const taken = this.cannons.map((c) => Math.atan2(c.y - c0[1], c.x - c0[0]));
    let street = null, best = -1;
    for (const m of g.mouths) {
      if (m.freed || !m.squad || !m.squad.streetRef) continue;
      const a = Math.atan2(m.y - c0[1], m.x - c0[0]);
      /* first one: closest to the crowd. second one: as opposite as possible */
      let score;
      if (!taken.length) score = 400 - Math.sqrt(dist2(m.x, m.y, g.stats.cx, g.stats.cy));
      else score = Math.abs(angNorm(a - taken[0])) * 100;
      if (score > best) { best = score; street = m.squad.streetRef; }
    }
    if (!street) return;
    this.cannons.push(new WaterCannon(street, [g.stats.cx, g.stats.cy]));
    this.cannonCd = 95;
    g.say('Un canon à eau remonte ' + street.name + '. Dispersez-vous ou coupez-lui la route.', 5);
  }

  update(dt) {
    this.updateAlarm(dt);
    this.escalate(dt);
    this.callCannon(dt);
    for (let i = this.squads.length - 1; i >= 0; i--) {
      const s = this.squads[i];
      const was = s.counted;
      s.update(dt, this.g);
      if (s.counted && !was) {
        this.routed++;
        this.g.say('Une compagnie décroche par ' + (s.street || this.g.map.nearestStreet(s.anchor[0], s.anchor[1])) + '.', 3.5);
      }
      if (s.routed) this.squads.splice(i, 1);
    }
  }

  /* companies still contesting the square */
  get holding() {
    let n = 0;
    for (const s of this.squads) if (!s.counted) n++;
    return n;
  }

  each(fn) {
    for (const s of this.squads) for (const u of s.units) fn(u);
    for (const c of this.cannons) fn(c);
  }
  draw(ctx, zoom) {
    for (const s of this.squads) s.draw(ctx, zoom);
    for (const c of this.cannons) c.draw(ctx, zoom);
  }
}
