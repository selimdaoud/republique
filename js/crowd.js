'use strict';
/* ------------------------------------------------------------------ *
 *  crowd.js — les manifestants : flux, cohésion, détermination, peur
 * ------------------------------------------------------------------ */

const CLOTHES = ['#2f3a4d', '#4a4f58', '#7a3b36', '#2d5a4a', '#6b5a35', '#3f3a52',
  '#8a8375', '#334a66', '#5c3550', '#d8c24a', '#44505c'];
const FLAGS = ['#c23b32', '#1f1f24', '#2f7a46', '#2f5fa8', '#d8a62a'];
const SKIN = ['#d8b291', '#a87350', '#f0cfae', '#6f4a33', '#c89670'];

const WALK = 2.25, RUN = 5.1;
const SCRATCH = [];        // tampon de voisinage réutilisé   // +50 % : la manif se joue au rythme de la rue

class Protester {
  constructor(x, y) {
    this.id = ++AGENT_ID;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 0.42;
    this.mass = 1;
    this.morale = rr(55, 95);
    this.stamina = rr(70, 100);
    this.gas = 0;                 // exposure 0..1
    this.state = 'march';         // march | push | flee | grabbed
    this.grabbedBy = null;
    this.col = pick(CLOTHES);
    this.skin = pick(SKIN);
    this.flag = chance(0.14) ? pick(FLAGS) : null;
    this.sign = !this.flag && chance(0.1);
    this.phase = RNG() * TAU;
    this.throwCd = rr(5, 20);
    this.wet = 0;
    this.stun = 0;
    this.group = 0;            // quelle cible on suit
    this.bold = rr(0.6, 1.4);     // how far forward this one is willing to go
    this.team = 'crowd';
  }

  get running() { return (this.state === 'flee' || this.state === 'push') && this.stun <= 0; }

  update(dt, g) {
    if (this.state === 'grabbed') {
      const c = this.grabbedBy;
      /* on se dégage dès que celui qui nous tient n'escorte plus vraiment :
         mis hors de combat, reformé, mort, ou qui a changé de cible */
      this.heldT = (this.heldT || 0) + dt;
      const held = c && !c.dead && c.state === 'escort' && c.target === this;
      if (!held || this.heldT > 9) {
        if (c && c.target === this) c.target = null;
        this.state = 'flee';
        this.morale = Math.min(this.morale, 25);
        this.grabbedBy = null;
        this.heldT = 0;
        return;
      }
      this.x = c.x - Math.cos(c.ang) * 1.2;
      this.y = c.y - Math.sin(c.ang) * 1.2;
      return;
    }
    this.heldT = 0;

    const map = g.map, crowd = g.crowd;
    let ax = 0, ay = 0;

    /* --- follow the flow field toward the player's rally point --- */
    const dir = crowd.tmp;
    const gi = clamp(this.group | 0, 0, map.fields.length - 1);
    const field = (g.rallies && gi < g.rallies.length) ? map.fields[gi] : map.fields[0];
    if (map.fieldDir(field, this.x, this.y, false, dir)) {
      /* the pull of the march has to stay stronger than the pull of the group,
         otherwise the crowd balls up and never advances */
      const w = this.state === 'flee' ? 0.15 : 2.4;
      ax += dir[0] * w; ay += dir[1] * w;
    }

    /* --- neighbours: separation + cohesion --- */
    let sx = 0, sy = 0, cx = 0, cy = 0, n = 0, close = 0;
    const near = g.bins.nearInto(this.x, this.y, 2.6, SCRATCH, 14);
    for (let k = 0; k < near.length; k++) {
      const o = near[k];
      if (o === this) continue;
      const dx = o.x - this.x, dy = o.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 6.8 || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      if (d < 1.05) { sx -= dx / d * (1.05 - d); sy -= dy / d * (1.05 - d); close++; }
      cx += o.x; cy += o.y; n++;
    }
    /* hard overlaps are solved in the melee pass, so this only needs to be a nudge */
    const sl = Math.hypot(sx, sy);
    if (sl > 1) { sx /= sl; sy /= sl; }
    ax += sx * 0.9; ay += sy * 0.9;
    if (n > 0) {
      cx /= n; cy /= n;
      const dx = cx - this.x, dy = cy - this.y;
      const d = Math.hypot(dx, dy) || 1;
      /* local cohesion: nobody wants to be the one sticking out */
      const coh = this.state === 'flee' ? 0.05 : clamp(0.15 + d * 0.1, 0.15, 0.5);
      ax += dx / d * coh; ay += dy / d * coh;
    }

    /* stay with the body of the march instead of stringing out in single file */
    let toC = 0;
    const mine = (g.groups && g.groups[gi]) ? g.groups[gi] : { x: g.stats.cx, y: g.stats.cy };
    if (this.state !== 'flee') {
      const gx = mine.x - this.x, gy = mine.y - this.y;
      toC = Math.hypot(gx, gy);
      if (toC > 18) {
        const k = clamp((toC - 18) / 30, 0, 0.8);
        ax += gx / toC * k; ay += gy / toC * k;
      }
    }

    /* --- the police line --- */
    let fear = 0;
    const cops = g.crsBins.nearInto(this.x, this.y, 14, g.scratchB, 16);
    for (let k = 0; k < cops.length; k++) {
      const o = cops[k];
      if (o.state === 'hurt') continue;        // out of the fight, not a threat
      const dx = o.x - this.x, dy = o.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 14) continue;
      const w = 1 - d / 14;
      if (g.order === 'fallback') {
        ax -= dx / d * w * 2.1; ay -= dy / d * w * 2.1;
      } else if (this.state === 'push' && this.morale > 28) {
        /* surge: lean into the shields */
        ax += dx / d * w * 1.5; ay += dy / d * w * 1.5;
      } else if (this.morale < 32 || o.charging) {
        ax -= dx / d * w * (1.4 + (o.charging ? 1.2 : 0));
        ay -= dy / d * w * (1.4 + (o.charging ? 1.2 : 0));
      } else {
        /* hold the line at arm's length */
        const want = 2.6 + this.bold * 1.5;
        const k2 = (d - want) * 0.22;
        ax += dx / d * k2; ay += dy / d * k2;
      }
      fear += w * (o.charging ? 2.2 : 1);
    }

