'use strict';
/* ------------------------------------------------------------------ *
 *  fx.js — lacrymogènes, fumigènes, projectiles, cris, particules
 * ------------------------------------------------------------------ */

class Fx {
  constructor(game) {
    this.g = game;
    this.clouds = [];       // gas + smoke
    this.grenades = [];     // canisters and thrown objects in the air
    this.parts = [];
    this.shouts = [];
    this.wind = { x: rr(-0.5, 0.9), y: rr(-0.6, 0.4) };
    /* secousse de caméra, en mètres */
    this.shakeT = 0; this.shakeDur = 1; this.shakeAmp = 0; this.shakeDir = 0; this.shakePhase = 0;

    /* global rate limit: volleys, not a continuous hail — fewer projectiles
       than before, but each one hurts more */
    this.throwTokens = 8;
    this.windT = 0;
  }

  /* ------------------------------ gas ----------------------------- */
  launchGas(x, y, tx, ty) {
    /* le départ du tir : un son pris au hasard dans bruits/grenades */
    if (this.g.sfx) this.g.sfx.grenade(x, y);
    /* et une brève secousse, d'autant plus forte qu'on est près du tir */
    this.kick(x, y, 1.9);
    this.grenades.push({
      kind: 'gas', x, y, sx: x, sy: y, tx, ty, t: 0,
      dur: clamp(Math.hypot(tx - x, ty - y) / 26, 0.5, 1.9), spin: 0,
    });
  }

  throwObject(x, y, target) {
    if (this.throwTokens < 1) return false;
    this.throwTokens -= 1;
    const tx = target.x + rr(-1.2, 1.2), ty = target.y + rr(-1.2, 1.2);
    this.grenades.push({
      kind: 'rock', x, y, sx: x, sy: y, tx, ty, t: 0,
      dur: clamp(Math.hypot(tx - x, ty - y) / 16, 0.45, 1.5), target, spin: rr(0, TAU),
    });
  }

  gasCloud(x, y) {
    this.clouds.push({
      x, y, r: 3, maxR: rr(16, 23), density: 0, life: 0, maxLife: rr(13, 20),
      harmful: true, col: [226, 232, 214], puffs: this.puffs(5),
    });
    this.parts.push({ x, y, vx: 0, vy: 0, r: 2, grow: 26, life: 0.5, t: 0, col: [255, 240, 190], kind: 'flash' });
  }

  /* player's smoke: shelter, and it spoils the grenadiers' aim */
  flare(x, y, col) {
    this.clouds.push({
      x, y, r: 4, maxR: rr(20, 26), density: 0, life: 0, maxLife: 26,
      harmful: false, col: col || [226, 86, 74], puffs: this.puffs(6), flare: true,
    });
  }

