'use strict';
/* ------------------------------------------------------------------ *
 *  sound.js — ambiance sonore de la manifestation (boucle continue)
 *  Un élément <audio> plutôt que WebAudio : ça marche aussi en file://,
 *  sans serveur, quand on ouvre index.html d'un double-clic.
 * ------------------------------------------------------------------ */

const AMBIENCE_SOURCES = ['bruits/fond.mp3', 'fond.mp3'];

class Ambience {
  constructor(sources) {
    this.sources = sources.slice();
    this.index = 0;
    this.muted = false;
    this.level = 0;          // volume courant, monté en fondu
    this.target = 0;
    this.ready = false;
    this.blocked = false;    // l'autoplay a été refusé, on retentera
    this.el = null;
    this.load();
  }

  load() {
    if (this.index >= this.sources.length) { this.el = null; return; }
    const el = new Audio();
    el.src = this.sources[this.index];
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    el.addEventListener('canplaythrough', () => { this.ready = true; }, { once: true });
    el.addEventListener('playing', () => { this.blocked = false; });
    el.addEventListener('error', () => {
      /* pas trouvé ici : on essaie l'emplacement suivant */
      this.index++;
      this.load();
      if (this.playing) this.start();
    });
    this.el = el;
  }

  start() {
    this.playing = true;
    if (!this.el) return;
    const p = this.el.play();
    if (p && p.catch) {
      p.catch(() => {
        /* le navigateur exige un geste de l'utilisateur : on réessaiera */
        this.blocked = true;
        this.armRetry();
      });
    } else this.blocked = false;
  }

  /* l'autoplay refusé se débloque au premier geste de l'utilisateur */
  armRetry() {
    if (this.armed) return;
    this.armed = true;
    const go = () => {
      if (!this.playing || this.muted || !this.el) return;
      const p = this.el.play();
      if (p && p.catch) p.catch(() => {});
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }

  stop() { this.playing = false; if (this.el) this.el.pause(); }

  toggle() {
    this.muted = !this.muted;
    if (this.muted) { if (this.el) this.el.pause(); }
    else if (this.playing && this.el) { const p = this.el.play(); if (p && p.catch) p.catch(() => {}); }
    return !this.muted;
  }

  /* la rumeur monte quand ça chauffe : contact, gaz, charges */
  update(dt, g) {
    if (!this.el) return;
    let heat = g.police ? g.police.alarm * 0.55 : 0;
    let contact = 0;
    if (g.police) for (const s of g.police.squads) contact = Math.max(contact, s.ratio);
    heat += clamp(contact / 2, 0, 0.3);
    if (g.fx) heat += clamp(g.fx.clouds.length * 0.04, 0, 0.18);
    if (g.police && g.police.hasCannon) heat += 0.08;

    this.target = g.over ? 0.3 : g.paused ? 0 : clamp(0.42 + heat, 0, 1);
    this.level = damp(this.level, this.muted ? 0 : this.target, 1.2, dt);
    try { this.el.volume = clamp(this.level, 0, 1); } catch (e) { /* ignore */ }

    if (this.playing && !this.muted && this.el.paused) this.armRetry();
  }
}

/* ------------------------------------------------------------------ *
 *  Bruitages ponctuels : un tir de grenade = un son tiré au hasard,
 *  plusieurs tirs = plusieurs sons qui se superposent.
 * ------------------------------------------------------------------ */

const GRENADE_SOURCES = [
  'bruits/grenades/grenade1.mp3', 'bruits/grenades/grenade2.mp3',
  'bruits/grenades/grenade3.mp3', 'bruits/grenades/grenade4.mp3',
  'bruits/grenades/grenade5.mp3', 'bruits/grenades/grenade6.mp3',
];

class Sfx {
  constructor(game, sources) {
    this.g = game;
    this.sources = sources.slice();
    this.active = 0;
    this.maxActive = 7;        // au-delà ça ne fait plus qu'une bouillie
    this.played = 0;
    this.lastIndex = -1;
    /* préchargement : un élément par fichier, gardé en cache */
    this.warm = this.sources.map((src) => {
      const a = new Audio();
      a.preload = 'auto';
      a.src = src;
      a.load();                 // met le fichier en cache avant le premier tir
      return a;
    });
  }

  muted() { return this.g.sound ? this.g.sound.muted : false; }

  /* atténuation selon la distance au centre de l'écran */
  levelAt(x, y) {
    const cam = this.g.cam;
    if (!cam) return 0.7;
    const d = Math.hypot(x - cam.x, y - cam.y);
    return clamp(1 - (d - 55) / 240, 0.06, 1);
  }

  grenade(x, y) {
    if (this.muted() || this.active >= this.maxActive) return;
    if (!this.sources.length) return;
    /* tirage au hasard, en évitant de répéter le même deux fois de suite */
    let i = Math.floor(Math.random() * this.sources.length);
    if (i === this.lastIndex && this.sources.length > 1) i = (i + 1) % this.sources.length;
    this.lastIndex = i;

    try {
      const a = new Audio(this.sources[i]);
      a.volume = clamp(this.levelAt(x, y) * rr(0.75, 0.95), 0, 1);
      a.playbackRate = rr(0.93, 1.08);          // un peu de variation
      this.active++;
      this.played++;
      const done = () => { this.active = Math.max(0, this.active - 1); };
      a.addEventListener('ended', done, { once: true });
      a.addEventListener('error', done, { once: true });
      const p = a.play();
      if (p && p.catch) p.catch(() => done());
    } catch (e) {
      this.active = Math.max(0, this.active - 1);
    }
  }
}