    /* --- gas and smoke --- */
    let gasHere = 0;
    for (const c of g.fx.clouds) {
      if (!c.harmful) continue;
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d > c.r + 4) continue;
      const k = clamp(1 - d / (c.r + 4), 0, 1) * c.density;
      gasHere = Math.max(gasHere, k);
      const dx = this.x - c.x, dy = this.y - c.y;
      const l = Math.hypot(dx, dy) || 1;
      ax += dx / l * k * 3.2; ay += dy / l * k * 3.2;
    }
    this.gas = damp(this.gas, gasHere, gasHere > this.gas ? 6 : 1.2, dt);

    /* --- morale ---
       numbers carry you, isolation and the shields eat at you,
       gas breaks the line faster than anything else. */
    fear = Math.min(fear, 2.4);
    const support = clamp(n / 7, 0, 1.4);
    let dm = support * 4.4 - 1.0 - fear * 1.8 - this.gas * 22;
    if (fear < 0.05 && this.gas < 0.05) dm += 1.6;          // catching your breath
    if (g.flareBoost(this.x, this.y)) dm += 9;
    if (g.order === 'fallback') dm += 7;
    if (this.state === 'push' && fear > 0.1) dm -= 1.2;
    if (this.state === 'flee') dm -= 0.6;
    dm -= crowd.shock;                      // recent arrests ripple through the crowd
    if (dm > 0) dm *= 1 - this.morale / 140;                 // hard to stay at fever pitch
    this.morale = clamp(this.morale + dm * dt, 0, 100);

    if (this.morale < 14 && this.state !== 'flee') this.state = 'flee';
    else if (this.state === 'flee' && this.morale > 42) this.state = 'march';

    /* --- fleeing: head away from the square --- */
    if (this.state === 'flee') {
      if (map.fieldDir(map.fromPlaza, this.x, this.y, true, dir)) {
        ax += dir[0] * 1.5; ay += dir[1] * 1.5;
      }
    }

    /* --- walls --- */
    const push = map.wallPush(this.x, this.y, dir);
    if (push) { ax += dir[0] * push * 3; ay += dir[1] * push * 3; }

    /* --- on contourne les foyers --- */
    const fire = map.fireRepulse(this.x, this.y, dir);
    if (fire) { ax += dir[0] * fire * 4; ay += dir[1] * fire * 4; }
    const truck = g.truckRepulse(this.x, this.y, dir);
    if (truck) { ax += dir[0] * truck * 4.5; ay += dir[1] * truck * 4.5; }

    /* --- jams: shuffle sideways when nothing is moving --- */
    const moving = Math.hypot(this.vx, this.vy);
    if (this.state !== 'flee' && moving < 0.45) this.jam = (this.jam || 0) + dt;
    else this.jam = Math.max(0, (this.jam || 0) - dt * 2);
    if (this.jam > 0.7) {
      const side = (this.id % 2 ? 1 : -1);
      ax += -ay * side * 0.9; ay += ax * side * 0.9;
      if (this.jam > 2.5) this.jam = 0;
    }

    /* --- integrate --- */
    /* those out in front wait for the rest to catch up, stragglers hurry:
       compare how far each one still is from the rally with the pack average */
    let pack = 1;
    if (this.state !== 'flee') {
      const r = (g.rallies && g.rallies[gi]) ? g.rallies[gi] : g.rally;
      const rx = r[0], ry = r[1];
      const dMe = Math.hypot(rx - this.x, ry - this.y);
      const dPack = Math.hypot(rx - mine.x, ry - mine.y);
      const ahead = dPack - dMe;
      pack = ahead > 26 ? clamp(1 - (ahead - 26) / 40, 0.5, 1)
        : ahead < -26 ? clamp(1 + (-ahead - 26) / 60, 1, 1.35) : 1;
    }
    if (this.wet) this.wet = Math.max(0, this.wet - dt * 0.35);
    /* knocked about: no push, barely any movement for a moment */
    let stunned = 1;
    if (this.stun > 0) { this.stun = Math.max(0, this.stun - dt); stunned = 0.18; }
    const speed = (this.running ? RUN : WALK) * (0.75 + this.morale / 240)
      * (1 - this.gas * 0.35) * (1 - (this.wet || 0) * 0.3) * pack * stunned;
    const al = Math.hypot(ax, ay);
    if (al > 0.0001) { ax /= al; ay /= al; }
    const tvx = ax * speed, tvy = ay * speed;
    this.vx = damp(this.vx, tvx, 7, dt);
    this.vy = damp(this.vy, tvy, 7, dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.phase += dt * (3 + Math.hypot(this.vx, this.vy) * 2.2);

    /* --- throwing --- */
    this.throwCd -= dt;
    if (this.throwCd <= 0 && this.morale > 68 && this.state !== 'flee') {
      const target = g.police.nearestTo(this.x, this.y, 18);
      if (target) {
        if (g.fx.throwObject(this.x, this.y, target) !== false) this.throwCd = rr(13, 27);
        else this.throwCd = rr(1, 2.5);          // volley is saturated, wait a beat
      } else this.throwCd = 1.5;
    }
  }

  draw(ctx, zoom) {
    const r = this.r;
    const bob = Math.sin(this.phase) * (this.running ? 0.16 : 0.07);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.x + 0.25, this.y + 0.35, r * 1.05, r * 0.85, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = this.state === 'grabbed' ? '#d8d2c4' : this.col;
    ctx.beginPath(); ctx.arc(this.x, this.y + bob, r, 0, TAU); ctx.fill();
    if (zoom > 4) {
      ctx.fillStyle = this.skin;
      ctx.beginPath(); ctx.arc(this.x, this.y + bob, r * 0.48, 0, TAU); ctx.fill();
      if (this.wet > 0.3) {
        ctx.fillStyle = 'rgba(150,195,230,' + (0.35 * this.wet).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(this.x, this.y, r * 1.1, 0, TAU); ctx.fill();
      }
      if (this.gas > 0.45) {
        /* coughing: a faint halo, not a ring of light */
        ctx.strokeStyle = 'rgba(235,250,215,' + (0.25 * this.gas).toFixed(2) + ')';
        ctx.lineWidth = 0.1;
        ctx.beginPath(); ctx.arc(this.x, this.y, r * 1.35, 0, TAU); ctx.stroke();
      }
    }
    if (this.flag && zoom > 3) {
      const a = this.phase * 0.6;
      ctx.strokeStyle = '#5a4a38'; ctx.lineWidth = 0.14;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + 0.3, this.y - 2.4); ctx.stroke();
      ctx.fillStyle = this.flag;
      ctx.beginPath();
      ctx.moveTo(this.x + 0.3, this.y - 2.4);
      ctx.lineTo(this.x + 0.3 + Math.cos(a) * 1.5, this.y - 2.5 + Math.sin(a) * 0.4);
      ctx.lineTo(this.x + 0.3 + Math.cos(a) * 1.4, this.y - 1.5 + Math.sin(a) * 0.4);
      ctx.closePath(); ctx.fill();
    } else if (this.sign && zoom > 3) {
      ctx.fillStyle = '#e8e2d2';
      ctx.fillRect(this.x - 0.6, this.y - 2.1, 1.3, 0.9);
    }
  }
}