  puffs(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ a: RNG() * TAU, d: rr(0.1, 0.8), s: rr(0.45, 0.95), w: rr(-0.6, 0.6) });
    }
    return out;
  }

  /* 0..1: how much smoke sits on the line of fire */
  smokeBetween(x0, y0, x1, y1) {
    let block = 0;
    for (const c of this.clouds) {
      const dx = x1 - x0, dy = y1 - y0;
      const L2 = dx * dx + dy * dy || 1;
      let t = ((c.x - x0) * dx + (c.y - y0) * dy) / L2;
      t = clamp(t, 0, 1);
      const px = x0 + dx * t, py = y0 + dy * t;
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < c.r) block += (1 - d / c.r) * c.density * (c.flare ? 1 : 0.4);
    }
    return clamp(block, 0, 1);
  }

  shout(x, y, text) { this.shouts.push({ x, y, text, t: 0, life: 1.6 }); }

  /* coup sec sur la caméra : amplitude atténuée par la distance au centre */
  kick(x, y, amp) {
    const cam = this.g.cam;
    let k = 1;
    if (cam) {
      const d = Math.hypot(x - cam.x, y - cam.y);
      k = clamp(1 - (d - 45) / 190, 0, 1);
    }
    if (k <= 0.02) return;
    const a = amp * k;
    if (a < this.shakeAmp * (this.shakeT / (this.shakeDur || 1))) return;   // déjà plus secoué
    this.shakeAmp = a;
    this.shakeDur = 0.34;
    this.shakeT = this.shakeDur;
    this.shakeDir = RNG() * TAU;
    this.shakePhase = RNG() * TAU;
  }

  /* décalage courant de la caméra, en mètres */
  camShake(out) {
    if (this.shakeT <= 0) { out[0] = 0; out[1] = 0; return; }
    const k = this.shakeT / this.shakeDur;
    const a = this.shakeAmp * k * k * Math.sin(this.shakeT * 52 + this.shakePhase);
    out[0] = Math.cos(this.shakeDir) * a;
    out[1] = Math.sin(this.shakeDir) * a;
  }

  burst(x, y, n, col, speed) {
    for (let i = 0; i < n; i++) {
      const a = RNG() * TAU, s = rr(2, speed || 10);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rr(0.15, 0.5),
        life: rr(0.3, 0.9), t: 0, col: col || [210, 200, 180], kind: 'dust', drag: 3,
      });
    }
  }

  /* ---------------------------- update ---------------------------- */
  update(dt) {
    const g = this.g;
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.windT += dt;
    this.wind.x = damp(this.wind.x, Math.sin(this.windT * 0.07) * 1.3, 0.4, dt);
    this.wind.y = damp(this.wind.y, Math.cos(this.windT * 0.05) * 0.9, 0.4, dt);

    this.throwTokens = Math.min(8, this.throwTokens + dt * 4);

    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const gr = this.grenades[i];
      gr.t += dt;
      const k = clamp(gr.t / gr.dur, 0, 1);
      gr.x = lerp(gr.sx, gr.tx, k);
      gr.y = lerp(gr.sy, gr.ty, k);
      gr.z = Math.sin(k * Math.PI) * (gr.kind === 'gas' ? 9 : 5);
      gr.spin += dt * 14;
      if (k >= 1) {
        if (gr.kind === 'gas') {
          this.gasCloud(gr.x, gr.y);
          this.burst(gr.x, gr.y, 6, [235, 235, 210], 6);
        } else {
          const t = gr.target;
          if (t && !t.dead) {
            t.hit(rr(16, 30));
            this.burst(gr.x, gr.y, 5, [200, 195, 180], 7);
          }
        }
        this.grenades.splice(i, 1);
      }
    }

    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.life += dt;
      const k = c.life / c.maxLife;
      c.r = lerp(3, c.maxR, clamp(c.life / 3.2, 0, 1));
      c.density = k < 0.1 ? k / 0.1 : clamp(1 - (k - 0.1) / 0.9, 0, 1);
      const drift = c.flare ? 0.35 : 0.9;
      c.x += this.wind.x * drift * dt * 3;
      c.y += this.wind.y * drift * dt * 3;
      for (const p of c.puffs) { p.a += p.w * dt * 0.4; p.d = clamp(p.d + dt * 0.02, 0, 0.95); }
      if (c.life > c.maxLife) this.clouds.splice(i, 1);
    }

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t > p.life) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.drag) { const d = 1 - clamp(p.drag * dt, 0, 1); p.vx *= d; p.vy *= d; }
      if (p.grow) p.r += p.grow * dt;
    }

    for (let i = this.shouts.length - 1; i >= 0; i--) {
      const s = this.shouts[i];
      s.t += dt; s.y -= dt * 3;
      if (s.t > s.life) this.shouts.splice(i, 1);
    }
  }

  /* ---------------------------- render ---------------------------- */
  drawGround(ctx) {
    for (const p of this.parts) {
      if (p.kind === 'flash') continue;
      const k = 1 - p.t / p.life;
      ctx.fillStyle = 'rgba(' + p.col[0] + ',' + p.col[1] + ',' + p.col[2] + ',' + (k * 0.6).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
  }

  drawAir(ctx, zoom) {
    /* thrown things */
    for (const gr of this.grenades) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(gr.x, gr.y, 0.5, 0.35, 0, 0, TAU); ctx.fill();
      const y = gr.y - gr.z;
      if (gr.kind === 'gas') {
        ctx.fillStyle = '#d8dcc8';
        ctx.beginPath(); ctx.arc(gr.x, y, 0.55, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(230,235,215,0.5)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(gr.x, y); ctx.lineTo(gr.x - (gr.tx - gr.sx) * 0.012, y - (gr.ty - gr.sy) * 0.012); ctx.stroke();
      } else {
        ctx.fillStyle = '#6a6358';
        ctx.beginPath(); ctx.arc(gr.x, y, 0.32, 0, TAU); ctx.fill();
      }
    }

    /* clouds */
    for (const c of this.clouds) {
      const a = c.density * (c.flare ? 0.55 : 0.62);
      if (a <= 0.01) continue;
      for (const p of c.puffs) {
        const px = c.x + Math.cos(p.a) * c.r * p.d;
        const py = c.y + Math.sin(p.a) * c.r * p.d;
        const pr = c.r * p.s;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, pr);
        grd.addColorStop(0, 'rgba(' + c.col[0] + ',' + c.col[1] + ',' + c.col[2] + ',' + (a * 0.85).toFixed(3) + ')');
        grd.addColorStop(0.55, 'rgba(' + c.col[0] + ',' + c.col[1] + ',' + c.col[2] + ',' + (a * 0.4).toFixed(3) + ')');
        grd.addColorStop(1, 'rgba(' + c.col[0] + ',' + c.col[1] + ',' + c.col[2] + ',0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      }
    }

    for (const p of this.parts) {
      if (p.kind !== 'flash') continue;
      const k = 1 - p.t / p.life;
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grd.addColorStop(0, 'rgba(255,250,220,' + (0.8 * k).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }

    if (zoom > 2.6) {
      ctx.textAlign = 'center';
      for (const s of this.shouts) {
        const k = 1 - s.t / s.life;
        ctx.globalAlpha = clamp(k * 1.6, 0, 1);
        ctx.font = '700 ' + (9 / zoom).toFixed(2) + 'px "Helvetica Neue", Arial, sans-serif';
        ctx.fillStyle = s.text === 'LACRYMO' ? '#ffe08a' : '#ff9a8a';
        ctx.fillText(s.text, s.x, s.y);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Camion de pompiers : remonte une rue, noie un foyer, repart.
 *  Un nouveau feu se rallume ailleurs un peu plus tard.
 * ------------------------------------------------------------------ */

class FireTruck {
  constructor(street, fire, map) {
    this.id = ++AGENT_ID;
    this.street = street;
    this.fire = fire;
    this.team = 'fire';
    this.vehicle = true;
    this.r = 2.6;
    this.state = 'drive';          // drive | spray | leave
    this.spray = 0;
    this.beacon = RNG() * TAU;
    this.gone = false;
    this.doneAt = 0;
    const L = Math.hypot(street.ex - street.sx, street.ey - street.sy) || 1;
    this.dir = [(street.ex - street.sx) / L, (street.ey - street.sy) / L];
    this.x = lerp(street.sx, street.ex, 0.7);
    this.y = lerp(street.sy, street.ey, 0.7);
    this.map = map;
    this.speed = 0;
    this.path = this.route(map, [this.x, this.y], [fire.x, fire.y], true);
    this.pathI = 1;
    const n = this.path[1] || this.path[0];
    this.ang = Math.atan2(n[1] - this.y, n[0] - this.x);
  }

  /* itinéraire : l'axe de la rue jusqu'au débouché, puis une courbe de Bézier
     vers le foyer dont le point de contrôle penche vers le centre de la place.
     `inbound` false construit le trajet retour. */
  route(map, from, to, inbound) {
    const m = this.street.mouth;
    const pts = [];
    const bez = (a, c, b, steps) => {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        pts.push(this.legal(map, [
          u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
          u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
        ]));
      }
    };
    const control = (a, b) => {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      /* d'autant plus infléchi vers le centre que le trajet est long */
      const far = clamp(Math.hypot(b[0] - a[0], b[1] - a[1]) / 160, 0.25, 0.75);
      return [lerp(mid[0], map.centre[0], far), lerp(mid[1], map.centre[1], far)];
    };

    pts.push(from.slice());
    if (inbound) {
      /* on descend la rue dans son axe */
      for (let i = 1; i <= 4; i++) {
        pts.push(this.legal(map, [lerp(from[0], m[0], i / 4), lerp(from[1], m[1], i / 4)]));
      }
      bez(m, control(m, to), to, 14);
    } else {
      bez(from, control(from, m), m, 12);
      const out = [lerp(this.street.sx, this.street.ex, 0.95), lerp(this.street.sy, this.street.ey, 0.95)];
      for (let i = 1; i <= 5; i++) {
        pts.push(this.legal(map, [lerp(m[0], out[0], i / 5), lerp(m[1], out[1], i / 5)]));
      }
    }
    return pts;
  }

  /* un point d'itinéraire doit être praticable : sinon on le ramène vers le centre */
  legal(map, p) {
    if (map.walkable(p[0], p[1])) return p;
    for (let k = 1; k <= 6; k++) {
      const t = k / 7;
      const q = [lerp(p[0], map.centre[0], t), lerp(p[1], map.centre[1], t)];
      if (map.walkable(q[0], q[1])) return q;
    }
    return p;
  }

  /* poursuite pure : on vise le point d'itinéraire courant, qui glisse en avant */
  follow(dt, g, cruise) {
    while (this.pathI < this.path.length - 1 &&
      dist2(this.x, this.y, this.path[this.pathI][0], this.path[this.pathI][1]) < 11 * 11) this.pathI++;
    const t = this.path[this.pathI];
    this.drive(dt, g, Math.atan2(t[1] - this.y, t[0] - this.x), cruise);
    return this.pathI >= this.path.length - 1;
  }

  /* direction souhaitée, lissée : on regarde le champ un peu en avant pour
     éviter l'escalier des huit directions */
  wish(g, field, fx, fy) {
    const d = [0, 0];
    let wx = 0, wy = 0, n = 0;
    if (g.map.fieldDir(field, this.x, this.y, false, d)) { wx += d[0]; wy += d[1]; n++; }
    const ax = this.x + Math.cos(this.ang) * 5, ay = this.y + Math.sin(this.ang) * 5;
    if (g.map.walkable(ax, ay) && g.map.fieldDir(field, ax, ay, false, d)) { wx += d[0] * 0.8; wy += d[1] * 0.8; n++; }
    if (!n) {
      const dd = Math.hypot(fx - this.x, fy - this.y) || 1;
      return Math.atan2((fy - this.y) / dd, (fx - this.x) / dd);
    }
    return Math.atan2(wy, wx);
  }

  /* conduite : on tourne le volant, puis on avance tout droit — un camion
     ne se déplace pas en crabe */
  drive(dt, g, want, cruise) {
    const turn = angNorm(want - this.ang);
    const rate = 2.4 + 1.2 * (1 - clamp(this.speed / 21, 0, 1));   // plus maniable au ralenti
    this.ang += clamp(turn, -rate * dt, rate * dt);

    const align = Math.cos(angNorm(want - this.ang));
    const target = cruise * clamp(0.25 + align * 0.85, 0.2, 1);
    this.speed = damp(this.speed || 0, target, 2.2, dt);

    const step = this.speed * dt;
    const tries = [0, 0.45, -0.45, 0.95, -0.95];
    for (const off of tries) {
      const a = this.ang + off;
      const nx = this.x + Math.cos(a) * step, ny = this.y + Math.sin(a) * step;
      if (g.map.walkable(nx, ny)) {
        this.x = nx; this.y = ny;
        if (off) this.ang += clamp(off, -rate * dt * 2, rate * dt * 2);
        this.stuckT = 0;
        return;
      }
    }
    /* vraiment coincé : on ralentit et on se dégage */
    this.speed *= 0.4;
    this.stuckT = (this.stuckT || 0) + dt;
    if (this.stuckT > 1.5) {
      const back = this.ang + Math.PI;
      const nx = this.x + Math.cos(back) * 1.2, ny = this.y + Math.sin(back) * 1.2;
      if (g.map.walkable(nx, ny)) { this.x = nx; this.y = ny; }
      this.ang += 0.9;
      this.stuckT = 0;
      this.blocked = (this.blocked || 0) + 1;
      if (this.blocked > 6 && this.state !== 'leave') this.beginLeave(g);
    }
  }

  /* on repart : itinéraire retour construit depuis la position courante */
  beginLeave(g) {
    if (this.state === 'leave') return;
    this.state = 'leave';
    this.path = this.route(g.map, [this.x, this.y], null, false);
    this.pathI = 1;
  }

  update(dt, g) {
    this.beacon += dt * 9;
    const f = this.fire;
    const alive = f && g.map.fires.indexOf(f) >= 0;
    if (!alive) this.beginLeave(g);

    if (this.state === 'leave') {
      this.spray = damp(this.spray, 0, 4, dt);
      this.follow(dt, g, 24);
      if (g.map.distFromPlaza(this.x, this.y) > 110) this.gone = true;
      return;
    }

    const dist = Math.hypot(f.x - this.x, f.y - this.y);
    if (dist > 9) {
      this.state = 'drive';
      /* on ralentit à l'approche pour ne pas dépasser le foyer */
      this.follow(dt, g, 21 * clamp(dist / 45, 0.26, 1));
      this.spray = damp(this.spray, 0, 3, dt);
    } else {
      this.state = 'spray';
      this.speed = damp(this.speed || 0, 0, 6, dt);
      this.spray = damp(this.spray, 1, 3, dt);
      /* à l'arrêt on oriente la lance sur le foyer */
      const want = Math.atan2(f.y - this.y, f.x - this.x);
      this.ang += angNorm(want - this.ang) * clamp(dt * 3, 0, 1);
      if (this.spray > 0.5) {
        f.dying = (f.dying || 0) + dt;
        f.r = Math.max(0, f.r - dt * (0.32 + f.r0 * 0.12));
        if (Math.random() < dt * 20) {
          g.fx.burst(f.x + rr(-f.r, f.r), f.y + rr(-f.r, f.r), 2, [225, 228, 230], 7);
        }
        if (f.r < 0.3) {
          g.map.removeFire(f);
          g.say('Les pompiers ont noyé un foyer.', 3);
          this.beginLeave(g);
        }
      }
    }
  }

  draw(ctx, zoom) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.ang);
    /* lance à eau */
    if (this.spray > 0.15) {
      const g2 = ctx.createRadialGradient(0, 0, 1, 0, 0, 13);
      g2.addColorStop(0, 'rgba(225,240,255,' + (0.55 * this.spray).toFixed(2) + ')');
      g2.addColorStop(1, 'rgba(225,240,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 13, -0.3, 0.3); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-5, -2.4, 11.5, 5);
    ctx.fillStyle = '#b4332a';
    ctx.fillRect(-5.5, -2.7, 11.5, 5.4);
    ctx.fillStyle = '#8f2822';
    ctx.fillRect(-5.5, -2.7, 4.5, 5.4);
    ctx.fillStyle = '#d8dde2';
    ctx.fillRect(2.2, -2, 3.2, 4);
    /* gyrophares */
    const on = Math.sin(this.beacon) > 0;
    ctx.fillStyle = on ? '#ff6a4a' : '#5c2420';
    ctx.fillRect(-1.2, -3.2, 2.4, 0.9);
    ctx.fillStyle = !on ? '#ffd0a0' : '#5c3a20';
    ctx.fillRect(-1.2, 2.3, 2.4, 0.9);
    ctx.restore();
  }
}
