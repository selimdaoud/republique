'use strict';
/* ------------------------------------------------------------------ *
 *  util.js — maths, RNG, polygons, agent bins, input
 *  Units: 1 world unit = 1 metre.
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let RNG = mulberry32(0x1789);
let AGENT_ID = 0;

/* nombre de cibles que le joueur peut tenir en même temps */
const MAX_TARGETS = 2;
const rr = (a, b) => a + RNG() * (b - a);
const ri = (a, b) => Math.floor(a + RNG() * (b - a + 1));
const pick = (a) => a[Math.floor(RNG() * a.length)];
const chance = (p) => RNG() < p;

function angNorm(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
const angDelta = (a, b) => angNorm(b - a);

/* ---------------------------- polygons ---------------------------- */
/* polygons are flat arrays [x0,y0, x1,y1, ...] */
function pointInPoly(px, py, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyBounds(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
  }
  return { x0, y0, x1, y1 };
}
/* oriented corridor: a rectangle from a to b of a given width */
function corridor(ax, ay, bx, by, width) {
  const dx = bx - ax, dy = by - ay;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * width / 2, ny = dx / L * width / 2;
  return [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny];
}
function polyCentroid(p) {
  let x = 0, y = 0, n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; }
  return [x / n, y / n];
}

/* --------------------- agent bins (broad phase) -------------------- */
class Bins {
  constructor(w, h, cell) {
    this.cell = cell;
    this.cols = Math.ceil(w / cell) + 1;
    this.rows = Math.ceil(h / cell) + 1;
    this.bins = new Array(this.cols * this.rows);
    for (let i = 0; i < this.bins.length; i++) this.bins[i] = [];
  }
  clear() { for (let i = 0; i < this.bins.length; i++) this.bins[i].length = 0; }
  add(a) {
    const cx = Math.floor(a.x / this.cell), cy = Math.floor(a.y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    this.bins[cy * this.cols + cx].push(a);
  }
  /* visits every agent in the cells covering the disc; fn(agent) */
  near(x, y, r, fn) {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const bin = this.bins[row + cx];
        for (let i = 0; i < bin.length; i++) fn(bin[i]);
      }
    }
  }
  count(x, y, r) { let n = 0; const r2 = r * r; this.near(x, y, r, (a) => { if (dist2(a.x, a.y, x, y) < r2) n++; }); return n; }
}

/* ------------------------------ input ----------------------------- */
const Input = {
  keys: Object.create(null),
  pressed: Object.create(null),
  mx: 0, my: 0,                 // screen px
  wx: 0, wy: 0,                 // world (filled by the camera each frame)
  left: false, right: false,
  clicked: false,
  wheel: 0,
  dragX: 0, dragY: 0,
  down(c) { return !!this.keys[c]; },
  any(list) { for (const c of list) if (this.keys[c]) return true; return false; },
  hit(c) { if (this.pressed[c]) { this.pressed[c] = false; return true; } return false; },
  anyHit() {
    if (this.clicked) { this.clicked = false; return true; }
    for (const k in this.pressed) if (this.pressed[k]) { this.pressed = Object.create(null); return true; }
    return false;
  },
  endFrame() { this.pressed = Object.create(null); this.clicked = false; this.wheel = 0; this.dragX = 0; this.dragY = 0; },
};
const BLOCK_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', (e) => {
  if (!Input.keys[e.code]) Input.pressed[e.code] = true;
  Input.keys[e.code] = true;
  if (BLOCK_KEYS.indexOf(e.code) >= 0) e.preventDefault();
});
window.addEventListener('keyup', (e) => { Input.keys[e.code] = false; });
window.addEventListener('blur', () => { Input.keys = Object.create(null); Input.left = false; Input.right = false; });
window.addEventListener('mousemove', (e) => {
  if (Input.right) { Input.dragX += e.movementX; Input.dragY += e.movementY; }
  Input.mx = e.clientX; Input.my = e.clientY;
});
window.addEventListener('mousedown', (e) => {
  if (e.button === 0) { Input.left = true; Input.clicked = true; }
  if (e.button === 2) Input.right = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) Input.left = false;
  if (e.button === 2) Input.right = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => { Input.wheel += Math.sign(e.deltaY); }, { passive: true });

const KEY = {
  push: ['Space'],
  fallback: ['KeyR'],
  flare: ['KeyF'],
};