class Crowd {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.tmp = [0, 0];
    this.shock = 0;           // morale hit that spreads after an arrest
    this.dispersed = 0;
    this.arrested = 0;
    this.start = 0;
  }

  spawn(n, map) {
    this.start = n;
    const m = map.monument;
    let guard = 0;
    while (this.list.length < n && guard++ < n * 40) {
      const a = RNG() * TAU, d = rr(4, 8 + Math.sqrt(n) * 1.15);
      const x = m.x + 26 + Math.cos(a) * d, y = m.y + Math.sin(a) * d;
      if (!map.onPlaza(x, y) || !map.walkable(x, y)) continue;
      if (dist2(x, y, m.x, m.y) < (m.r + 6) * (m.r + 6)) continue;
      this.list.push(new Protester(x, y));
    }
  }

  /* fresh protesters walking in from the far end of a freed street */
  reinforce(n, street, map) {
    const L = Math.hypot(street.ex - street.sx, street.ey - street.sy) || 1;
    const dx = (street.ex - street.sx) / L, dy = (street.ey - street.sy) / L;
    let added = 0, guard = 0;
    while (added < n && guard++ < n * 40) {
      const t = rr(0.55, 0.92);
      const off = rr(-street.w / 2 + 2, street.w / 2 - 2);
      const x = street.sx + dx * L * t - dy * off;
      const y = street.sy + dy * L * t + dx * off;
      if (!map.walkable(x, y)) continue;
      const p = new Protester(x, y);
      p.morale = rr(75, 100);
      this.list.push(p);
      added++;
    }
    this.start += added;
    return added;
  }

  get count() { return this.list.length; }

  stats() {
    let mor = 0, cx = 0, cy = 0, fleeing = 0;
    for (const p of this.list) {
      mor += p.morale; cx += p.x; cy += p.y;
      if (p.state === 'flee') fleeing++;
    }
    const n = this.list.length || 1;
    return { morale: mor / n, cx: cx / n, cy: cy / n, fleeing };
  }

  /* densest knot of protesters — what the grenadiers aim at */
  densestNear(x, y, radius, bins) {
    let best = null, bestN = 3;
    for (let i = 0; i < this.list.length; i += 3) {
      const p = this.list[i];
      if (dist2(p.x, p.y, x, y) > radius * radius) continue;
      const n = bins.count(p.x, p.y, 7);
      if (n > bestN) { bestN = n; best = p; }
    }
    return best;
  }

  update(dt) {
    const g = this.g;
    this.shock = Math.max(0, this.shock - dt * 6);
    /* au-delà d'un gros millier, on met à jour une moitié du cortège par
       image avec un pas doublé : indiscernable à l'œil, deux fois moins cher */
    this.tick = (this.tick || 0) + 1;
    const split = this.list.length > 1200;
    const half = this.tick & 1;
    const step = split ? dt * 2 : dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (split && (p.id & 1) !== half) {
        /* on continue d'avancer sur sa lancée, sans rien recalculer */
        p.x += p.vx * dt; p.y += p.vy * dt;
        continue;
      }
      p.update(step, g);
      /* gone: dispersed down a side street, or taken away */
      if (p.state === 'flee' && g.map.distFromPlaza(p.x, p.y) > 150) {
        this.list.splice(i, 1); this.dispersed++;
      }
    }
  }

  remove(p, reason) {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    if (reason === 'arrest') { this.arrested++; this.shock += 1.6; }
  }

  draw(ctx, zoom) {
    for (const p of this.list) p.draw(ctx, zoom);
  }
}

