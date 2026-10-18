'use strict';
/* ------------------------------------------------------------------ *
 *  game.js — boucle, caméra, ordres de la foule, mêlée, fin de partie
 * ------------------------------------------------------------------ */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = new ParisMap();
    this.hud = new Hud();
    this.sound = new Ambience(AMBIENCE_SOURCES);
    this.sfx = new Sfx(this, GRENADE_SOURCES);
    this.bins = new Bins(WORLD_W, WORLD_H, 4);      // manifestants
    this.crsBins = new Bins(WORLD_W, WORLD_H, 8);   // forces de l'ordre
    this.civBins = new Bins(WORLD_W, WORLD_H, 5);   // badauds
    this.cam = { x: this.map.centre[0], y: this.map.centre[1], zoom: 3.4, ox: 0, oy: 0 };
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.messages = [];
    this.paused = true;
    this.over = null;
    this.debug = false;
    this.fps = 60;
    this.opts = { protesters: 180, ratio: 0.167 };   // CRS par manifestant
    this.reset();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  /* the prefecture sends a force proportional to the turnout:
     one CRS per N manifestants, spread over 2 to 6 companies */
  static force(opts) {
    /* garde-fou : sans ratio valide on déploierait zéro compagnie en silence */
    const ratio = isFinite(opts.ratio) && opts.ratio > 0 ? opts.ratio : 0.167;
    const nb = isFinite(opts.protesters) && opts.protesters > 0 ? opts.protesters : 180;
    const total = clamp(Math.round(nb * ratio), 8, 112);
    const companies = clamp(Math.round(total / 11), 2, 6);
    const per = Math.max(4, Math.round(total / companies));
    return { total: companies * per, companies, per };
  }

  reset() {
    RNG = mulberry32((Date.now() & 0xffff) ^ 0x1789);
    this.crowd = new Crowd(this);
    this.bystanders = new Bystanders(this);
    this.police = new Police(this);
    this.fx = new Fx(this);
    this.crowd.spawn(this.opts.protesters, this.map);
    /* des curieux viennent voir : la moitié de l'effectif du cortège */
    this.bystanders.spawn(Math.round(this.opts.protesters * 0.5), this.map);
    const f = Game.force(this.opts);
    this.police.deploy(f.companies, f.per, this.map);
    /* jusqu'à MAX_TARGETS cibles simultanées ; chacune a son groupe */
    this.rallies = [[this.map.monument.x + 34, this.map.monument.y + 34]];
    this.rally = this.rallies[0];              // la cible active
    this.activeRally = 0;
    this.map.setRally(0, this.rally[0], this.rally[1]);
    for (const p of this.crowd.list) p.group = 0;
    this.order = 'march';
    this.flares = 3;
    /* every street a company holds is a control point to free */
    this.mouths = this.police.squads.map((sq) => ({
      street: sq.street, x: sq.hold[0], y: sq.hold[1], axis: sq.axis,
      squad: sq, progress: 0, freed: false,
    }));
    this.freedCount = 0;
    this.sweptT = 0;
    this.time = 0;
    this.over = null;
    this.messages.length = 0;
    this.stats = { morale: 70, cx: this.rally[0], cy: this.rally[1], fleeing: 0 };
    this.control = 0.5;
    this.controlT = 0;
    this.lowMoraleT = 0;
    this.cam.x = this.map.centre[0]; this.cam.y = this.map.centre[1];
    this.cam.ox = 0; this.cam.oy = 0;
    this.cam.zoom = 3.4;
    this.say('Tenez la place. Amenez la foule au contact pour repousser les lignes.', 5);
    const rues = [];
    for (const sq of this.police.squads) {
      const r = sq.street || this.map.nearestStreet(sq.anchor[0], sq.anchor[1]);
      if (rues.indexOf(r) < 0) rues.push(r);
    }
    this.pendingSay = {
      text: this.police.units + ' CRS en ' + this.police.squads.length + ' compagnies tiennent ' +
        rues.join(', ') + '. Suivez les repères bleus.',
      life: 6,
    };
  }

  say(text, life) {
    if (this.messages.length && this.messages[this.messages.length - 1].text === text) return;
    this.messages.push({ text, life: life || 3.5, t: 0 });
    if (this.messages.length > 3) this.messages.splice(0, this.messages.length - 3);
  }

  /* une nouvelle cible aspire le quart du cortège le plus proche d'elle */
  addRally(x, y) {
    const i = this.rallies.length;
    this.rallies.push([x, y]);
    this.activeRally = i;
    this.map.setRally(i, x, y);
    const quota = Math.max(1, Math.round(this.crowd.list.length * 0.25));
    const sorted = this.crowd.list
      .map((p) => ({ p, d: dist2(p.x, p.y, x, y) }))
      .sort((a, b) => a.d - b.d);
    for (let k = 0; k < quota && k < sorted.length; k++) sorted[k].p.group = i;
    this.say(quota + ' manifestants se détachent vers la nouvelle cible.', 3);
  }

  removeRally(i) {
    if (this.rallies.length <= 1) return;
    this.rallies.splice(i, 1);
    /* on recolle les groupes : indices décalés, orphelins au plus proche */
    for (const p of this.crowd.list) {
      if (p.group === i) p.group = -1;
      else if (p.group > i) p.group--;
    }
    for (let k = 0; k < this.rallies.length; k++) this.map.setRally(k, this.rallies[k][0], this.rallies[k][1]);
    for (const p of this.crowd.list) {
      if (p.group !== -1) continue;
      let best = 0, bd = Infinity;
      for (let k = 0; k < this.rallies.length; k++) {
        const d = dist2(p.x, p.y, this.rallies[k][0], this.rallies[k][1]);
        if (d < bd) { bd = d; best = k; }
      }
      p.group = best;
    }
    this.activeRally = clamp(this.activeRally, 0, this.rallies.length - 1);
    this.rally = this.rallies[this.activeRally];
  }

  /* centre de gravité de chaque groupe, pour la régulation d'allure */
  groupStats() {
    const n = this.rallies.length;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: 0, y: 0, n: 0 });
    for (const p of this.crowd.list) {
      const g = clamp(p.group | 0, 0, n - 1);
      p.group = g;
      out[g].x += p.x; out[g].y += p.y; out[g].n++;
    }
    for (let i = 0; i < n; i++) {
      if (out[i].n) { out[i].x /= out[i].n; out[i].y /= out[i].n; }
      else { out[i].x = this.rallies[i][0]; out[i].y = this.rallies[i][1]; }
    }
    return out;
  }

  /* has this company's street already been taken for good? */
  isFreed(squad) {
    for (const m of this.mouths) if (m.squad === squad) return m.freed;
    return false;
  }

  flareBoost(x, y) {
    for (const c of this.fx.clouds) {
      if (c.flare && dist2(c.x, c.y, x, y) < c.r * c.r) return true;
    }
    return false;
  }

  /* the crowd steers itself at the nearest company — used for demos
     and automated captures (?demo=1) */
  autoPlay(dt) {
    this.demoT = (this.demoT || 0) - dt;
    if (this.demoT > 0) return;
    this.demoT = 0.5;
    if (!this.demoTarget || this.police.squads.indexOf(this.demoTarget) < 0 || this.demoTarget.counted) {
      let bd = Infinity;
      this.demoTarget = null;
      for (const sq of this.police.squads) {
        if (sq.counted) continue;
        const d = dist2(sq.anchor[0], sq.anchor[1], this.stats.cx, this.stats.cy);
        if (d < bd) { bd = d; this.demoTarget = sq; }
      }
    }
    if (this.stats.morale < 32) { this.demoRegroup = true; }
    /* a street waiting to be held comes before attacking the next line */
    let mouth = null, md = Infinity;
    for (const m of this.mouths) {
      if (m.freed || !m.open) continue;
      const d = dist2(m.x, m.y, this.stats.cx, this.stats.cy);
      if (d < md) { md = d; mouth = m; }
    }
    if (mouth && !this.demoRegroup) {
      this.rally[0] = mouth.x; this.rally[1] = mouth.y;
      /* shove whatever stands in the way of the street we are going to take */
      /* on pousse si quelqu'un barre la route, qu'il soit sur nous
         ou planté sur le débouché qu'on veut prendre */
      let nearCrowd = Infinity, nearMouth = Infinity;
      this.police.each((u) => {
        if (u.state === 'hurt') return;
        nearCrowd = Math.min(nearCrowd, dist2(u.x, u.y, this.stats.cx, this.stats.cy));
        nearMouth = Math.min(nearMouth, dist2(u.x, u.y, mouth.x, mouth.y));
      });
      this.forcedOrder = (nearCrowd < 48 * 48 || nearMouth < 30 * 30) ? 'push' : 'march';
      return;
    }
    /* broken morale: break contact and let the crowd get its breath back.
       Jamais plus de 25 s, sinon le pilote reste planté au monument. */
    if (this.stats.morale < 32) { this.demoRegroup = true; this.demoRegroupT = 0; }
    else if (this.stats.morale > 62) this.demoRegroup = false;
    if (this.demoRegroup) {
      this.demoRegroupT = (this.demoRegroupT || 0) + 0.5;
      if (this.demoRegroupT > 25) this.demoRegroup = false;
    }
    if (this.demoRegroup) {
      const m = this.map.monument;
      this.rally[0] = m.x + 40; this.rally[1] = m.y + 40;
      this.forcedOrder = 'fallback';
      return;
    }

    const t = this.demoTarget;
    if (!t) return;
    if (this.map.walkable(t.anchor[0], t.anchor[1])) { this.rally[0] = t.anchor[0]; this.rally[1] = t.anchor[1]; }
    const d = Math.hypot(t.anchor[0] - this.stats.cx, t.anchor[1] - this.stats.cy);
    this.forcedOrder = d < 45 ? 'push' : 'march';
  }

  /* ----------------------------- update --------------------------- */
  update(dt) {
    if (this.over) { this.over.t += dt; this.fx.update(dt); return; }
    this.time += dt;
    if (this.demo) this.autoPlay(dt);

    /* ---- orders ---- */
    this.order = this.forcedOrder || (Input.any(KEY.push) ? 'push'
      : Input.any(KEY.fallback) ? 'fallback' : 'march');
    if (Input.hit('KeyF') && this.flares > 0) {
      this.flares--;
      this.fx.flare(this.rally[0], this.rally[1]);
      this.say('Fumigène allumé — la foule se rassemble derrière.', 3);
    }
    if (Input.hit('KeyC')) { this.cam.ox = 0; this.cam.oy = 0; }

    /* ---- cibles : clic pour créer ou déplacer, X pour supprimer ---- */
    const mw = this.screenToWorld(Input.mx, Input.my);
    Input.wx = mw[0]; Input.wy = mw[1];
    const okHere = this.map.walkable(mw[0], mw[1]);

    if (Input.clicked && okHere) {
      let near = -1, nd = 28 * 28;
      for (let i = 0; i < this.rallies.length; i++) {
        const d = dist2(this.rallies[i][0], this.rallies[i][1], mw[0], mw[1]);
        if (d < nd) { nd = d; near = i; }
      }
      const forceNew = Input.down('ShiftLeft') || Input.down('ShiftRight');
      if ((near < 0 || forceNew) && this.rallies.length < MAX_TARGETS) {
        this.addRally(mw[0], mw[1]);
      } else {
        this.activeRally = near >= 0 ? near : 0;
      }
    }
    if (Input.hit('KeyX') && this.rallies.length > 1) this.removeRally(this.activeRally);

    if (Input.left && okHere) {
      const r = this.rallies[this.activeRally];
      r[0] = mw[0]; r[1] = mw[1];
    }
    this.rally = this.rallies[clamp(this.activeRally, 0, this.rallies.length - 1)];

    /* un champ de flux par cible, recalculé quand elle bouge assez */
    this.fieldT = (this.fieldT || 0) - dt;
    if (this.fieldT <= 0) {
      for (let i = 0; i < this.rallies.length; i++) {
        const t = this.map.flowTargets[i];
        if (dist2(this.rallies[i][0], this.rallies[i][1], t[0], t[1]) > 9) {
          this.map.setRally(i, this.rallies[i][0], this.rallies[i][1]);
          this.fieldT = 0.16;
        }
      }
    }

    /* ---- broad phase ---- */
    this.bins.clear();
    for (const p of this.crowd.list) this.bins.add(p);
    this.crsBins.clear();
    this.police.each((u) => this.crsBins.add(u));
    this.civBins.clear();
    for (const o of this.bystanders.list) this.civBins.add(o);

    /* ---- agents ---- */
    for (const p of this.crowd.list) {
      if (this.order === 'push' && p.state !== 'flee' && p.state !== 'grabbed') p.state = 'push';
      else if (p.state === 'push') p.state = 'march';
    }
    this.groups = this.groupStats();
    this.crowd.update(dt);
    this.bystanders.update(dt);
    this.police.update(dt);
    this.fx.update(dt);
    this.melee();

    /* ---- stats ---- */
    this.stats = this.crowd.stats();
    this.controlT -= dt;
    if (this.controlT <= 0) { this.controlT = 0.5; this.control = this.sampleControl(); }

    /* ---- control points ---- */
    this.updateMouths(dt);

    /* ---- win / lose ---- */
    if (this.mouths.length && this.mouths.every((m) => m.freed)) {
      this.finish('win', 'Tous les débouchés sont libérés. La place est au cortège.');
    }
    if (this.control < 0.25) this.sweptT += dt; else this.sweptT = 0;
    if (this.sweptT > 20) {
      this.finish('lose', 'La place a été balayée : les compagnies tiennent l\'esplanade.');
    }
    if (this.stats.morale < 12) this.lowMoraleT += dt; else this.lowMoraleT = 0;
    const floor = Math.max(8, this.crowd.start * 0.22);
    if (this.crowd.count <= floor) {
      this.finish('lose', 'La foule est dispersée : il ne reste plus assez de monde sur la place.');
    } else if (this.lowMoraleT > 7) {
      this.finish('lose', 'La détermination s\'est effondrée, le cortège se vide.');
    }

    /* ---- camera ---- */
    if (Input.right) { this.cam.ox -= Input.dragX / this.cam.zoom; this.cam.oy -= Input.dragY / this.cam.zoom; }
    if (Input.wheel) this.cam.zoom = clamp(this.cam.zoom * (Input.wheel > 0 ? 0.88 : 1.14), 1.7, 13);
    const tx = clamp(this.stats.cx + this.cam.ox, 60, WORLD_W - 60);
    const ty = clamp(this.stats.cy + this.cam.oy, 60, WORLD_H - 60);
    this.cam.x = damp(this.cam.x, tx, 2.6, dt);
    this.cam.y = damp(this.cam.y, ty, 2.6, dt);

    if (this.messages.length) {
      const m = this.messages[0];
      m.t += dt;
      if (m.t > m.life) {
        this.messages.shift();
        if (this.pendingSay) { this.say(this.pendingSay.text, this.pendingSay.life); this.pendingSay = null; }
      }
    }
  }

  /* a street is freed once its company is beaten and the crowd holds the mouth */
  updateMouths(dt) {
    const need = clamp(Math.round(this.crowd.start * 0.07), 8, 25);
    for (const m of this.mouths) {
      if (m.freed) continue;
      m.need = need;
      /* a company that left to sweep the square no longer guards its street —
         and one that has been removed from the board never guards it again */
      const onBoard = m.squad && this.police.squads.indexOf(m.squad) >= 0;
      const away = onBoard && Math.hypot(m.squad.anchor[0] - m.x, m.squad.anchor[1] - m.y) > 40;
      m.open = !onBoard || m.squad.counted || away;
      if (!m.open) {                                   // the line still holds it
        m.progress = Math.max(0, m.progress - dt * 0.3);
        m.crowdHere = 0;
        continue;
      }
      const n = this.bins.count(m.x, m.y, 22);
      m.crowdHere = n;
      if (n >= need) m.progress = clamp(m.progress + dt / 7, 0, 1);
      else m.progress = Math.max(0, m.progress - dt * 0.25);
      if (m.progress >= 1) {
        m.freed = true;
        this.freedCount++;
        this.reinforce(m);
      }
    }
  }

  reinforce(m) {
    const s = m.squad && m.squad.streetRef;
    /* based on the original turnout, so freeing streets does not snowball */
    const k = clamp(Math.round(this.opts.protesters * 0.2), 10, 90);
    const added = s ? this.crowd.reinforce(k, s, this.map) : 0;
    for (const p of this.crowd.list) {
      if (p.group !== undefined) continue;
      let best = 0, bd = Infinity;
      for (let j = 0; j < this.rallies.length; j++) {
        const d = dist2(p.x, p.y, this.rallies[j][0], this.rallies[j][1]);
        if (d < bd) { bd = d; best = j; }
      }
      p.group = best;
    }
    this.say(m.street + ' est libéré — ' + added + ' manifestants arrivent en renfort.', 5);
    this.fx.shout(m.x, m.y, 'DÉBOUCHÉ LIBÉRÉ');
  }

  finish(type, line) {
    if (this.over) return;
    const mm = String(Math.floor(this.time / 60)).padStart(2, '0');
    const ss = String(Math.floor(this.time % 60)).padStart(2, '0');
    this.over = { type, t: 0, line, time: mm + ':' + ss };
  }

  /* bodies cannot overlap: this is what physically moves the police line */
  melee() {
    const map = this.map, tmp = this.crowd.tmp;
    /* shields and body armour win the shoving match: a braced line counts for
       more than four protesters, a charge still hits like three */
    const eff = (a) => (a.vehicle ? 18 : a.team === 'crs'
      ? (a.state === 'line' ? 4.6 : a.state === 'charge' ? 4.2 : 3.0)
      : a.team === 'civil' ? 0.7
        : (a.state === 'push' ? 2.1 : 1) * clamp(0.6 + a.morale / 110, 0.6, 1.5));

    const resolve = (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d >= min || d < 0.0001) return;
      const ea = eff(a), eb = eff(b);
      const ov = (min - d) * 0.6, tot = ea + eb;
      a.x -= dx / d * ov * (eb / tot); a.y -= dy / d * ov * (eb / tot);
      b.x += dx / d * ov * (ea / tot); b.y += dy / d * ov * (ea / tot);
      if (a.team !== b.team) {
        /* a bystander only ever gets jostled — never treated as a protester
           taking a baton: that bug used to stun the whole march */
        if (a.team === 'civil' || b.team === 'civil') {
          const civ = a.team === 'civil' ? a : b;
          const other = a.team === 'civil' ? b : a;
          civ.panic = Math.min(1.6, civ.panic + (other.team === 'crs' ? 0.05 : 0.008));
          return;
        }
        const crs = a.team === 'crs' ? a : b;
        const pr = a.team === 'crs' ? b : a;
        if (crs.vehicle) { pr.morale = clamp(pr.morale - 0.4, 0, 100); return; }
        /* shoving a shield wall wears the men behind it down, but less than it
           costs the people pushing */
        crs.stamina = Math.max(0, crs.stamina - (pr.state === 'push' ? 0.06 : 0.012));
        if (crs.stamina <= 0 && crs.state !== 'hurt') {
          if (crs.release) crs.release();
          crs.state = 'hurt';
          crs.squad.wounded++;
        }
        if (crs.charging) {
          /* taking a charge: knocked off balance, shoved back, badly shaken */
          pr.morale = clamp(pr.morale - 1.4, 0, 100);
          pr.stun = Math.max(pr.stun || 0, 0.45);
          const ux = (pr.x - crs.x) / (d || 1), uy = (pr.y - crs.y) / (d || 1);
          pr.x += ux * 0.45; pr.y += uy * 0.45;
          pr.vx += ux * 4; pr.vy += uy * 4;
        } else {
          pr.morale = clamp(pr.morale - 0.38, 0, 100);
          pr.stun = Math.max(pr.stun || 0, 0.12);
        }
      }
    };

    for (const a of this.crowd.list) {
      if (a.state === 'grabbed') continue;
      this.bins.near(a.x, a.y, 1.6, (b) => { if (b.id > a.id && b.state !== 'grabbed') resolve(a, b); });
      this.crsBins.near(a.x, a.y, 1.8, (u) => resolve(a, u));
      this.civBins.near(a.x, a.y, 1.6, (c) => resolve(a, c));
      if (!map.walkable(a.x, a.y)) { map.wallPush(a.x, a.y, tmp); a.x += tmp[0] * 0.8; a.y += tmp[1] * 0.8; }
    }
    for (const c of this.bystanders.list) {
      this.civBins.near(c.x, c.y, 1.5, (o) => { if (o.id > c.id) resolve(c, o); });
      this.crsBins.near(c.x, c.y, 1.8, (u) => resolve(c, u));
      if (!map.walkable(c.x, c.y)) { map.wallPush(c.x, c.y, tmp); c.x += tmp[0] * 0.8; c.y += tmp[1] * 0.8; }
    }
    this.police.each((u) => {
      this.crsBins.near(u.x, u.y, 1.8, (o) => { if (o.id > u.id) resolve(u, o); });
      if (!map.walkable(u.x, u.y)) { map.wallPush(u.x, u.y, tmp); u.x += tmp[0] * 0.8; u.y += tmp[1] * 0.8; }
    });
  }

  /* who holds the ground: sample the esplanade and ask who is nearest */
  sampleControl() {
    const p = this.map.plaza;
    const b = polyBounds(p);
    let held = 0, total = 0;
    for (let y = b.y0; y < b.y1; y += 14) {
      for (let x = b.x0; x < b.x1; x += 14) {
        if (!pointInPoly(x, y, p)) continue;
        total++;
        let crowd = 0, crs = 0;
        this.bins.near(x, y, 13, (a) => {
          const d = dist2(a.x, a.y, x, y);
          if (d < 169) crowd += 1 - Math.sqrt(d) / 13;
        });
        this.crsBins.near(x, y, 13, (a) => {
          const d = dist2(a.x, a.y, x, y);
          if (d < 169) crs += (1 - Math.sqrt(d) / 13) * 2.2;
        });
        if (crowd >= crs) held++;
      }
    }
    return total ? held / total : 1;
  }

  screenToWorld(sx, sy) {
    return [(sx - this.w / 2) / this.cam.zoom + this.cam.x, (sy - this.h / 2) / this.cam.zoom + this.cam.y];
  }

  /* ----------------------------- render --------------------------- */
  render(dt) {
    const ctx = this.ctx, { w, h, dpr } = this;
    const z = this.cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#23262b';
    ctx.fillRect(0, 0, w, h);

    /* secousse (tirs de lacrymo) appliquée à la caméra, pas au HUD */
    const sh = this.shakeOut || (this.shakeOut = [0, 0]);
    this.fx.camShake(sh);
    const camx = this.cam.x + sh[0], camy = this.cam.y + sh[1];

    const v = this.view;
    v.x0 = camx - w / 2 / z; v.y0 = camy - h / 2 / z;
    v.x1 = camx + w / 2 / z; v.y1 = camy + h / 2 / z;

    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.translate(-camx, -camy);

    this.map.drawCity(ctx, v);
    this.map.drawGround(ctx, v);
    this.fx.drawGround(ctx);
    this.map.drawProps(ctx, v);
    this.map.drawTrees(ctx, v);
    if (z > 3.2) this.streetLabels(ctx, z);
    this.drawObjectives(ctx, z);
    this.rallyMark(ctx, z);
    this.bystanders.draw(ctx, z);
    this.police.draw(ctx, z);
    this.crowd.draw(ctx, z);
    this.fx.drawAir(ctx, z);

    ctx.restore();

    /* a wash of daylight haze + vignette */
    const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, 'rgba(10,12,16,0.5)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    this.hud.draw(ctx, w, h, this);
  }

  /* hold line, break marker and capture rings, drawn on the ground */
  drawObjectives(ctx, z) {
    for (const m of this.mouths) {
      const sq = m.squad;
      const ax = m.axis[0], ay = m.axis[1];
      const nx = -ay, ny = ax;                  // across the street
      const half = (sq && sq.streetRef ? sq.streetRef.w : 24) / 2 - 1;

      if (sq && !sq.counted && !m.open) {
        /* where the line was ordered to stand */
        ctx.strokeStyle = 'rgba(235,240,250,0.35)';
        ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(m.x + nx * half, m.y + ny * half);
        ctx.lineTo(m.x - nx * half, m.y - ny * half);
        ctx.stroke();
        ctx.setLineDash([]);

        /* break marker: push them past it and the company is done */
        const deep = sq.deepest || 0;
        const bx = m.x + ax * (deep + 20), by = m.y + ay * (deep + 20);
        const done = clamp((sq.gain - deep) / 20, 0, 1);
        ctx.strokeStyle = done > 0.6 ? 'rgba(90,208,138,0.95)' : 'rgba(255,207,74,0.8)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(bx + nx * half, by + ny * half);
        ctx.lineTo(bx - nx * half, by - ny * half);
        ctx.stroke();
        for (let i = -1; i <= 1; i++) {
          const cx = bx + nx * half * i * 0.6, cy = by + ny * half * i * 0.6;
          ctx.beginPath();
          ctx.moveTo(cx - nx * 1.6 - ax * 2, cy - ny * 1.6 - ay * 2);
          ctx.lineTo(cx + ax * 1.4, cy + ay * 1.4);
          ctx.lineTo(cx + nx * 1.6 - ax * 2, cy + ny * 1.6 - ay * 2);
          ctx.stroke();
        }
        /* ground gained so far */
        if (Math.abs(sq.gain) > 1 && z > 3) {
          ctx.fillStyle = sq.gain > 0 ? 'rgba(90,208,138,0.25)' : 'rgba(224,74,58,0.22)';
          const g0 = Math.min(0, sq.gain), g1 = Math.max(0, sq.gain);
          ctx.beginPath();
          ctx.moveTo(m.x + ax * g0 + nx * half, m.y + ay * g0 + ny * half);
          ctx.lineTo(m.x + ax * g1 + nx * half, m.y + ay * g1 + ny * half);
          ctx.lineTo(m.x + ax * g1 - nx * half, m.y + ay * g1 - ny * half);
          ctx.lineTo(m.x + ax * g0 - nx * half, m.y + ay * g0 - ny * half);
          ctx.closePath(); ctx.fill();
        }
      } else if (!m.freed && m.open) {
        /* the street is unguarded: hold the mouth to free it */
        ctx.strokeStyle = 'rgba(255,207,74,0.75)';
        ctx.lineWidth = 0.7;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(m.x, m.y, 22, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#5ad08a'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(m.x, m.y, 22, -Math.PI / 2, -Math.PI / 2 + TAU * m.progress); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(90,208,138,0.18)';
        ctx.beginPath(); ctx.arc(m.x, m.y, 20, 0, TAU); ctx.fill();
      }
    }
  }

  rallyMark(ctx, z) {
    const groups = this.groups || [];
    for (let i = 0; i < this.rallies.length; i++) {
      const [x, y] = this.rallies[i];
      const active = i === this.activeRally;
      const pulse = 1 + Math.sin(this.time * 4 + i) * 0.12;
      ctx.strokeStyle = this.order === 'push' ? 'rgba(224,74,58,0.9)'
        : this.order === 'fallback' ? 'rgba(74,160,255,0.9)'
          : active ? 'rgba(255,207,74,0.9)' : 'rgba(255,207,74,0.45)';
      ctx.lineWidth = active ? 0.45 : 0.3;
      ctx.beginPath(); ctx.arc(x, y, 3.4 * pulse, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 0.7, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 6); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(x, y - 6, 4, 2.4);
      if (z > 2.4) {
        ctx.font = '700 ' + (9 / z).toFixed(2) + 'px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1) + (groups[i] ? ' · ' + groups[i].n : ''), x, y - 7.5);
      }
    }
  }

  streetLabels(ctx, z) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(240,238,230,0.5)';
    for (const l of this.map.labels()) {
      if (l.x < this.view.x0 || l.x > this.view.x1 || l.y < this.view.y0 || l.y > this.view.y1) continue;
      ctx.save();
      ctx.translate(l.x, l.y);
      let a = l.ang * Math.PI / 180;
      if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI;
      ctx.rotate(a);
      ctx.font = '600 ' + (10 / z).toFixed(2) + 'px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(l.name.toUpperCase(), 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

/* ------------------------------- boot ------------------------------ */
const game = new Game(document.getElementById('game'));
let last = performance.now();
let errors = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(raw, 0.05);
  game.fps = lerp(game.fps, 1 / Math.max(raw, 0.0001), 0.08);
  try {
    game.sound.update(dt, game);
    if (game.over) {
      game.update(dt);
      if (Input.hit('KeyM')) game.sound.toggle();
      else if (game.over.t > 0.9 && Input.anyHit()) { game.reset(); }
    } else if (!game.paused) {
      game.update(dt);
      if (Input.hit('F3')) game.debug = !game.debug;
      if (Input.hit('KeyM')) game.sound.toggle();
      if (Input.hit('Escape')) { game.paused = true; document.getElementById('boot').style.display = 'flex'; }
    }
    game.render(dt);
  } catch (e) {
    if (errors++ < 5) console.error('frame error', e);
  }
  Input.endFrame();
}
requestAnimationFrame(frame);

/* ----------------------------- menu UI ----------------------------- */
(function menu() {
  const nb = document.getElementById('nb'), nbVal = document.getElementById('nbVal');
  const crs = document.getElementById('crs'), crsVal = document.getElementById('crsVal');
  let ratio = 0.167;
  const preview = () => {
    if (!crsVal) return;
    const f = Game.force({ protesters: nb ? parseInt(nb.value, 10) : 180, ratio });
    crsVal.textContent = f.total + ' CRS · ' + f.companies + ' compagnies de ' + f.per;
  };
  if (nb) nb.addEventListener('input', () => { nbVal.textContent = nb.value; preview(); });
  if (crs) {
    crs.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      [...crs.children].forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      ratio = parseFloat(b.dataset.v);
      preview();
    });
  }
  preview();
  const start = document.getElementById('startBtn');
  if (start) {
    start.addEventListener('click', () => {
      game.opts.protesters = nb ? parseInt(nb.value, 10) : 180;
      game.opts.ratio = ratio;
      game.reset();
      document.getElementById('boot').style.display = 'none';
      game.paused = false;
      game.sound.start();
      last = performance.now();
    });
  }
  const Q = new URLSearchParams(location.search);
  if (Q.has('auto')) {
    game.opts.protesters = parseInt(Q.get('nb') || '180', 10);
    game.opts.ratio = parseFloat(Q.get('ratio') || '0.167');
    game.reset();
    const boot = document.getElementById('boot');
    if (boot) boot.style.display = 'none';
    game.paused = false;
    game.sound.start();
    if (Q.has('debug')) game.debug = true;
    if (Q.has('zoom')) game.cam.zoom = parseFloat(Q.get('zoom'));
    if (Q.has('order')) game.forcedOrder = Q.get('order');
    if (Q.has('demo')) game.demo = true;
    if (Q.has('warm')) {
      const n = Math.min(180, parseFloat(Q.get('warm'))) * 60;
      for (let i = 0; i < n; i++) game.update(1 / 60);
    }
  }
})();
