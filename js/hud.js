'use strict';
/* ------------------------------------------------------------------ *
 *  hud.js — compteurs, jauges, minicarte, ordres, fin de partie
 * ------------------------------------------------------------------ */

function spaced(ctx, text, x, y, sp, align) {
  const chars = [...text];
  let total = 0;
  for (const c of chars) total += ctx.measureText(c).width + sp;
  total -= sp;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + sp; }
  return total;
}

class Hud {
  draw(ctx, w, h, g) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    if (g.over) { this.end(ctx, w, h, g); ctx.restore(); return; }
    this.objective(ctx, w, h, g);
    this.squadMarkers(ctx, w, h, g);
    this.cannonMarker(ctx, w, h, g);
    this.crowdPanel(ctx, w, h, g);
    this.policePanel(ctx, w, h, g);
    this.orders(ctx, w, h, g);
    this.soundIcon(ctx, w, h, g);
    this.minimap(ctx, w, h, g);
    this.message(ctx, w, h, g);
    if (g.debug) this.debug(ctx, w, h, g);
    ctx.restore();
  }

  panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(12,14,18,0.68)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y, w, 1);
  }

  bar(ctx, x, y, w, h, v, col, bg) {
    ctx.fillStyle = bg || 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(v, 0, 1), h);
  }

  objective(ctx, w, h, g) {
    const bw = 430, x = w / 2 - bw / 2;
    this.panel(ctx, x, 18, bw, 92);
    ctx.textAlign = 'left';
    ctx.font = '700 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.75)';
    spaced(ctx, 'OBJECTIF — LIBÉRER LES DÉBOUCHÉS', x + 14, 36, 2, 'left');

    const total = g.mouths.length || 1;
    ctx.textAlign = 'right';
    ctx.font = '200 20px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(g.freedCount + ' / ' + total, x + bw - 14, 38);

    /* one pip per street, filled as it is freed */
    const pw = (bw - 28) / total;
    g.mouths.forEach((m, i) => {
      const px = x + 14 + i * pw;
      ctx.fillStyle = m.freed ? '#5ad08a'
        : m.open ? 'rgba(255,207,74,0.3)' : 'rgba(255,255,255,0.14)';
      ctx.fillRect(px, 44, pw - 4, 5);
      if (!m.freed && m.progress > 0) {
        ctx.fillStyle = '#ffcf4a';
        ctx.fillRect(px, 44, (pw - 4) * m.progress, 5);
      }
      ctx.font = '600 8px "Helvetica Neue", Arial, sans-serif';
      ctx.fillStyle = m.freed ? 'rgba(90,208,138,0.95)' : 'rgba(190,200,220,0.7)';
      ctx.textAlign = 'left';
      const name = m.street.replace('Rue du ', '').replace('Av. de la ', '').replace('Bd ', '');
      ctx.fillText(name.slice(0, 13), px, 60);
      if (!m.freed && m.open && m.crowdHere !== undefined) {
        ctx.fillStyle = 'rgba(255,207,74,0.85)';
        ctx.fillText(m.crowdHere >= m.need
          ? 'capture ' + Math.round(m.progress * 100) + ' %'
          : 'il faut ' + m.need + ' manifestants', px, 72);
      }
    });

    /* what the prefecture is doing right now */
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 14, 78, bw - 28, 1);
    ctx.textAlign = 'center';
    ctx.font = '400 10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = g.police.phase === 'AVANCER' ? 'rgba(220,180,150,0.9)' : 'rgba(240,140,110,0.95)';
    ctx.fillText(PHASES[g.police.phase] || '', w / 2, 97);
  }

  /* the water cannon gets its own marker so it is never a surprise */
  cannonMarker(ctx, w, h, g) {
    for (const c of g.police.cannons) this.oneCannon(ctx, w, h, g, c);
  }

  oneCannon(ctx, w, h, g, c) {
    const z = g.cam.zoom;
    const sx = (c.x - g.cam.x) * z + w / 2, sy = (c.y - g.cam.y) * z + h / 2;
    const pad = 54;
    const col = c.state === 'withdraw' ? 'rgba(150,160,175,0.8)' : '#4ab6ff';
    const label = 'CANON À EAU  ' + Math.round(Math.hypot(c.x - g.stats.cx, c.y - g.stats.cy)) + ' m';
    const px = clamp(sx, pad, w - pad), py = clamp(sy, pad + 86, h - pad - 95);
    ctx.save();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py - 24, 5, 0, TAU);
    ctx.fill();
    ctx.font = '700 9px "Helvetica Neue", Arial, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(12,14,18,0.78)';
    ctx.fillRect(px - tw / 2 - 6, py - 48, tw + 12, 15);
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.fillText(label, px, py - 37);
    ctx.restore();
  }

  /* where are the CRS? a chevron on each company, pinned to the screen edge
     when it is off view, with its street and distance */
  squadMarkers(ctx, w, h, g) {
    const z = g.cam.zoom;
    const pad = 54;
    const used = [];
    for (const sq of g.police.squads) {
      const sx = (sq.anchor[0] - g.cam.x) * z + w / 2;
      const sy = (sq.anchor[1] - g.cam.y) * z + h / 2;
      const off = sx < pad || sx > w - pad || sy < pad + 86 || sy > h - pad - 95;
      const col = sq.counted ? 'rgba(150,160,175,0.75)' : (sq.state === 'rout' ? '#ffcf4a' : '#5aa0ff');
      ctx.save();
      if (off) {
        const cx = w / 2, cy = h / 2;
        let dx = sx - cx, dy = sy - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        /* push the marker onto the edge of the safe area */
        const mx = clamp(cx + dx * 10000, pad, w - pad);
        const my = clamp(cy + dy * 10000, pad + 86, h - pad - 95);
        const k = Math.min((mx - cx) / (dx * 10000 || 1e-6), (my - cy) / (dy * 10000 || 1e-6));
        const px = cx + dx * 10000 * k, py = cy + dy * 10000 * k;
        const a = Math.atan2(dy, dx);
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(13, 0); ctx.lineTo(-7, 8); ctx.lineTo(-3, 0); ctx.lineTo(-7, -8);
        ctx.closePath(); ctx.fill();
        ctx.rotate(-a);
        const d = Math.round(Math.hypot(sq.anchor[0] - g.stats.cx, sq.anchor[1] - g.stats.cy));
        const label = (sq.street || g.map.nearestStreet(sq.anchor[0], sq.anchor[1])) +
          '  ' + d + ' m  ·  ' + sq.intent;
        ctx.font = '600 10px "Helvetica Neue", Arial, sans-serif';
        const tw = ctx.measureText(label).width;
        const lx = clamp(0, -px + 6, w - px - tw - 12);
        let ly = py < h / 2 ? 20 : -14;
        /* nudge the label when another marker already sits there */
        for (const u of used) {
          if (Math.abs(u[0] - px) < 150 && Math.abs(u[1] - (py + ly)) < 15) ly += py < h / 2 ? 17 : -17;
        }
        used.push([px, py + ly]);
        ctx.fillStyle = 'rgba(12,14,18,0.72)';
        ctx.fillRect(lx - 6, ly - 11, tw + 12, 16);
        ctx.fillStyle = col;
        ctx.textAlign = 'left';
        ctx.fillText(label, lx, ly);
      } else {
        /* on screen: a small chevron above the line */
        ctx.translate(sx, sy - 26 - sq.units.length * 0.2);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, 7); ctx.lineTo(-6, -4); ctx.lineTo(6, -4);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        if (z > 2.6) {
          ctx.font = '700 8px "Helvetica Neue", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = col;
          spaced(ctx, sq.intent, 0, -10, 1.5, 'center');
          /* tug of war: crowd pressure against line strength */
          const bw = 52, r = clamp(sq.ratio / 2, 0, 1);
          ctx.fillStyle = 'rgba(12,14,18,0.6)';
          ctx.fillRect(-bw / 2, -24, bw, 4);
          ctx.fillStyle = '#5ad08a';
          ctx.fillRect(-bw / 2, -24, bw * r, 4);
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fillRect(-bw / 2 + bw / 2 - 0.5, -25, 1, 6);
          const pushed = sq.gain - (sq.deepest || 0);
          if (pushed > 1 || sq.gain < -1) {
            ctx.font = '600 8px "Helvetica Neue", Arial, sans-serif';
            ctx.fillStyle = pushed > 1 ? '#5ad08a' : '#e04a3a';
            ctx.fillText(pushed > 1 ? pushed.toFixed(0) + ' m / 20'
              : sq.gain.toFixed(0) + ' m gagnés', 0, -29);
          }
        }
      }
      ctx.restore();
    }
  }

  crowdPanel(ctx, w, h, g) {
    const s = g.stats;
    this.panel(ctx, 18, 18, 250, 124);
    ctx.textAlign = 'left';
    ctx.font = '700 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.75)';
    spaced(ctx, 'MANIFESTANTS', 32, 40, 2, 'left');
    ctx.font = '200 30px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(g.crowd.count, 32, 72);
    const nw = ctx.measureText(String(g.crowd.count)).width;
    ctx.font = '400 10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.7)';
    ctx.fillText('/ ' + g.crowd.start + ' au départ', 32 + nw + 10, 72);

    ctx.font = '700 8px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.75)';
    spaced(ctx, 'DÉTERMINATION', 32, 88, 1.6, 'left');
    const mor = s.morale / 100;
    this.bar(ctx, 32, 93, 200, 6, mor, mor > 0.55 ? '#5ad08a' : mor > 0.28 ? '#ffcf4a' : '#e04a3a');

    ctx.font = '400 10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(200,210,230,0.65)';
    ctx.fillText('Interpellés ' + g.crowd.arrested + '   ·   Dispersés ' + g.crowd.dispersed, 32, 114);
    ctx.fillStyle = 'rgba(190,185,175,0.6)';
    ctx.fillText('Badauds ' + g.bystanders.count + (g.bystanders.gone ? '   ·   enfuis ' + g.bystanders.gone : ''), 32, 128);
  }

  policePanel(ctx, w, h, g) {
    const x = w - 268;
    this.panel(ctx, x, 18, 250, 124);
    ctx.textAlign = 'left';
    ctx.font = '700 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.75)';
    spaced(ctx, 'COMPAGNIES DE CRS', x + 14, 40, 2, 'left');
    ctx.font = '200 30px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(g.police.holding, x + 14, 72);
    ctx.font = '400 10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.7)';
    ctx.fillText('repoussées ' + g.police.routed + ' / ' + g.police.companies, x + 56, 72);

    ctx.font = '700 8px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.75)';
    spaced(ctx, 'OCCUPATION DE LA PLACE', x + 14, 88, 1.6, 'left');
    const ctrl = g.control;
    this.bar(ctx, x + 14, 93, 200, 6, ctrl, '#5ad08a', 'rgba(224,74,58,0.5)');
    ctx.font = '400 10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(200,210,230,0.65)';
    ctx.fillText(Math.round(ctrl * 100) + ' % tenus par la foule   ·   ' + g.police.units + ' CRS', x + 14, 114);

    /* how worked up the whole operation is: it drives their pace */
    const al = clamp(g.police.alarm, 0, 1);
    ctx.font = '700 8px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.75)';
    spaced(ctx, 'ALERTE', x + 14, 132, 1.6, 'left');
    this.bar(ctx, x + 56, 126, 158, 5, al, al > 0.6 ? '#e04a3a' : al > 0.25 ? '#ffcf4a' : '#5aa0ff');
  }

  orders(ctx, w, h, g) {
    const items = [
      { key: 'ESPACE', label: 'POUSSÉE', on: g.order === 'push', col: '#e04a3a' },
      { key: 'R', label: 'REPLI', on: g.order === 'fallback', col: '#4aa0ff' },
      { key: 'F', label: 'FUMIGÈNE ×' + g.flares, on: false, col: '#ffcf4a' },
    ];
    const bw = 148, x = w / 2 - (items.length * bw + (items.length - 1) * 10) / 2;
    items.forEach((it, i) => {
      const bx = x + i * (bw + 10), by = h - 60;
      ctx.fillStyle = it.on ? it.col : 'rgba(12,14,18,0.68)';
      ctx.fillRect(bx, by, bw, 38);
      ctx.strokeStyle = it.on ? it.col : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 37);
      ctx.textAlign = 'center';
      ctx.font = '700 11px "Helvetica Neue", Arial, sans-serif';
      ctx.fillStyle = it.on ? '#14161b' : '#e8e3da';
      spaced(ctx, it.label, bx + bw / 2, by + 17, 2, 'center');
      ctx.font = '400 9px "Helvetica Neue", Arial, sans-serif';
      ctx.fillStyle = it.on ? 'rgba(20,22,27,0.7)' : 'rgba(170,185,210,0.6)';
      spaced(ctx, it.key, bx + bw / 2, by + 30, 2, 'center');
    });
  }

  soundIcon(ctx, w, h, g) {
    const s = g.sound;
    if (!s) return;
    const x = w / 2 + 248, y = h - 41;
    ctx.save();
    const on = !s.muted && s.el && !s.el.paused;
    ctx.fillStyle = on ? 'rgba(235,242,255,0.85)' : 'rgba(150,160,175,0.6)';
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 2); ctx.lineTo(x - 2, y - 2); ctx.lineTo(x + 1, y - 6);
    ctx.lineTo(x + 1, y + 6); ctx.lineTo(x - 2, y + 2); ctx.lineTo(x - 5, y + 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.3;
    if (on) {
      const lvl = clamp(s.level, 0, 1);
      ctx.beginPath(); ctx.arc(x + 1, y, 6, -0.9, 0.9); ctx.stroke();
      if (lvl > 0.5) { ctx.beginPath(); ctx.arc(x + 1, y, 9.5, -0.8, 0.8); ctx.stroke(); }
    } else {
      ctx.beginPath();
      ctx.moveTo(x + 4, y - 4); ctx.lineTo(x + 11, y + 4);
      ctx.moveTo(x + 11, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.stroke();
    }
    ctx.font = '600 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,185,210,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('M', x + 3, y + 20);
    ctx.restore();
  }

  minimap(ctx, w, h, g) {
    const mw = 168, mh = mw * (WORLD_H / WORLD_W);
    const x = 18, y = h - mh - 18;
    const k = mw / WORLD_W;
    ctx.save();
    ctx.fillStyle = 'rgba(12,14,18,0.78)';
    ctx.fillRect(x, y, mw, mh);
    ctx.translate(x, y); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(190,185,170,0.45)';
    g.map.path(ctx, g.map.plaza); ctx.fill();
    ctx.fillStyle = 'rgba(150,155,170,0.3)';
    for (const s of g.map.streets) { g.map.path(ctx, s.poly); ctx.fill(); }
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    for (const p of g.crowd.list) {
      ctx.fillStyle = p.state === 'flee' ? 'rgba(255,180,90,0.9)' : 'rgba(90,208,138,0.9)';
      ctx.fillRect(p.x * k - 0.5, p.y * k - 0.5, 1.6, 1.6);
    }
    for (const sq of g.police.squads) {
      ctx.fillStyle = sq.counted ? 'rgba(150,160,175,0.8)' : 'rgba(90,160,255,0.95)';
      ctx.beginPath(); ctx.arc(sq.anchor[0] * k, sq.anchor[1] * k, 4, 0, TAU); ctx.fill();
    }
    g.police.each((u) => {
      ctx.fillStyle = 'rgba(140,195,255,0.95)';
      ctx.fillRect(u.x * k - 1, u.y * k - 1, 2.2, 2.2);
    });
    /* viewport */
    const vx = g.view.x0 * k, vy = g.view.y0 * k;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, (g.view.x1 - g.view.x0) * k, (g.view.y1 - g.view.y0) * k);
    ctx.restore();
  }

  message(ctx, w, h, g) {
    const m = g.messages[0];
    if (!m) return;
    ctx.textAlign = 'center';
    ctx.font = '400 15px "Helvetica Neue", Arial, sans-serif';
    const tw = ctx.measureText(m.text).width;
    const a = clamp(m.t * 3, 0, 1) * clamp(m.life - m.t, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(12,14,18,0.75)';
    ctx.fillRect(w / 2 - tw / 2 - 16, h - 112, tw + 32, 30);
    ctx.fillStyle = '#f0ece2';
    ctx.fillText(m.text, w / 2, h - 92);
    ctx.globalAlpha = 1;
  }

  end(ctx, w, h, g) {
    const o = g.over;
    const fade = clamp(o.t / 0.7, 0, 1);
    ctx.fillStyle = 'rgba(8,10,14,' + (0.8 * fade).toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
    const win = o.type === 'win';
    ctx.textAlign = 'center';
    ctx.globalAlpha = fade;
    ctx.font = '800 54px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = win ? '#5ad08a' : '#e04a3a';
    spaced(ctx, win ? 'LA PLACE EST TENUE' : 'LA PLACE EST ÉVACUÉE', w / 2, h / 2 - 20, 10, 'center');

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(w / 2 - 220, h / 2); ctx.lineTo(w / 2 + 220, h / 2); ctx.stroke();

    ctx.font = '400 14px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(220,228,240,0.9)';
    ctx.fillText(o.line, w / 2, h / 2 + 30);
    ctx.font = '600 13px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(180,195,215,0.85)';
    ctx.fillText(
      'Manifestants restants ' + g.crowd.count + '   ·   Interpellés ' + g.crowd.arrested +
      '   ·   Dispersés ' + g.crowd.dispersed + '   ·   Compagnies repoussées ' + g.police.routed +
      '   ·   ' + o.time, w / 2, h / 2 + 56);

    if (o.t > 0.8) {
      ctx.globalAlpha = fade * (0.68 + 0.32 * Math.sin(o.t * 4));
      ctx.font = '700 11px "Helvetica Neue", Arial, sans-serif';
      ctx.fillStyle = '#fff';
      spaced(ctx, 'APPUIE SUR UNE TOUCHE POUR REJOUER', w / 2, h / 2 + 100, 4, 'center');
    }
    ctx.globalAlpha = 1;
  }

  debug(ctx, w, h, g) {
    ctx.font = '400 11px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(w / 2 - 110, 130, 220, 76);
    ctx.fillStyle = '#9ef';
    ctx.textAlign = 'left';
    const l = [
      'fps     ' + g.fps.toFixed(0),
      'crowd   ' + g.crowd.count + '  crs ' + g.police.units + '  civ ' + g.bystanders.count,
      'clouds  ' + g.fx.clouds.length + '  parts ' + g.fx.parts.length,
      'zoom    ' + g.cam.zoom.toFixed(2),
      'morale  ' + g.stats.morale.toFixed(0) + '  fuite ' + g.stats.fleeing,
      'reforms ' + g.police.squads.reduce((a, s) => a + s.reforms, 0) + '  canons ' + g.police.cannons.length,
    ];
    l.forEach((s, i) => ctx.fillText(s, w / 2 - 100, 148 + i * 13));
  }
}