/* ------------------------------------------------------------------ *
 *  Les badauds : ils viennent voir, flânent sur la place, gardent
 *  leurs distances avec les CRS et détalent au premier gaz.
 * ------------------------------------------------------------------ */

const CIVIL = ['#8e8b84', '#6f7a86', '#9c8f7e', '#7d7468', '#a4a098', '#5f6b74',
  '#8a7f93', '#b0a894', '#6b7f72'];

class Onlooker {
  constructor(x, y) {
    this.id = ++AGENT_ID;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 0.4;
    this.team = 'civil';
    this.col = pick(CIVIL);
    this.skin = pick(SKIN);
    this.phone = chance(0.3);          // filme la scène
    this.phase = RNG() * TAU;
    this.panic = 0;
    this.state = 'stroll';             // stroll | watch | flee
    this.target = null;
    this.retarget = rr(0, 5);
    this.keep = rr(26, 48);            // distance de sécurité choisie
    this.speed = rr(1.5, 2.3);
  }

  pickTarget(g) {
    const map = g.map;
    /* soit on flâne, soit on se place pour regarder le cortège */
    const watch = chance(0.6) && Math.hypot(g.stats.cx - this.x, g.stats.cy - this.y) < 170;
    for (let i = 0; i < 12; i++) {
      let x, y;
      if (watch) {
        const a = RNG() * TAU, d = this.keep + rr(-6, 10);
        x = g.stats.cx + Math.cos(a) * d; y = g.stats.cy + Math.sin(a) * d;
      } else {
        const a = RNG() * TAU, d = rr(10, 55);
        x = this.x + Math.cos(a) * d; y = this.y + Math.sin(a) * d;
      }
      if (map.walkable(x, y)) { this.target = [x, y]; this.state = watch ? 'watch' : 'stroll'; return; }
    }
    this.target = null;
  }

