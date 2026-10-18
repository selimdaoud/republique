'use strict';
/* ------------------------------------------------------------------ *
 *  map.js — Place de la République: esplanade, percées, ruelles,
 *  immeubles haussmanniens, grille de navigation et champs de flux.
 *  Géométrie relevée sur la vue satellite (1 unité = 1 mètre).
 * ------------------------------------------------------------------ */

const WORLD_W = 918, WORLD_H = 753;
const CELL = 2;                       // navigation grid resolution (m)

/* esplanade, clockwise: N, E, S, W corners */
const PLAZA = [290, 200, 578, 338, 520, 492, 232, 352];

/* edge index: 0 = N->E, 1 = E->S, 2 = S->W, 3 = W->N
   t = position along that edge, ang = heading out (deg, 0 = east, 90 = south) */
const STREETS = [
  { name: 'Bd de Magenta', edge: 3, t: 0.97, ang: 232, len: 300, w: 34 },
  { name: 'Rue du Château d\'Eau', edge: 3, t: 0.62, ang: 203, len: 300, w: 20 },
  { name: 'Bd Saint-Martin', edge: 3, t: 0.22, ang: 190, len: 260, w: 30 },
  { name: 'Rue du Temple', edge: 2, t: 0.80, ang: 130, len: 280, w: 24 },
  { name: 'Rue Béranger', edge: 2, t: 0.55, ang: 96, len: 240, w: 16 },
  { name: 'Bd du Temple', edge: 2, t: 0.28, ang: 76, len: 300, w: 30 },
  { name: 'Bd Voltaire', edge: 1, t: 0.96, ang: 53, len: 320, w: 32 },
  { name: 'Rue de Malte', edge: 1, t: 0.45, ang: 17, len: 260, w: 18 },
  { name: 'Av. de la République', edge: 1, t: 0.05, ang: -7, len: 340, w: 32 },
  { name: 'Rue du Fbg-du-Temple', edge: 0, t: 0.94, ang: -16, len: 340, w: 26 },
  { name: 'Rue Léon Jouhaux', edge: 0, t: 0.82, ang: -65, len: 260, w: 18 },
  { name: 'Rue Yves Toudic', edge: 0, t: 0.55, ang: -78, len: 250, w: 18 },
];

const ROOF = ['#6f7580', '#787e88', '#656b76', '#727883', '#6a707b'];
const FACADE = '#b4a994';

class ParisMap {
  constructor() {
    RNG = mulberry32(0x1789);
    this.plaza = PLAZA.slice();
    this.centre = polyCentroid(PLAZA);
    this.streets = [];
    this.alleys = [];
    this.trees = [];
    this.props = [];
    this.roofs = [];                  // courtyards, ridges, chimneys
    this.monument = { x: 322, y: 350, r: 7.5 };
    this.basin = { x: 346, y: 338, w: 46, h: 24 };   // miroir d'eau

    this.buildStreets();
    this.buildAlleys();
    this.buildMask();
    this.buildClearance();
    this.scatter();

    /* navigation fields : un par cible du joueur */
    this.fields = [];
    this.flowTargets = [];
    for (let i = 0; i < MAX_TARGETS; i++) {
      this.fields.push(new Int32Array(this.cols * this.rows));
      this.flowTargets.push([this.centre[0], this.centre[1]]);
    }
    this.cost = this.fields[0];            // compatibilité : la cible principale
    this.fromPlaza = new Int32Array(this.cols * this.rows);
    this.buckets = [];
    this.computeField(this.fields[0], [[this.centre[0], this.centre[1]]]);
    this.computeField(this.fromPlaza, this.plazaSeeds());
  }

  /* ------------------------- geometry ----------------------------- */
  edgePoint(edge, t) {
    const p = this.plaza;
    const i = edge * 2, j = ((edge + 1) % 4) * 2;
    return [lerp(p[i], p[j], t), lerp(p[i + 1], p[j + 1], t)];
  }

