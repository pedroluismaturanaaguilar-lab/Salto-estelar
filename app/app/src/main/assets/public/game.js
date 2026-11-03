/* ============================================================
     SALTO ESTELAR · Juego de plataformas 2D
     Vanilla JS + Canvas · Todo en un solo archivo
     ============================================================ */

  (() => {
    'use strict';

    /* ==========================================================
       1. CANVAS Y CONSTANTES
       ========================================================== */
    const canvas = document.getElementById('game');
    const ctx    = canvas.getContext('2d');
    const VIEW_W = canvas.width;   // 960
    const VIEW_H = canvas.height;  // 540

    const GRAVITY      = 2100;
    const JUMP_V       = 730;
    const MAX_SPEED    = 320;
    const ACCEL        = 2800;
    const FRICTION     = 2600;
    const MAX_FALL     = 1500;
    const COYOTE_TIME  = 0.10;
    const JUMP_BUFFER  = 0.12;
    const STOMP_BOUNCE = 540;

    const GROUND_Y    = 460;
    const GROUND_H    = 80;
    const LEVEL_COUNT = 100;

    const STEP      = 1 / 120;
    const MAX_STEPS = 10;

    const BEST_KEY = 'saltoEstelar.best';

    /* ==========================================================
       2. UTILIDADES
       ========================================================== */
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const rnd   = (a, b) => a + Math.random() * (b - a);

    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function aabb(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x &&
             a.y < b.y + b.h && a.y + a.h > b.y;
    }

    function roundRect(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function loadBest() {
      try { return Number(localStorage.getItem(BEST_KEY)) || 0; }
      catch (e) { return 0; }
    }
    function storeBest(v) {
      try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { }
    }

    /* ==========================================================
       3. SONIDO (Web Audio API)
       ========================================================== */
    const Sound = (() => {
      let ac = null;
      let enabled = true;

      function ensure() {
        if (!ac) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) ac = new AC();
        }
        if (ac && ac.state === 'suspended') ac.resume();
        return ac;
      }

      function tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null) {
        if (!enabled) return;
        const a = ensure();
        if (!a) return;
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = type;
        const t0 = a.currentTime;
        o.frequency.setValueAtTime(freq, t0);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(a.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.03);
      }

      return {
        unlock() { ensure(); },
        jump()   { tone(400, 0.18, 'square',   0.07, 720); },
        coin()   { tone(900, 0.09, 'triangle', 0.11); setTimeout(() => tone(1350, 0.12, 'triangle', 0.09), 65); },
        stomp()  { tone(220, 0.14, 'sawtooth', 0.10, 90); },
        hurt()   { tone(320, 0.35, 'sawtooth', 0.14, 70); },
        levelUp(){ [660, 880, 1100].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.09), i * 90)); },
        win()    { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.11), i * 110)); },
        lose()   { [440, 349, 262].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sine', 0.13), i * 160)); },
        toggle() { enabled = !enabled; if (enabled) ensure(); return enabled; },
        get enabled() { return enabled; }
      };
    })();

    /* ==========================================================
       4. ESTADO
       ========================================================== */
    const State = {
      mode: 'menu',
      level: 0,
      lives: 3,
      score: 0,
      coins: 0,
      best: loadBest(),
      time: 0,
      shake: 0
    };

    const cam = { x: 0, y: 0 };

    const player = {
      x: 0, y: 0, w: 34, h: 44,
      vx: 0, vy: 0,
      onGround: false,
      coyote: 0,
      jumpBuffer: 0,
      invuln: 0,
      facing: 1
    };

    const keys = { left: false, right: false, jump: false };

    let world  = null;
    const particles = [];
    const texts     = [];

    /* ==========================================================
       5. GENERACIÓN DE NIVELES
       ========================================================== */
    function spawnEnemy(x, surfaceY, minX, maxX, speed) {
      const w = 34, h = 30;
      return {
        x, y: surfaceY - h, w, h,
        minX, maxX, speed,
        dir: Math.random() < 0.5 ? -1 : 1,
        alive: true,
        anim: Math.random() * Math.PI * 2
      };
    }

    function generateLevel(index) {
      const rng  = mulberry32(1337 + index * 7919);
      const diff = Math.min(index, 12);

      const platforms = [];
      const coins     = [];
      const enemies   = [];
      const spikes    = [];
      const segments  = [];

      let x = 0;
      const firstW = 620;
      segments.push({ x: 0, y: GROUND_Y, w: firstW });
      x = firstW;

      while (x < 2400 + index * 120) {
        const gap = 90 + rng() * 50 + diff * 10;
        x += gap;
        const w = 220 + rng() * 240;
        segments.push({ x, y: GROUND_Y, w });
        x += w;
      }
      const lastW = 560;
      segments.push({ x, y: GROUND_Y, w: lastW });
      const worldWidth = x + lastW + 60;

      for (const s of segments) {
        platforms.push({ x: s.x, y: s.y, w: s.w, h: GROUND_H, kind: 'ground' });
      }

      for (let i = 1; i < segments.length - 1; i++) {
        const s = segments[i];
        if (s.w > 250 && rng() < 0.8) {
          const pw = 90 + rng() * 70;
          const px = s.x + 20 + rng() * (s.w - pw - 40);
          const py = GROUND_Y - 130 - rng() * 70;
          platforms.push({ x: px, y: py, w: pw, h: 18, kind: 'platform' });

          const nc = 2 + Math.floor(rng() * 2);
          for (let k = 0; k < nc; k++) {
            coins.push({
              x: px + pw / 2 + (k - (nc - 1) / 2) * 36,
              y: py - 30, r: 11, taken: false
            });
          }

          if (rng() < 0.4 + diff * 0.1) {
            enemies.push(spawnEnemy(px + 6, py, px + 4, px + pw - 4, 55 + diff * 18));
          }
        }
      }

      for (let i = 1; i < segments.length - 1; i++) {
        const s = segments[i];

        const nEnemies = (s.w > 300 ? 1 : 0) + (rng() < 0.25 + diff * 0.12 ? 1 : 0);
        for (let k = 0; k < nEnemies; k++) {
          const ex = s.x + 30 + rng() * (s.w - 100);
          enemies.push(spawnEnemy(ex, GROUND_Y, s.x + 8, s.x + s.w - 8, 60 + diff * 20 + rng() * 30));
        }

        if (rng() < 0.35 + diff * 0.1) {
          const count = 1 + Math.floor(rng() * (1 + diff * 0.8));
          const sw    = 26;
          const total = count * sw;
          if (s.w > total + 140) {
            const sx = s.x + 70 + rng() * (s.w - total - 140);
            spikes.push({ x: sx, y: GROUND_Y - 22, w: total, h: 22 });
          }
        }

        const nCoins = 3 + Math.floor(rng() * 4);
        for (let k = 0; k < nCoins; k++) {
          coins.push({
            x: s.x + 30 + rng() * (s.w - 60),
            y: GROUND_Y - 60 - rng() * 90,
            r: 11, taken: false
          });
        }
      }

      for (let i = 0; i < segments.length - 1; i++) {
        const a = segments[i], b = segments[i + 1];
        const gapStart = a.x + a.w, gapEnd = b.x;
        if (gapEnd - gapStart > 40 && rng() < 0.7) {
          const mid = (gapStart + gapEnd) / 2;
          coins.push({ x: mid,      y: GROUND_Y - 92, r: 11, taken: false });
          coins.push({ x: mid - 32, y: GROUND_Y - 70, r: 11, taken: false });
          coins.push({ x: mid + 32, y: GROUND_Y - 70, r: 11, taken: false });
        }
      }

      const last = segments[segments.length - 1];
      const goal = { x: last.x + last.w - 120, y: GROUND_Y - 130, w: 44, h: 130 };

      return {
        width: worldWidth,
        platforms, coins, enemies, spikes, segments, goal,
        spawn: { x: 60, y: GROUND_Y - player.h - 2 }
      };
    }

    /* ==========================================================
       6. CARGA / REINICIO
       ========================================================== */
    function loadLevel(index) {
      world = generateLevel(index);
      State.level = index;

      player.x = world.spawn.x;
      player.y = world.spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.onGround = false;
      player.invuln = 0;
      player.coyote = 0;
      player.jumpBuffer = 0;
      player.facing = 1;

      particles.length = 0;
      texts.length = 0;

      cam.x = 0;
      State.shake = 0;
    }

    function startGame() {
      Sound.unlock();
      State.lives = 3;
      State.score = 0;
      State.coins = 0;
      keys.left = keys.right = keys.jump = false;

      loadLevel(0);
      State.mode = 'playing';
      showScreen(null);
      showBanner('NIVEL 1');
      updateHUD(true);
    }

    function restartGame() { startGame(); }

    function togglePause() {
      if (State.mode === 'playing') {
        State.mode = 'paused';
        showScreen('screen-pause');
      } else if (State.mode === 'paused') {
        State.mode = 'playing';
        showScreen(null);
        lastTs = 0;
      }
    }

    function gameOver() {
      State.mode = 'defeat';
      Sound.lose();
      saveBest();
      document.getElementById('defLevel').textContent = State.level + 1;
      document.getElementById('defScore').textContent = State.score;
      document.getElementById('defBest').textContent  = State.best;
      showScreen('screen-defeat');
    }

    function victory() {
      State.mode = 'victory';
      Sound.win();
      saveBest();
      document.getElementById('vicScore').textContent = State.score;
      document.getElementById('vicCoins').textContent = State.coins;
      document.getElementById('vicBest').textContent  = State.best;
      showScreen('screen-victory');
    }

    function saveBest() {
      if (State.score > State.best) {
        State.best = State.score;
        storeBest(State.best);
      }
      updateHUD(true);
    }

    /* ==========================================================
       7. FÍSICA Y COLISIONES
       ========================================================== */
    function moveAndCollide(ent, dt, platforms) {
      ent.x += ent.vx * dt;
      for (const p of platforms) {
        if (!aabb(ent, p)) continue;
        if (ent.vx > 0)      ent.x = p.x - ent.w;
        else if (ent.vx < 0) ent.x = p.x + p.w;
        ent.vx = 0;
      }

      ent.onGround = false;
      ent.y += ent.vy * dt;
      for (const p of platforms) {
        if (!aabb(ent, p)) continue;
        if (ent.vy > 0) {
          ent.y = p.y - ent.h;
          ent.vy = 0;
          ent.onGround = true;
        } else if (ent.vy < 0) {
          ent.y = p.y + p.h;
          ent.vy = 0;
        }
      }
    }

    /* ==========================================================
       8. ACTUALIZACIÓN
       ========================================================== */
    function update(dt) {
      updatePlayer(dt);
      updateEnemies(dt);
      checkCollisions();
      updateParticles(dt);
      updateTexts(dt);
      updateCamera(dt);
    }

    function updatePlayer(dt) {
      const p = player;

      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (dir !== 0) {
        p.vx += dir * ACCEL * dt;
        p.vx = clamp(p.vx, -MAX_SPEED, MAX_SPEED);
        p.facing = dir;
      } else {
        const f = FRICTION * dt;
        if (Math.abs(p.vx) <= f) p.vx = 0;
        else p.vx -= Math.sign(p.vx) * f;
      }

      if (p.jumpBuffer > 0 && (p.onGround || p.coyote > 0)) {
        p.vy = -JUMP_V;
        p.onGround = false;
        p.coyote = 0;
        p.jumpBuffer = 0;
        Sound.jump();
        spawnParticles(p.x + p.w / 2, p.y + p.h, 'rgba(160,220,255,1)', 8);
      }
      p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

      p.vy += GRAVITY * dt;
      if (!keys.jump && p.vy < 0) p.vy += GRAVITY * 0.9 * dt;
      p.vy = Math.min(p.vy, MAX_FALL);

      moveAndCollide(p, dt, world.platforms);

      if (p.onGround) p.coyote = COYOTE_TIME;
      else            p.coyote = Math.max(0, p.coyote - dt);

      p.invuln = Math.max(0, p.invuln - dt);

      if (p.y > VIEW_H + 200) fellInPit();
    }

    function updateEnemies(dt) {
      for (const e of world.enemies) {
        if (!e.alive) continue;
        e.anim += dt * 6;
        e.x += e.dir * e.speed * dt;
        if (e.x < e.minX)       { e.x = e.minX; e.dir = 1; }
        if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.dir = -1; }
      }
    }

    function checkCollisions() {
      const p = player;

      for (const c of world.coins) {
        if (c.taken) continue;
        if (Math.abs(c.x - (p.x + p.w / 2)) < c.r + p.w / 2 &&
            Math.abs(c.y - (p.y + p.h / 2)) < c.r + p.h / 2) {
          c.taken = true;
          State.coins++;
          State.score += 10;
          Sound.coin();
          spawnParticles(c.x, c.y, '#ffd166', 9);
          addText(c.x, c.y - 8, '+10', '#ffd166');
          updateHUD();
        }
      }

      for (const s of world.spikes) {
        const hit = { x: s.x + 4, y: s.y + 6, w: s.w - 8, h: s.h - 6 };
        if (aabb(p, hit) && p.invuln <= 0) { damagePlayer(); return; }
      }

      for (const e of world.enemies) {
        if (!e.alive || !aabb(p, e)) continue;

        const stomping = p.vy > 0 && (p.y + p.h) - e.y < e.h * 0.75;

        if (stomping) {
          e.alive = false;
          p.vy = -STOMP_BOUNCE;
          p.jumpBuffer = 0;
          State.score += 50;
          Sound.stomp();
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, '#ff7b54', 14);
          addText(e.x + e.w / 2, e.y - 4, '+50', '#ff9f68');
          updateHUD();
        } else if (p.invuln <= 0) {
          damagePlayer();
          return;
        }
      }

      if (aabb(p, world.goal)) reachGoal();
    }

    /* ==========================================================
       9. DAÑO / RESPAWN / NIVEL
       ========================================================== */
    function damagePlayer() {
      if (State.mode !== 'playing' || player.invuln > 0) return;

      State.lives--;
      State.shake = 0.5;
      player.invuln = 1.8;
      Sound.hurt();
      spawnParticles(player.x + player.w / 2, player.y + player.h / 2, '#f72585', 20);
      updateHUD();

      if (State.lives <= 0) gameOver();
      else respawnPlayer();
    }

    function fellInPit() {
      State.lives--;
      State.shake = 0.5;
      Sound.hurt();
      updateHUD();

      if (State.lives <= 0) gameOver();
      else respawnPlayer();
    }

    function respawnPlayer() {
      let sx = world.spawn.x;
      let sy = world.spawn.y;

      for (const s of world.segments) {
        if (s.x <= player.x + 20) {
          sx = s.x + 30;
          sy = GROUND_Y - player.h - 4;
        }
      }

      player.x = sx;
      player.y = sy;
      player.vx = 0;
      player.vy = 0;
      player.invuln = 1.6;
      player.coyote = 0;
      player.jumpBuffer = 0;

      cam.x = clamp(player.x + player.w / 2 - VIEW_W * 0.4, 0, Math.max(0, world.width - VIEW_W));
    }

    function reachGoal() {
      if (State.mode !== 'playing') return;

      State.score += 250;
      Sound.levelUp();
      spawnParticles(world.goal.x + 20, world.goal.y + 30, '#43e97b', 22);

      State.level++;
      if (State.level >= LEVEL_COUNT) {
        victory();
        return;
      }

      loadLevel(State.level);
      State.mode = 'playing';
      showScreen(null);
      showBanner('NIVEL ' + (State.level + 1));
      updateHUD(true);
    }

    /* ==========================================================
       10. PARTÍCULAS Y TEXTOS
       ========================================================== */
    function spawnParticles(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 190;
        particles.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 70,
          life: 0.45 + Math.random() * 0.45,
          max: 0.9,
          color,
          size: 2 + Math.random() * 3
        });
      }
    }

    function updateParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 900 * dt;
        p.vx *= 0.985;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
    }

    function drawParticles() {
      for (const p of particles) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function addText(x, y, txt, color) {
      texts.push({ x, y, txt, color, life: 0.9, max: 0.9 });
    }

    function updateTexts(dt) {
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.y -= 42 * dt;
        t.life -= dt;
        if (t.life <= 0) texts.splice(i, 1);
      }
    }

    function drawTexts() {
      ctx.textAlign = 'center';
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      for (const t of texts) {
        ctx.globalAlpha = clamp(t.life / t.max, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.fillText(t.txt, t.x + 1.5, t.y + 1.5);
        ctx.fillStyle = t.color;
        ctx.fillText(t.txt, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    /* ==========================================================
       11. CÁMARA
       ========================================================== */
    function updateCamera(dt) {
      const target = player.x + player.w / 2 - VIEW_W * 0.4;
      cam.x += (target - cam.x) * Math.min(1, dt * 8);
      cam.x = clamp(cam.x, 0, Math.max(0, world.width - VIEW_W));
    }

    /* ==========================================================
       12. DIBUJO
       ========================================================== */
    const stars = [];
    for (let i = 0; i < 90; i++) {
      stars.push({
        x: Math.random() * VIEW_W,
        y: Math.random() * VIEW_H * 0.75,
        r: Math.random() * 1.5 + 0.5,
        p: Math.random() * Math.PI * 2
      });
    }

    function drawBackground() {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      g.addColorStop(0,   '#080d26');
      g.addColorStop(0.5, '#182a63');
      g.addColorStop(1,   '#2f4bb0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      for (const s of stars) {
        const x = ((s.x - cam.x * 0.06) % VIEW_W + VIEW_W) % VIEW_W;
        const a = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(State.time * 2 + s.p));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#dceaff';
        ctx.beginPath();
        ctx.arc(x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      drawHills(cam.x * 0.15, '#101a44', 400, 42, 0.006);
      drawHills(cam.x * 0.30, '#16225c', 452, 30, 0.010);
    }

    function drawHills(off, color, baseY, amp, wave) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, VIEW_H);
      for (let x = 0; x <= VIEW_W + 10; x += 10) {
        const wx = x + off;
        const y = baseY + Math.sin(wx * wave) * amp + Math.sin(wx * wave * 2.7) * amp * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(VIEW_W + 10, VIEW_H);
      ctx.closePath();
      ctx.fill();
    }

    function inView(o) {
      return o.x + o.w > cam.x - 80 && o.x < cam.x + VIEW_W + 80;
    }

    function drawWorld() {
      for (const s of world.spikes) if (inView(s)) drawSpikes(s);
      for (const p of world.platforms) if (inView(p)) drawPlatform(p);
      drawGoal(world.goal);

      for (const c of world.coins) {
        if (c.taken) continue;
        if (c.x > cam.x - 40 && c.x < cam.x + VIEW_W + 40) drawCoin(c);
      }

      for (const e of world.enemies) {
        if (e.alive && inView(e)) drawEnemy(e);
      }
    }

    function drawPlatform(p) {
      if (p.kind === 'ground') {
        const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
        g.addColorStop(0,    '#33c97a');
        g.addColorStop(0.22, '#1f8f58');
        g.addColorStop(1,    '#0f4a33');
        ctx.fillStyle = g;
        roundRect(p.x, p.y, p.w, p.h, 12);
        ctx.fill();

        ctx.fillStyle = '#7bf1a8';
        roundRect(p.x + 4, p.y + 2, p.w - 8, 7, 4);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,.07)';
        roundRect(p.x + 6, p.y + 14, p.w - 12, 10, 5);
        ctx.fill();
      } else {
        const g = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
        g.addColorStop(0, '#4cc9f0');
        g.addColorStop(1, '#7b5cff');
        ctx.save();
        ctx.shadowColor = 'rgba(76,201,240,.55)';
        ctx.shadowBlur  = 16;
        ctx.fillStyle = g;
        roundRect(p.x, p.y, p.w, p.h, 9);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,.5)';
        roundRect(p.x + 8, p.y + 3, p.w - 16, 3, 2);
        ctx.fill();
      }
    }

    function drawSpikes(s) {
      const n = Math.max(1, Math.round(s.w / 26));
      const w = s.w / n;
      for (let i = 0; i < n; i++) {
        const x = s.x + i * w;
        const g = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
        g.addColorStop(0, '#ffb3c7');
        g.addColorStop(1, '#c9184a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, s.y);
        ctx.lineTo(x + w - 1, s.y + s.h);
        ctx.lineTo(x + 1, s.y + s.h);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawCoin(c) {
      const t  = State.time * 4 + c.x * 0.05;
      const sx = Math.abs(Math.cos(t));
      ctx.save();
      ctx.translate(c.x, c.y + Math.sin(t * 0.6) * 2.5);
      ctx.scale(Math.max(0.18, sx), 1);

      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur  = 14;
      const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, c.r);
      g.addColorStop(0, '#fff6c4');
      g.addColorStop(1, '#e8a100');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, c.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, c.r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawEnemy(e) {
      const bob = Math.sin(e.anim) * 2;
      const x = e.x, y = e.y + bob, w = e.w, h = e.h;

      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, e.y + h + 3, w * 0.45, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#ff7b54');
      g.addColorStop(1, '#c9184a');
      ctx.fillStyle = g;
      roundRect(x, y, w, h, 10);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x + w * 0.32, y + h * 0.42, 5.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w * 0.68, y + h * 0.42, 5.2, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#1a0620';
      const ed = e.dir * 1.6;
      ctx.beginPath(); ctx.arc(x + w * 0.32 + ed, y + h * 0.44, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w * 0.68 + ed, y + h * 0.44, 2.4, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = '#1a0620';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.18, y + h * 0.20); ctx.lineTo(x + w * 0.42, y + h * 0.30);
      ctx.moveTo(x + w * 0.82, y + h * 0.20); ctx.lineTo(x + w * 0.58, y + h * 0.30);
      ctx.stroke();
    }

    function drawGoal(gl) {
      const pulse = 0.5 + 0.5 * Math.sin(State.time * 3);
      ctx.save();
      ctx.globalAlpha = 0.2 + pulse * 0.25;
      ctx.fillStyle = '#43e97b';
      ctx.beginPath();
      ctx.ellipse(gl.x + gl.w / 2, gl.y + gl.h, 72, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#eaf2ff';
      roundRect(gl.x + 4, gl.y, 6, gl.h, 3);
      ctx.fill();

      const wave = Math.sin(State.time * 6) * 7;
      ctx.fillStyle = '#43e97b';
      ctx.beginPath();
      ctx.moveTo(gl.x + 10, gl.y + 6);
      ctx.quadraticCurveTo(gl.x + 40 + wave, gl.y + 18, gl.x + 10, gl.y + 46);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,.65)';
      ctx.beginPath();
      ctx.arc(gl.x + 22, gl.y + 24, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawPlayer() {
      const p = player;
      if (p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0) return;

      const cx     = p.x + p.w / 2;
      const bottom = p.y + p.h;

      if (p.onGround) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(cx, bottom + 3, p.w * 0.5, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      let sx = 1, sy = 1;
      if (!p.onGround) {
        const k = clamp(p.vy / 900, -1, 1);
        sx = 1 - k * 0.12;
        sy = 1 + k * 0.12;
      } else if (Math.abs(p.vx) > 20) {
        const b = Math.sin(State.time * 18) * 0.06;
        sx = 1 + b;
        sy = 1 - b;
      }

      const w = p.w * sx;
      const h = p.h * sy;
      const x = cx - w / 2;
      const y = bottom - h;

      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#8df3ff');
      g.addColorStop(1, '#2b7fd4');
      ctx.save();
      ctx.shadowColor = 'rgba(76,201,240,.65)';
      ctx.shadowBlur  = 18;
      ctx.fillStyle = g;
      roundRect(x, y, w, h, 12);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,.35)';
      roundRect(x + 5, y + 5, w * 0.34, h * 0.26, 6);
      ctx.fill();

      const eyeY  = y + h * 0.36;
      const eyeDX = 6 * p.facing;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx - 7, eyeY, 5.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 7, eyeY, 5.2, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#0b1026';
      ctx.beginPath(); ctx.arc(cx - 7 + eyeDX * 0.5, eyeY + 1, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 7 + eyeDX * 0.5, eyeY + 1, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    function render(dt) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);

      let shX = 0, shY = 0;
      if (State.shake > 0) {
        State.shake = Math.max(0, State.shake - dt);
        const s = State.shake * 16;
        shX = rnd(-s, s);
        shY = rnd(-s, s);
      }

      ctx.save();
      ctx.translate(shX, shY);

      drawBackground();

      ctx.save();
      ctx.translate(-Math.round(cam.x), 0);
      if (world) {
        drawWorld();
        drawPlayer();
        drawParticles();
        drawTexts();
      }
      ctx.restore();

      ctx.restore();
    }

    /* ==========================================================
       13. BUCLE PRINCIPAL
       ========================================================== */
    let lastTs = 0;
    let acc    = 0;

    function loop(ts) {
      requestAnimationFrame(loop);

      if (!lastTs) lastTs = ts;
      let dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (dt > 0.1) dt = 0.1;
      if (dt < 0)   dt = 0;

      State.time += dt;

      if (State.mode === 'playing') {
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < MAX_STEPS) {
          update(STEP);
          acc -= STEP;
          steps++;
        }
        if (steps >= MAX_STEPS) acc = 0;
      } else {
        acc = 0;
      }

      render(dt);
      updateHUD();
    }

    /* ==========================================================
       14. INTERFAZ
       ========================================================== */
    const el = {
      hudLevel: document.getElementById('hudLevel'),
      hudLives: document.getElementById('hudLives'),
      hudCoins: document.getElementById('hudCoins'),
      hudScore: document.getElementById('hudScore'),
      hudBest:  document.getElementById('hudBest'),
      banner:   document.getElementById('banner'),
      bannerTx: document.getElementById('bannerText')
    };

    let hudCache = '';

    function updateHUD(force) {
      const sig = [State.level, State.lives, State.coins, State.score, State.best].join('|');
      if (!force && sig === hudCache) return;
      hudCache = sig;

      el.hudLevel.textContent = (State.level + 1) + '/' + LEVEL_COUNT;
      el.hudLives.textContent = '❤'.repeat(Math.max(0, State.lives)) +
                                '♡'.repeat(Math.max(0, 3 - State.lives));
      el.hudCoins.textContent = State.coins;
      el.hudScore.textContent = State.score;
      el.hudBest.textContent  = State.best;
    }

    function showScreen(id) {
      document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show'));
      if (id) document.getElementById(id).classList.add('show');
    }

    let bannerTimer = null;
    function showBanner(txt) {
      el.bannerTx.textContent = txt;
      el.banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => el.banner.classList.remove('show'), 1400);
    }

    /* ==========================================================
       15. CONTROLES
       ========================================================== */
    function jumpDown() {
      if (State.mode !== 'playing') return;
      if (!keys.jump) player.jumpBuffer = JUMP_BUFFER;
      keys.jump = true;
    }
    function jumpUp() { keys.jump = false; }

    const PREVENT = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'a', 'd', 'w'];

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (PREVENT.includes(k)) e.preventDefault();

      if (k === 'arrowleft'  || k === 'a') keys.left  = true;
      if (k === 'arrowright' || k === 'd') keys.right = true;
      if (k === ' ' || k === 'arrowup' || k === 'w') jumpDown();

      if (k === 'p' || k === 'escape') togglePause();
      if (k === 'r') restartGame();
      if (k === 'm') toggleSound();
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft'  || k === 'a') keys.left  = false;
      if (k === 'arrowright' || k === 'd') keys.right = false;
      if (k === ' ' || k === 'arrowup' || k === 'w') jumpUp();
    });

    function bindHold(node, onDown, onUp) {
      if (!node) return;
      const down = (e) => {
        e.preventDefault();
        node.classList.add('pressed');
        try { node.setPointerCapture(e.pointerId); } catch (err) { }
        onDown();
      };
      const up = (e) => {
        if (e) e.preventDefault();
        node.classList.remove('pressed');
        onUp();
      };
      node.addEventListener('pointerdown', down);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
      node.addEventListener('pointerleave', up);
      node.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    bindHold(document.getElementById('btnLeft'),
      () => { keys.left  = true; },
      () => { keys.left  = false; });

    bindHold(document.getElementById('btnRight'),
      () => { keys.right = true; },
      () => { keys.right = false; });

    bindHold(document.getElementById('btnJump'), jumpDown, jumpUp);

    document.getElementById('btnStart').addEventListener('click', () => { Sound.unlock(); startGame(); });
    document.getElementById('btnRetry').addEventListener('click', startGame);
    document.getElementById('btnPlayAgain').addEventListener('click', startGame);
    document.getElementById('btnRestartPause').addEventListener('click', startGame);
    document.getElementById('btnResume').addEventListener('click', togglePause);
    document.getElementById('btnRestart').addEventListener('click', restartGame);
    document.getElementById('btnPause').addEventListener('click', togglePause);

    function toggleSound() {
      const on = Sound.toggle();
      document.getElementById('btnSound').textContent = on ? '🔊' : '🔇';
    }
    document.getElementById('btnSound').addEventListener('click', toggleSound);

    window.addEventListener('blur', () => {
      if (State.mode === 'playing') togglePause();
    });

    if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
      document.body.classList.add('is-touch');
    }

    /* ==========================================================
       16. ARRANQUE
       ========================================================== */
    loadLevel(0);
    showScreen('screen-start');
    updateHUD(true);
    requestAnimationFrame(loop);

  })();