  update(dt, g) {
    const map = g.map, tmp = g.crowd.tmp;
    let ax = 0, ay = 0, danger = 0;

    /* --- les CRS : on s'écarte, et plus vite s'ils chargent --- */
    g.crsBins.near(this.x, this.y, 20, (o) => {
      if (o.state === 'hurt') return;
      const dx = o.x - this.x, dy = o.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 20) return;
      const k = (1 - d / 20) * (o.charging ? 2.6 : o.vehicle ? 2.2 : 1.3);
      ax -= dx / d * k * 2.2; ay -= dy / d * k * 2.2;
      danger = Math.max(danger, k);
    }, 10);

    /* --- les gaz : on part franchement --- */
    for (const c of g.fx.clouds) {
      if (!c.harmful) continue;
      const dx = this.x - c.x, dy = this.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > c.r + 12) continue;
      const k = clamp(1 - d / (c.r + 12), 0, 1) * c.density;
      ax += dx / d * k * 4; ay += dy / d * k * 4;
      danger = Math.max(danger, k * 1.6);
    }

    /* --- on ne se colle pas au cortège non plus --- */
    const dxc = g.stats.cx - this.x, dyc = g.stats.cy - this.y;
    const dc = Math.hypot(dxc, dyc) || 1;
    if (dc < this.keep * 0.6) { ax -= dxc / dc * 1.1; ay -= dyc / dc * 1.1; }

    /* --- on s'écarte quand le cortège arrive : personne ne reste planté
           devant une manif qui avance --- */
    let px = 0, py = 0, pn = 0;
    g.bins.near(this.x, this.y, 6, (p) => {
      const dx = p.x - this.x, dy = p.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 6) return;
      const k = 1 - d / 6;
      px -= dx / d * k; py -= dy / d * k; pn++;
    }, 12);
    if (pn) {
      const l2 = Math.hypot(px, py) || 1;
      const urge = clamp(pn / 4, 0.8, 3.2);
      ax += px / l2 * urge; ay += py / l2 * urge;
      if (pn > 6) danger = Math.max(danger, 0.3);     // on presse le pas
    }

    /* --- séparation entre badauds --- */
    g.civBins.near(this.x, this.y, 2.4, (o) => {
      if (o === this) return;
      const dx = o.x - this.x, dy = o.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 1.4) { ax -= dx / d * (1.4 - d) * 1.2; ay -= dy / d * (1.4 - d) * 1.2; }
    }, 8);

    /* --- panique --- */
    this.panic = clamp(this.panic + (danger > 0.45 ? dt * 1.6 * danger : -dt * 0.45), 0, 1.6);
    if (this.panic > 1 && this.state !== 'flee') { this.state = 'flee'; this.target = null; }
    if (this.state === 'flee' && this.panic < 0.25) { this.state = 'stroll'; this.retarget = 0; }

    if (this.state === 'flee') {
      if (map.fieldDir(map.fromPlaza, this.x, this.y, true, tmp)) { ax += tmp[0] * 2.6; ay += tmp[1] * 2.6; }
    } else {
      this.retarget -= dt;
      if (!this.target || this.retarget <= 0) { this.pickTarget(g); this.retarget = rr(4, 10); }
      if (this.target) {
        const dx = this.target[0] - this.x, dy = this.target[1] - this.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 2.5) this.retarget = 0;
        else { ax += dx / d * 1.2; ay += dy / d * 1.2; }
      }
    }

    const push = map.wallPush(this.x, this.y, tmp);
    if (push) { ax += tmp[0] * push * 3; ay += tmp[1] * push * 3; }
    const fire = map.fireRepulse(this.x, this.y, tmp);
    if (fire) { ax += tmp[0] * fire * 4.5; ay += tmp[1] * fire * 4.5; }
    const truck = g.truckRepulse(this.x, this.y, tmp);
    if (truck) { ax += tmp[0] * truck * 5; ay += tmp[1] * truck * 5; }

    const l = Math.hypot(ax, ay);
    if (l > 0.001) { ax /= l; ay /= l; }
    const sp = this.speed * (this.state === 'flee' ? 2.4 : danger > 0.3 ? 1.8 : 1);
    this.vx = damp(this.vx, ax * sp, 6, dt);
    this.vy = damp(this.vy, ay * sp, 6, dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.phase += dt * (2.5 + Math.hypot(this.vx, this.vy) * 2);
  }

  draw(ctx, zoom) {
    const r = this.r;
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath(); ctx.ellipse(this.x + 0.22, this.y + 0.3, r, r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = this.col;
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.fill();
    if (zoom > 4) {
      ctx.fillStyle = this.skin;
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.45, 0, TAU); ctx.fill();
      if (this.phone && this.state !== 'flee') {
        ctx.fillStyle = 'rgba(230,240,255,0.9)';
        ctx.fillRect(this.x + r * 0.6, this.y - r * 0.5, 0.35, 0.5);
      }
    }
  }
}