  buildStreets() {
    for (const s of STREETS) {
      const [sx, sy] = this.edgePoint(s.edge, s.t);
      const a = s.ang * Math.PI / 180;
      const ex = sx + Math.cos(a) * s.len, ey = sy + Math.sin(a) * s.len;
      /* start a little inside the esplanade so the mouths connect cleanly */
      const ix = sx - Math.cos(a) * 34, iy = sy - Math.sin(a) * 34;
      this.streets.push({
        name: s.name, w: s.w, ang: a,
        sx: ix, sy: iy, ex, ey,
        mouth: [sx, sy],
        poly: corridor(ix, iy, ex, ey, s.w),
      });
    }
  }

  /* ruelles: short links between neighbouring streets, plus dead ends */
  buildAlleys() {
    const n = this.streets.length;
    for (let i = 0; i < n; i++) {
      const a = this.streets[i], b = this.streets[(i + 1) % n];
      const links = ri(1, 2);
      for (let k = 0; k < links; k++) {
        const da = rr(0.32, 0.86), db = da + rr(-0.12, 0.12);
        const ax = lerp(a.sx, a.ex, da), ay = lerp(a.sy, a.ey, da);
        const bx = lerp(b.sx, b.ex, clamp(db, 0.25, 0.9)), by = lerp(b.sy, b.ey, clamp(db, 0.25, 0.9));
        if (Math.hypot(bx - ax, by - ay) > 260) continue;
        this.alleys.push({
          name: 'ruelle', w: rr(8, 13),
          poly: corridor(ax, ay, bx, by, rr(8, 13)),
          sx: ax, sy: ay, ex: bx, ey: by,
        });
      }
    }
  }

  walkPolys() {
    const out = [this.plaza];
    for (const s of this.streets) out.push(s.poly);
    for (const a of this.alleys) out.push(a.poly);
    return out;
  }

  /* --------------------- navigation raster ------------------------ */
  cellIndex(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }

  buildMask() {
    this.cols = Math.ceil(WORLD_W / CELL);
    this.rows = Math.ceil(WORLD_H / CELL);
    const mask = this.mask = new Uint8Array(this.cols * this.rows);
    for (const poly of this.walkPolys()) {
      const b = polyBounds(poly);
      const x0 = Math.max(0, Math.floor(b.x0 / CELL)), x1 = Math.min(this.cols - 1, Math.ceil(b.x1 / CELL));
      const y0 = Math.max(0, Math.floor(b.y0 / CELL)), y1 = Math.min(this.rows - 1, Math.ceil(b.y1 / CELL));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (mask[cy * this.cols + cx]) continue;
          if (pointInPoly(cx * CELL + CELL / 2, cy * CELL + CELL / 2, poly)) mask[cy * this.cols + cx] = 1;
        }
      }
    }
    /* the basin is decorative: a 25 cm sheet of water does not stop a march,
       and blocking it pinched the esplanade in two */
    /* the monument and its steps are solid */
    const m = this.monument, R = m.r + 3;
    for (let cy = Math.floor((m.y - R) / CELL); cy <= Math.ceil((m.y + R) / CELL); cy++) {
      for (let cx = Math.floor((m.x - R) / CELL); cx <= Math.ceil((m.x + R) / CELL); cx++) {
        const i = cy * this.cols + cx;
        if (i < 0 || i >= mask.length) continue;
        if (dist2(cx * CELL + 1, cy * CELL + 1, m.x, m.y) < R * R) mask[i] = 0;
      }
    }
  }

  /* distance (in cells) to the nearest wall — keeps agents off facades */
  buildClearance() {
    const { cols, rows, mask } = this;
    const d = this.clear = new Int16Array(cols * rows);
    const BIG = 9999;
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? BIG : 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) v = Math.min(v, d[i - cols] + 1);
        if (x > 0 && y > 0) v = Math.min(v, d[i - cols - 1] + 1);
        if (x < cols - 1 && y > 0) v = Math.min(v, d[i - cols + 1] + 1);
        d[i] = v;
      }
    }
    for (let y = rows - 1; y >= 0; y--) {
      for (let x = cols - 1; x >= 0; x--) {
        const i = y * cols + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x < cols - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < rows - 1) v = Math.min(v, d[i + cols] + 1);
        if (x < cols - 1 && y < rows - 1) v = Math.min(v, d[i + cols + 1] + 1);
        if (x > 0 && y < rows - 1) v = Math.min(v, d[i + cols - 1] + 1);
        d[i] = v;
      }
    }
  }

  plazaSeeds() {
    const seeds = [];
    const b = polyBounds(this.plaza);
    for (let y = b.y0; y < b.y1; y += 8) {
      for (let x = b.x0; x < b.x1; x += 8) {
        if (pointInPoly(x, y, this.plaza)) seeds.push([x, y]);
      }
    }
    return seeds;
  }

  nearestWalkable(x, y) {
    let i = this.cellIndex(x, y);
    if (i >= 0 && this.mask[i]) return i;
    for (let r = 1; r < 40; r++) {
      for (let a = 0; a < 16; a++) {
        const th = a / 16 * TAU;
        i = this.cellIndex(x + Math.cos(th) * r * CELL, y + Math.sin(th) * r * CELL);
        if (i >= 0 && this.mask[i]) return i;
      }
    }
    return -1;
  }

  /* bucket-queue Dijkstra over the walkable mask (8-connected) */
  computeField(field, seeds) {
    const { cols, rows, mask } = this;
    field.fill(0x3fffffff);
    const buckets = this.buckets;
    buckets.length = 0;
    const push = (i, c) => {
      if (!buckets[c]) buckets[c] = [];
      buckets[c].push(i);
    };
    for (const [sx, sy] of seeds) {
      const i = this.nearestWalkable(sx, sy);
      if (i >= 0 && field[i] > 0) { field[i] = 0; push(i, 0); }
    }
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DY = [0, 0, 1, -1, 1, -1, 1, -1];
    const DC = [7, 7, 7, 7, 10, 10, 10, 10];
    for (let c = 0; c < buckets.length; c++) {
      const bucket = buckets[c];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        if (field[i] !== c) continue;
        const x = i % cols, y = (i / cols) | 0;
        for (let d = 0; d < 8; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (!mask[j]) continue;
          const nc = c + DC[d];
          if (nc < field[j]) { field[j] = nc; push(j, nc); }
        }
      }
      bucket.length = 0;
    }
  }

  setRally(i, x, y) {
    const k = clamp(i | 0, 0, this.fields.length - 1);
    this.flowTargets[k][0] = x; this.flowTargets[k][1] = y;
    this.computeField(this.fields[k], [[x, y]]);
    if (k === 0) this.cost = this.fields[0];
  }

  /* unit vector pointing down a field (or up it when `up`) */
  fieldDir(field, x, y, up, out) {
    const { cols, rows } = this;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = up ? -1 : 0x3fffffff, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (!this.mask[j]) continue;
        const v = field[j];
        if (v >= 0x3fffffff) continue;
        if (up ? v > best : v < best) { best = v; bx = dx; by = dy; }
      }
    }
    const l = Math.hypot(bx, by) || 1;
    out[0] = bx / l; out[1] = by / l;
    return best !== (up ? -1 : 0x3fffffff);
  }

  /* push away from facades when too close */
  wallPush(x, y, out) {
    const i = this.cellIndex(x, y);
    out[0] = 0; out[1] = 0;
    if (i < 0) { out[0] = this.centre[0] - x; out[1] = this.centre[1] - y; return 2; }
    const c = this.clear[i];
    if (c > 2) return 0;
    const { cols, rows } = this;
    const cx = i % cols, cy = (i / cols) | 0;
    let best = c, bx = 0, by = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const v = this.clear[ny * cols + nx];
        if (v > best) { best = v; bx = dx; by = dy; }
      }
    }
    const l = Math.hypot(bx, by) || 1;
    out[0] = bx / l; out[1] = by / l;
    return c <= 1 ? 2 : 1;
  }

  walkable(x, y) { const i = this.cellIndex(x, y); return i >= 0 && !!this.mask[i]; }
  onPlaza(x, y) { return pointInPoly(x, y, this.plaza); }
  /* metres away from the esplanade, along the streets */
  distFromPlaza(x, y) {
    const i = this.cellIndex(x, y);
    if (i < 0) return 999;
    const v = this.fromPlaza[i];
    return v >= 0x3fffffff ? 999 : v / 7 * CELL;
  }

  /* --------------------------- dressing --------------------------- */
  scatter() {
    /* plane trees along the north edge of the esplanade (double row) */
    const [nx0, ny0] = [this.plaza[0], this.plaza[1]];
    const [nx1, ny1] = [this.plaza[2], this.plaza[3]];
    for (let t = 0.08; t < 0.95; t += 0.052) {
      for (let row = 0; row < 2; row++) {
        const x = lerp(nx0, nx1, t) + row * 9 + 10;
        const y = lerp(ny0, ny1, t) + row * 12 + 16;
        if (this.onPlaza(x, y)) this.trees.push({ x, y, r: rr(4.5, 6), t: RNG() });
      }
    }
    /* Square André-Tollet, south-east of the esplanade */
    for (let i = 0; i < 26; i++) {
      const x = rr(452, 516), y = rr(392, 452);
      if (this.onPlaza(x, y)) this.trees.push({ x, y, r: rr(4, 5.8), t: RNG(), square: true });
    }
    /* alignment trees along the boulevards */
    for (const s of this.streets) {
      if (s.w < 24) continue;
      const L = Math.hypot(s.ex - s.sx, s.ey - s.sy);
      const nx = -(s.ey - s.sy) / L, ny = (s.ex - s.sx) / L;
      for (let d = 30; d < L - 10; d += 22) {
        for (const side of [-1, 1]) {
          const off = s.w / 2 - 3.5;
          const x = lerp(s.sx, s.ex, d / L) + nx * off * side;
          const y = lerp(s.sy, s.ey, d / L) + ny * off * side;
          if (this.walkable(x, y)) this.trees.push({ x, y, r: rr(3.5, 5), t: RNG() });
        }
      }
    }
    /* courtyards, roof ridges and chimneys inside the blocks */
    for (let i = 0; i < 900; i++) {
      const x = rr(0, WORLD_W), y = rr(0, WORLD_H);
      if (this.walkable(x, y)) continue;
      const ci = this.cellIndex(x, y);
      if (ci < 0) continue;
      const kind = RNG();
      if (kind < 0.22) {
        const w = rr(14, 34), h = rr(12, 26);
        if (this.blockedRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12)) {
          this.roofs.push({ kind: 'court', x: x - w / 2, y: y - h / 2, w, h });
        }
      } else if (kind < 0.55) {
        const w = rr(16, 46), h = rr(3, 5);
        const a = chance(0.5) ? 0 : Math.PI / 2;
        if (this.blockedRect(x - w / 2, y - h / 2, w, h)) {
          this.roofs.push({ kind: 'ridge', x, y, w, h, a });
        }
      } else {
        this.roofs.push({ kind: 'chimney', x, y, w: rr(2, 4), h: rr(2, 3.4) });
      }
    }
    /* street furniture on the esplanade */
    this.props.push({ kind: 'metro', x: 268, y: 338, a: 0.3, label: 'RÉPUBLIQUE' });
    this.props.push({ kind: 'metro', x: 292, y: 404, a: -0.2, label: 'TEMPLE' });
    this.props.push({ kind: 'kiosk', x: 430, y: 300, a: 0.2 });
    this.props.push({ kind: 'kiosk', x: 470, y: 420, a: -0.4 });
    for (let i = 0; i < 14; i++) {
      const x = rr(300, 540), y = rr(250, 470);
      if (this.onPlaza(x, y) && dist2(x, y, this.monument.x, this.monument.y) > 50 * 50) {
        this.props.push({ kind: 'bench', x, y, a: RNG() * Math.PI });
      }
    }
  }

  blockedRect(x, y, w, h) {
    for (let yy = y; yy <= y + h; yy += CELL) {
      for (let xx = x; xx <= x + w; xx += CELL) {
        if (this.walkable(xx, yy)) return false;
      }
    }
    return true;
  }

  /* ---------------------------- render ---------------------------- */
  path(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
    ctx.closePath();
  }

  drawCity(ctx, v) {
    /* roofs first: anything not carved out by a street stays a block */
    ctx.fillStyle = ROOF[0];
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let gx = Math.floor(v.x0 / 60) * 60; gx < v.x1; gx += 60) {
      ctx.fillRect(gx, v.y0, 30, v.y1 - v.y0);
    }
    for (const r of this.roofs) {
      if (r.x < v.x0 - 60 || r.x > v.x1 + 60 || r.y < v.y0 - 60 || r.y > v.y1 + 60) continue;
      if (r.kind === 'court') {
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#6a6358';
        ctx.fillRect(r.x + 2.5, r.y + 2.5, r.w - 5, r.h - 5);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(r.x + 2.5, r.y + 2.5, r.w - 5, 2);
      } else if (r.kind === 'ridge') {
        ctx.save();
        ctx.translate(r.x, r.y); ctx.rotate(r.a);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(-r.w / 2, r.h / 2, r.w, 1.6);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.33)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
  }

  drawGround(ctx, v) {
    /* warm facade band: stroked first, the ground fills then cover its inner
       half and leave a lit strip along every building front */
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = FACADE;
    ctx.lineWidth = 9;
    for (const poly of this.walkPolys()) {
      const b = polyBounds(poly);
      if (b.x1 < v.x0 - 20 || b.x0 > v.x1 + 20 || b.y1 < v.y0 - 20 || b.y0 > v.y1 + 20) continue;
      this.path(ctx, poly); ctx.stroke();
    }
    ctx.restore();

    /* streets and ruelles */
    for (const s of this.streets) {
      ctx.fillStyle = '#3b3e44';
      this.path(ctx, s.poly); ctx.fill();
    }
    for (const a of this.alleys) {
      ctx.fillStyle = '#44464c';
      this.path(ctx, a.poly); ctx.fill();
    }
    /* esplanade */
    ctx.fillStyle = '#9a948a';
    this.path(ctx, this.plaza); ctx.fill();
    /* paving pattern */
    ctx.save();
    this.path(ctx, this.plaza); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.09)'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 220; x < 600; x += 7) { ctx.moveTo(x, 180); ctx.lineTo(x + 40, 510); }
    for (let y = 180; y < 510; y += 7) { ctx.moveTo(220, y); ctx.lineTo(600, y + 14); }
    ctx.stroke();
    /* the green of Square André-Tollet */
    ctx.fillStyle = '#6d7a58';
    ctx.beginPath(); ctx.ellipse(484, 422, 42, 32, 0.2, 0, TAU); ctx.fill();
    /* parvis around the monument + the shallow basin east of it */
    ctx.fillStyle = '#8d8578';
    ctx.beginPath(); ctx.ellipse(324, 351, 24, 18, 0.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7f8c8e';
    ctx.fillRect(this.basin.x - 2, this.basin.y - 2, this.basin.w + 4, this.basin.h + 4);
    ctx.fillStyle = '#93a4a6';
    ctx.fillRect(this.basin.x, this.basin.y, this.basin.w, this.basin.h);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(this.basin.x + 3, this.basin.y + 3, this.basin.w - 6, 4);
    /* granite strips across the esplanade */
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const t = 0.17 + i * 0.1;
      ctx.moveTo(lerp(this.plaza[6], this.plaza[0], t), lerp(this.plaza[7], this.plaza[1], t));
      ctx.lineTo(lerp(this.plaza[4], this.plaza[2], t), lerp(this.plaza[5], this.plaza[3], t));
    }
    ctx.stroke();
    ctx.restore();

    /* kerb around the esplanade */
    ctx.strokeStyle = 'rgba(214,208,196,0.55)'; ctx.lineWidth = 2.2;
    this.path(ctx, this.plaza); ctx.stroke();

    /* kerbs + lane markings in the streets */
    for (const s of this.streets) {
      const L = Math.hypot(s.ex - s.sx, s.ey - s.sy);
      const dx = (s.ex - s.sx) / L, dy = (s.ey - s.sy) / L;
      ctx.save();
      this.path(ctx, s.poly); ctx.clip();
      ctx.strokeStyle = 'rgba(230,230,225,0.35)';
      ctx.lineWidth = 0.7;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.ex, s.ey);
      ctx.stroke();
      ctx.setLineDash([]);
      /* sidewalks */
      ctx.strokeStyle = 'rgba(190,185,175,0.5)'; ctx.lineWidth = 5;
      const nx = -dy, ny = dx;
      for (const side of [-1, 1]) {
        const o = (s.w / 2 - 2.5) * side;
        ctx.beginPath();
        ctx.moveTo(s.sx + nx * o, s.sy + ny * o);
        ctx.lineTo(s.ex + nx * o, s.ey + ny * o);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* soft shadow of the facades onto the open ground */
    ctx.save();
    for (const poly of this.walkPolys()) {
      const b = polyBounds(poly);
      if (b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1) continue;
      ctx.save();
      this.path(ctx, poly); ctx.clip();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 11;
      ctx.strokeStyle = 'rgba(0,0,0,0.42)';
      ctx.lineWidth = 7;
      this.path(ctx, poly); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawProps(ctx, v) {
    const m = this.monument;
    /* Monument à la République */
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(m.x + 2, m.y + 2.5, m.r + 3.4, m.r + 3.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8e8679';
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#a89e8d';
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6f8a72';            // bronze patiné
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5a7560';
    ctx.beginPath(); ctx.arc(m.x, m.y - 0.8, m.r * 0.24, 0, TAU); ctx.fill();

    for (const p of this.props) {
      if (p.x < v.x0 - 20 || p.x > v.x1 + 20 || p.y < v.y0 - 20 || p.y > v.y1 + 20) continue;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.a || 0);
      if (p.kind === 'metro') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-4, -2.5, 9, 6);
        ctx.fillStyle = '#2f5f3a'; ctx.fillRect(-4.5, -3, 9, 6);
        ctx.fillStyle = '#ffd94a'; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, TAU); ctx.fill();
      } else if (p.kind === 'kiosk') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-3, -2, 7, 5);
        ctx.fillStyle = '#3e4a56'; ctx.fillRect(-3.5, -2.5, 7, 5);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-1.6, -0.5, 4, 1.6);
        ctx.fillStyle = '#7a6a52'; ctx.fillRect(-2, -0.8, 4, 1.6);
      }
      ctx.restore();
    }
  }

  drawTrees(ctx, v) {
    for (const t of this.trees) {
      if (t.x < v.x0 - 12 || t.x > v.x1 + 12 || t.y < v.y0 - 12 || t.y > v.y1 + 12) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath(); ctx.ellipse(t.x + 2.5, t.y + 3, t.r, t.r * 0.9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = t.t > 0.5 ? '#4e6b3f' : '#577346';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(150,185,120,0.3)';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.3, t.r * 0.45, 0, TAU); ctx.fill();
    }
  }

  nearestStreet(x, y) {
    let best = this.streets[0], bd = Infinity;
    for (const s of this.streets) {
      const mx = lerp(s.sx, s.ex, 0.3), my = lerp(s.sy, s.ey, 0.3);
      const d = dist2(mx, my, x, y);
      if (d < bd) { bd = d; best = s; }
    }
    return best.name;
  }

  /* street names, drawn in screen space by the HUD layer */
  labels() {
    return this.streets.map((s) => ({
      name: s.name,
      x: lerp(s.sx, s.ex, 0.42), y: lerp(s.sy, s.ey, 0.42),
      ang: s.ang,
    }));
  }
}
