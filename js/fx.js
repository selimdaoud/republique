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