class Bystanders {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.gone = 0;
    this.start = 0;
  }
  get count() { return this.list.length; }

  spawn(n, map) {
    this.start = n;
    const m = map.monument;
    let guard = 0;
    while (this.list.length < n && guard++ < n * 50) {
      const a = RNG() * TAU, d = rr(35, 130);
      const x = m.x + 40 + Math.cos(a) * d, y = m.y + Math.sin(a) * d;
      if (!map.walkable(x, y)) continue;
      if (dist2(x, y, m.x + 34, m.y + 34) < 30 * 30) continue;   // pas dans le cortège
      this.list.push(new Onlooker(x, y));
    }
  }

  update(dt) {
    const g = this.g;
    /* les badauds sont du décor vivant : une image sur deux suffit, avec un
       pas de temps doublé. Invisible à l'œil, moitié moins cher. */
    this.tick = (this.tick || 0) + 1;
    const half = this.tick % 2;
    const step = dt * 2;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      if ((o.id & 1) !== half) continue;
      o.update(step, g);
      if (o.state === 'flee' && g.map.distFromPlaza(o.x, o.y) > 120) { this.list.splice(i, 1); this.gone++; }
    }
  }

  draw(ctx, zoom) { for (const o of this.list) o.draw(ctx, zoom); }
}
