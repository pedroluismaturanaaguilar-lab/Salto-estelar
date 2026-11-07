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
    const LEVEL_WORDS = ['AMOR','GATO','PERRO','AMISTAD','ESTRELLA','LUNA','SOL','PLANETA','GALAXIA','COMETA','COHETE','ASTRONAUTA','UNIVERSO','ORBITA','SATELITE','NEBULOSA','MARTE','TIERRA','VENUS','JUPITER','SATURNO','MERCURIO','NEPTUNO','PLUTON','COSMOS','BRILLO','NOCHE','CIELO','NUBE','LLUVIA','ARCOIRIS','MONTAÑA','BOSQUE','RIO','LAGO','OCEANO','PLAYA','ISLA','FUEGO','HIELO','VIENTO','NIEVE','FLOR','ARBOL','HOJA','FRUTA','MANZANA','CEREZA','BANANO','NARANJA','MUSICA','DANZA','JUEGO','SUEÑO','MAGIA','VALIENTE','ALEGRIA','SONRISA','FAMILIA','ESCUELA','LIBRO','PINTURA','DIBUJO','AMABLE','RESPETO','ESPERANZA','AVENTURA','CAMINO','TESORO','LLAVE','COFRE','AMIGO','AMIGA','EQUIPO','FUERZA','PODER','ENERGIA','VELOCIDAD','SALTO','CARRERA','META','VICTORIA','CAMPEON','MEDALLA','PREMIO','MONEDA','CORAZON','MARIPOSA','TORTUGA','CONEJO','DELFIN','BALLENA','AGUILA','LEON','TIGRE','DRAGON','FANTASIA','FUTURO','INFINITO','COMPARTIR'];

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
      lives: 5,
      score: 0,
      coins: 0,
      bullets: 0,
      keys: 0,
      wordProgress: [],
      best: loadBest(),
      time: 0,
      shake: 0,
      shieldTime: 0,
      magnetTime: 0,
      collectedByLevel: {}
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
    let checkpointClock = 0;
    const particles = [];
    const texts     = [];
    const bullets = [];
    const enemyBullets = [];
    let remotePlayer = null;

    /* ==========================================================
       5. GENERACIÓN DE NIVELES
       ========================================================== */
    function spawnEnemy(x, surfaceY, minX, maxX, speed, kind='slime') {
      const w = kind==='bird'?38:34, h = kind==='bird'?30:30;
      return {
        x, y: surfaceY - h, w, h,
        minX, maxX, speed,
        dir: Math.floor(x + surfaceY) % 2 ? 1 : -1,
        kind,baseY:surfaceY-h,shotTimer:1.2+Math.random()*1.4,
        alive: true,
        anim: Math.random() * Math.PI * 2
      };
    }

    function generateLevel(index) {
      const rng  = mulberry32(1337 + index * 7919);
      const diff = Math.min(index, 20);

      const platforms = [];
      const coins     = [];
      const enemies   = [];
      const spikes    = [];
      const ammo      = [];
      const keys      = [];
      const chests    = [];
      const hearts    = [];
      const shields   = [];
      const magnets   = [];
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
            enemies.push(spawnEnemy(px + 6, py, px + 4, px + pw - 4, 55 + diff * 18,index%4===3?'runner':'slime'));
          }
        }
      }

      for (let i = 1; i < segments.length - 1; i++) {
        const s = segments[i];

        const nEnemies = (s.w > 300 ? 1 : 0) + (rng() < 0.25 + diff * 0.12 ? 1 : 0);
        for (let k = 0; k < nEnemies; k++) {
          const ex = s.x + 30 + rng() * (s.w - 100);
          enemies.push(spawnEnemy(ex, GROUND_Y, s.x + 8, s.x + s.w - 8, 60 + diff * 20 + rng() * 30,index%4===1?'runner':'slime'));
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
      if(index>=2&&index%3===0){const s=segments[2+((index/3|0)%(segments.length-3))];enemies.push(spawnEnemy(s.x+s.w*.55,GROUND_Y-125,s.x+30,s.x+s.w-30,70+diff*10,'bird'));}
      if(index%4===2){const s=segments[2+((index/4|0)%(segments.length-3))];spikes.push({x:s.x+s.w*.52,y:GROUND_Y-22,w:52,h:22,moving:true,baseX:s.x+s.w*.52,range:Math.max(18,s.w*.2),speed:35+diff*5,phase:rng()*Math.PI*2});}
      enemies.forEach((enemy,i)=>enemy.id='l'+index+':enemy:'+i);
      const word = LEVEL_WORDS[index % LEVEL_WORDS.length];
      const letters = [...word].map((letter,i)=>{const s=segments[1+Math.min(segments.length-3,Math.floor((i+1)*(segments.length-2)/(word.length+1)))];return {id:'l'+index+':letter:'+i,letter,x:s.x+Math.max(45,Math.min(s.w-45,50+(s.w-100)*((i+1)/(word.length+1)))),y:GROUND_Y-78,r:14,taken:false};});
      const heartCount=2+(index%2);for(let i=0;i<heartCount;i++){const s=segments[1+Math.floor((i+1)*(segments.length-2)/(heartCount+1))];hearts.push({id:'l'+index+':heart:'+i,x:s.x+s.w*(.3+.4*((i%2))),y:GROUND_Y-92-(i%2)*24,taken:false});}
      if(index%2===0){const s=segments[1+((index+2)%Math.max(1,segments.length-2))];shields.push({id:'l'+index+':shield:0',x:s.x+s.w*.48,y:GROUND_Y-112,taken:false});}
      if(index%3===1){const s=segments[1+((index+1)%Math.max(1,segments.length-2))];magnets.push({id:'l'+index+':magnet:0',x:s.x+s.w*.55,y:GROUND_Y-112,taken:false});}
      if (segments.length>2) {
        const ammoSeg=segments[1+(index%Math.max(1,segments.length-2))];
        if(index%2===0)ammo.push({id:'l'+index+':ammo:0',x:ammoSeg.x+Math.max(70,ammoSeg.w*.55),y:GROUND_Y-65,taken:false});
        const keySeg=segments[1+((index+1)%Math.max(1,segments.length-2))];
        keys.push({id:'l'+index+':key:0',x:keySeg.x+Math.max(65,keySeg.w*.35),y:GROUND_Y-70,taken:false});
        const chestSeg=segments[1+((index+2)%Math.max(1,segments.length-2))];
        chests.push({id:'l'+index+':chest:0',x:chestSeg.x+Math.max(90,chestSeg.w*.72),y:GROUND_Y-42,w:34,h:34,opened:false});
      }
      coins.forEach((item,i)=>item.id='l'+index+':coin:'+i);
      ammo.forEach((item,i)=>item.id=item.id||'l'+index+':ammo:'+i);keys.forEach((item,i)=>item.id=item.id||'l'+index+':key:'+i);chests.forEach((item,i)=>item.id=item.id||'l'+index+':chest:'+i);

      return {
        width: worldWidth,
        platforms, coins, enemies, spikes, segments, goal, letters, word, ammo, keys, chests, hearts, shields, magnets, enemyBullets,
        spawn: { x: 60, y: GROUND_Y - player.h - 2 }
      };
    }

    /* ==========================================================
       6. CARGA / REINICIO
       ========================================================== */
    function loadLevel(index) {
      world = generateLevel(index);
      State.level = index;
      State.wordProgress = new Array(world.word.length).fill('');
      bullets.length = 0;
      enemyBullets.length = 0;
      State.shieldTime = 0; State.magnetTime = 0;
      applyCollectedForLevel();

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
      if(State.lives<=0){State.lives=5;loadLevel(State.level);}
      window.SaltoOnline?.startRun();
      keys.left = keys.right = keys.jump = false;
      State.mode = 'playing';
      showScreen(null);
      showBanner('NIVEL 1');
      updateHUD(true);
    }

    function restartGame() { saveCheckpoint();if(State.lives<=0)State.lives=5;loadLevel(State.level);State.mode='playing';showScreen(null);updateHUD(true);saveCheckpoint(); }

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
      updatePowerups(dt);
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

      if(State.shieldTime>0&&p.y+p.h>GROUND_Y){p.y=GROUND_Y-p.h;p.vy=0;p.onGround=true;}

      if (p.y > VIEW_H + 200) fellInPit();
    }

    function updateEnemies(dt) {
      for (const e of world.enemies) {
        if (!e.alive) continue;
        e.anim += dt * 6;
        e.x += e.dir * e.speed * dt;
        if (e.x < e.minX)       { e.x = e.minX; e.dir = 1; }
        if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.dir = -1; }
        if(e.kind==='bird'){e.y=e.baseY+Math.sin(e.anim*1.7)*22;e.shotTimer-=dt;if(e.shotTimer<=0&&Math.abs(player.x-e.x)<620){world.enemyBullets.push({x:e.x+e.w/2,y:e.y+e.h*.65,vx:Math.sign(player.x-e.x)*230,vy:clamp((player.y-e.y)*.32,-110,150),life:3});e.shotTimer=1.5+Math.random()*1.3;}}
      }
    }

    function updatePowerups(dt){
      State.shieldTime=Math.max(0,State.shieldTime-dt);State.magnetTime=Math.max(0,State.magnetTime-dt);
      for(const s of world.spikes)if(s.moving)s.x=s.baseX+Math.sin(State.time*(s.speed/25)+s.phase)*s.range;
      if(State.magnetTime>0){for(const item of [...world.coins,...world.letters,...world.keys]){if(item.taken)continue;const dx=player.x+player.w/2-item.x,dy=player.y+player.h/2-item.y,d=Math.hypot(dx,dy);if(d>0&&d<440){const step=Math.min(380*dt,d);item.x+=dx/d*step;item.y+=dy/d*step;}}}
      for(let i=world.enemyBullets.length-1;i>=0;i--){const b=world.enemyBullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.life<=0||b.x<cam.x-80||b.x>cam.x+VIEW_W+80){world.enemyBullets.splice(i,1);continue;}if(aabb(player,{x:b.x-6,y:b.y-6,w:12,h:12})){world.enemyBullets.splice(i,1);if(State.shieldTime<=0)damagePlayer();}}
      checkpointClock+=dt;if(State.mode==='playing'&&checkpointClock>=3){checkpointClock=0;saveCheckpoint();}
    }

    function checkCollisions() {
      const p = player;

      for (const c of world.coins) {
        if (c.taken) continue;
        if (Math.abs(c.x - (p.x + p.w / 2)) < c.r + p.w / 2 &&
            Math.abs(c.y - (p.y + p.h / 2)) < c.r + p.h / 2) {
          if(!collectOnce(c))continue;
          State.coins++;
          State.score += 10;
          Sound.coin();
          spawnParticles(c.x, c.y, '#ffd166', 9);
          addText(c.x, c.y - 8, '+10', '#ffd166');
          updateHUD();
          if(window.SaltoOnline)window.SaltoOnline.reward(1,c.id);
        }
      }

      for (const item of world.letters) {
        if(item.taken)continue;
        if(Math.abs(item.x-(p.x+p.w/2))<24&&Math.abs(item.y-(p.y+p.h/2))<34){if(!collectOnce(item,'letter'))continue;const idx=Number(item.id.split(':').pop());State.wordProgress[idx]=item.letter;Sound.coin();addText(item.x,item.y-12,item.letter,'#8df3ff');updateHUD(true);}
      }
      for (const item of world.ammo) if(!item.taken&&Math.abs(item.x-(p.x+p.w/2))<30&&Math.abs(item.y-(p.y+p.h/2))<34){if(!collectOnce(item))continue;State.bullets+=20;addText(item.x,item.y-12,'+20 balas','#fd86ef');Sound.coin();updateHUD(true);}
      for (const item of world.keys) if(!item.taken&&Math.abs(item.x-(p.x+p.w/2))<28&&Math.abs(item.y-(p.y+p.h/2))<35){if(!collectOnce(item))continue;State.keys++;addText(item.x,item.y-12,'🔑','#ffe58a');spawnParticles(item.x,item.y,'#ffe58a',8);Sound.coin();updateHUD(true);}
      for(const item of world.hearts)if(!item.taken&&State.lives<5&&Math.abs(item.x-(p.x+p.w/2))<32&&Math.abs(item.y-(p.y+p.h/2))<36){if(!collectOnce(item))continue;State.lives=Math.min(5,State.lives+1);spawnParticles(item.x,item.y,'#f72585',10);addText(item.x,item.y-12,'+1 vida','#f72585');updateHUD(true);}
      for(const item of world.shields)if(!item.taken&&Math.abs(item.x-(p.x+p.w/2))<32&&Math.abs(item.y-(p.y+p.h/2))<36){if(!collectOnce(item))continue;State.shieldTime=10;addText(item.x,item.y-12,'ESCUDO 10s','#4cc9f0');}
      for(const item of world.magnets)if(!item.taken&&Math.abs(item.x-(p.x+p.w/2))<32&&Math.abs(item.y-(p.y+p.h/2))<36){if(!collectOnce(item))continue;State.magnetTime=10;addText(item.x,item.y-12,'IMÁN 10s','#ffd166');}
      for (const chest of world.chests) if(!chest.opened&&aabb(p,chest)){
        if(State.keys>0){chest.opened=true;State.keys--;markCollected(chest.id);const reward=Math.floor((world.width+State.level*17)%3);publishEvent('chest',chest.id,{reward});grantChestReward(reward,chest);saveCheckpoint();Sound.levelUp();spawnParticles(chest.x,chest.y,'#ffd166',16);updateHUD(true);}else addText(chest.x,chest.y-12,'Necesitas llave','#ffe58a');
      }

      for (const s of world.spikes) {
        const hit = { x: s.x + 4, y: s.y + 6, w: s.w - 8, h: s.h - 6 };
        if (aabb(p, hit) && p.invuln <= 0 && State.shieldTime<=0) { damagePlayer(); return; }
      }

      for (const e of world.enemies) {
        if (!e.alive || !aabb(p, e)) continue;
        if(State.shieldTime>0)continue;

        const stomping = p.vy > 0 && (p.y + p.h) - e.y < e.h * 0.75;

        if (stomping) {
          e.alive = false;
          publishEvent('enemy',e.id,{points:50});
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

    function publishEvent(kind,id,extra={}){if(!id)return;if(['collect','letter','chest','enemy'].includes(kind)){markCollected(id);setTimeout(saveCheckpoint,0);}if(window.SaltoOnline)window.SaltoOnline.gameEvent({kind,id,level:State.level,...extra});}
    function markCollected(id){if(!id)return;const level=Number(String(id).match(/^l(\d+):/)?.[1]);if(!Number.isFinite(level))return;const list=State.collectedByLevel[level]||(State.collectedByLevel[level]=[]);if(!list.includes(id))list.push(id);}
    function applyCollectedForLevel(){const saved=State.collectedByLevel[State.level];const found=new Set(Array.isArray(saved)?saved:[]);for(const group of [world.coins,world.letters,world.ammo,world.keys,world.hearts,world.shields,world.magnets])for(const item of group)if(found.has(item.id))item.taken=true;for(const item of world.chests)if(found.has(item.id))item.opened=true;for(const item of world.enemies)if(found.has(item.id))item.alive=false;}
    function checkpointPayload(){return {level:State.level,x:player.x,y:player.y,lives:State.lives,coins:State.coins,score:State.score,bullets:State.bullets,keys:State.keys,shieldTime:State.shieldTime,magnetTime:State.magnetTime,wordProgress:State.wordProgress.join(''),collected:State.collectedByLevel};}
    function saveCheckpoint(immediate=false){const cp=checkpointPayload();if(window.SaltoOnline?.saveCheckpoint)return window.SaltoOnline.saveCheckpoint(cp,immediate);try{localStorage.setItem('saltoEstelar.guestCheckpoint',JSON.stringify(cp));}catch{}return Promise.resolve();}
    function restoreCheckpoint(cp){if(!cp||typeof cp!=='object')return;State.collectedByLevel=cp.collected&&typeof cp.collected==='object'?cp.collected:{};const level=clamp(Number(cp.level)||0,0,LEVEL_COUNT-1);loadLevel(level);State.lives=clamp(Number(cp.lives??5),0,5);State.coins=Math.max(0,Number(cp.coins)||0);State.score=Math.max(0,Number(cp.score)||0);State.bullets=Math.max(0,Number(cp.bullets)||0);State.keys=Math.max(0,Number(cp.keys)||0);State.shieldTime=clamp(Number(cp.shieldTime)||0,0,10);State.magnetTime=clamp(Number(cp.magnetTime)||0,0,10);State.wordProgress=[...world.word].map((_,i)=>String(cp.wordProgress||'')[i]||'');player.x=clamp(Number(cp.x)||world.spawn.x,world.spawn.x,world.width-player.w);player.y=clamp(Number(cp.y)||world.spawn.y,-100,GROUND_Y-player.h);if(State.lives<=0){State.lives=5;player.x=world.spawn.x;player.y=world.spawn.y;}State.mode='menu';const startButton=document.getElementById('btnStart');if(startButton)startButton.textContent='▶ Continuar nivel '+(level+1);updateHUD(true);}
    function collectOnce(item,kind='collect'){if(item.taken)return false;item.taken=true;markCollected(item.id);publishEvent(kind,item.id);saveCheckpoint();return true;}
    function grantChestReward(reward,chest){if(reward===0){State.coins+=10;if(window.SaltoOnline)window.SaltoOnline.reward(10,chest.id+':coins');addText(chest.x,chest.y-18,'+10 monedas','#ffd166');}else if(reward===1){State.bullets+=8;addText(chest.x,chest.y-18,'+8 balas','#fd86ef');}else{State.lives=Math.min(5,State.lives+1);addText(chest.x,chest.y-18,'+1 vida','#43e97b');}updateHUD(true);}
    function applySharedEvent(event){if(!world||!event||event.level!==State.level)return;markCollected(event.id);for(const group of [world.coins,world.letters,world.ammo,world.keys,world.hearts,world.shields,world.magnets]){const item=group.find(x=>x.id===event.id);if(item){if(item.taken)return;item.taken=true;if(group===world.coins){State.coins++;State.score+=10;}else if(group===world.letters){const idx=Number(item.id.split(':').pop());State.wordProgress[idx]=item.letter;}else if(group===world.ammo)State.bullets+=20;else if(group===world.keys)State.keys++;else if(group===world.hearts)State.lives=Math.min(5,State.lives+1);else if(group===world.shields)State.shieldTime=10;else if(group===world.magnets)State.magnetTime=10;saveCheckpoint();updateHUD(true);return;}}const chest=world.chests.find(x=>x.id===event.id);if(chest){if(chest.opened)return;chest.opened=true;if(window.SaltoOnline?.active)grantChestReward(event.reward,chest);saveCheckpoint();return;}const enemy=world.enemies.find(x=>x.id===event.id);if(enemy&&enemy.alive){enemy.alive=false;State.score+=Number(event.points)||25;saveCheckpoint();updateHUD(true);}}
    function confirmSharedEvent(event){if(!world||event.level!==State.level)return;const chest=world.chests.find(x=>x.id===event.id);if(chest&&!chest.opened)grantChestReward(event.reward,chest);}
    function rejectSharedEvent(event){if(!world)return;const data=typeof event==='string'?{id:event}:event,id=data.id;const c=world.coins.find(x=>x.id===id);if(c){c.taken=false;State.coins=Math.max(0,State.coins-1);State.score=Math.max(0,State.score-10);}const a=world.ammo.find(x=>x.id===id);if(a){a.taken=false;State.bullets=Math.max(0,State.bullets-20);}const k=world.keys.find(x=>x.id===id);if(k){k.taken=false;State.keys=Math.max(0,State.keys-1);}const l=world.letters.find(x=>x.id===id);if(l){l.taken=false;State.wordProgress[Number(id.split(':').pop())]='';}const chest=world.chests.find(x=>x.id===id);if(chest){chest.opened=false;State.keys++;}const enemy=world.enemies.find(x=>x.id===id);if(enemy){enemy.alive=true;State.score=Math.max(0,State.score-(Number(data.points)||0));}updateHUD(true);}

    function fireShot(){if(State.mode!=='playing'||State.bullets<=0)return;State.bullets--;bullets.push({x:player.x+player.w/2+player.facing*20,y:player.y+20,vx:player.facing*620,life:1.1});Sound.stomp();updateHUD(true);}

    /* ==========================================================
       9. DAÑO / RESPAWN / NIVEL
       ========================================================== */
    function damagePlayer() {
      if (State.mode !== 'playing' || player.invuln > 0) return;
      if(State.shieldTime>0)return;

      State.lives--;
      State.shake = 0.5;
      player.invuln = 1.8;
      Sound.hurt();
      spawnParticles(player.x + player.w / 2, player.y + player.h / 2, '#f72585', 20);
      updateHUD();

      if (State.lives <= 0) handleNoLives();
      else respawnPlayer();
      saveCheckpoint();
    }

    function fellInPit() {
      if(State.shieldTime>0){player.y=GROUND_Y-player.h;player.vy=0;player.onGround=true;return;}
      State.lives--;
      State.shake = 0.5;
      Sound.hurt();
      updateHUD();

      if (State.lives <= 0) handleNoLives();
      else respawnPlayer();
      saveCheckpoint();
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

    function handleNoLives(){if(window.SaltoOnline?.active&&window.SaltoOnline.requestRevive()){State.mode='waiting';showBanner('TU COMPAÑERO TE AYUDA');return;}gameOver();}
    function reviveWithPartner(){State.lives=1;respawnPlayer();State.mode='playing';showScreen(null);showBanner('¡REVIVISTE EN EQUIPO!');updateHUD(true);saveCheckpoint();}

    function reachGoal() {
      if (State.mode !== 'playing') return;
      if(State.wordProgress.join('')===world.word){State.score+=100;State.coins+=10;if(window.SaltoOnline)window.SaltoOnline.reward(10,'l'+State.level+':word-bonus');spawnParticles(player.x,player.y,'#8df3ff',18);addText(player.x,player.y-18,'PALABRA +100','#8df3ff');}
      if(window.SaltoOnline?.active&&!window.SaltoOnline.host){State.mode='waiting';window.SaltoOnline.goalReached(State.level);showBanner('ESPERANDO AL ANFITRIÓN');return;}

      State.score += 250;
      Sound.levelUp();
      spawnParticles(world.goal.x + 20, world.goal.y + 30, '#43e97b', 22);

      const completedLevel=State.level+1;
      State.level++;
      State.lives=5;State.shieldTime=0;State.magnetTime=0;
      if(window.SaltoOnline?.active)window.SaltoOnline.levelChanged(State.level);
      if(window.SaltoOnline)window.SaltoOnline.matchProgress({level:completedLevel,score:State.score,coins:State.coins,completed:true,distance:player.x});
      if (State.level >= LEVEL_COUNT) {
        saveCheckpoint(true);
        victory();
        return;
      }

      loadLevel(State.level);
      State.mode = 'playing';
      showScreen(null);
      showBanner('NIVEL ' + (State.level + 1));
      updateHUD(true);
      saveCheckpoint(true);
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

    const BIOME_THEMES=[['#080d26','#182a63','#2f4bb0'],['#073332','#14735d','#59c58d'],['#21103d','#613384','#be6ac4'],['#301522','#85433e','#e5a04c'],['#07273c','#176b9b','#9bdcf0'],['#25213c','#50518a','#df85ad'],['#181c22','#4a5964','#c5d9dd'],['#2b1d08','#76601b','#edcf55'],['#122440','#294e9c','#54b8d3'],['#25142d','#803750','#ed8c77']];
    function drawBackground() {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      const bg=window.SaltoOnline?.profile?.background;
      const theme=BIOME_THEMES[Math.floor(State.level/10)%BIOME_THEMES.length];
      if(bg==='bg_ice'){g.addColorStop(0,'#092b50');g.addColorStop(.5,'#17638a');g.addColorStop(1,'#afebf7');}
      else if(bg==='bg_halloween'){g.addColorStop(0,'#210a3b');g.addColorStop(.5,'#542064');g.addColorStop(1,'#c04b27');}
      else if(bg==='bg_space'){g.addColorStop(0,'#080a25');g.addColorStop(.5,'#17235b');g.addColorStop(1,'#462d7c');}
      else {g.addColorStop(0,theme[0]);g.addColorStop(.5,theme[1]);g.addColorStop(1,theme[2]);}
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

      drawHills(cam.x * 0.15, theme[1], 400, 42, 0.006);
      drawHills(cam.x * 0.30, theme[2], 452, 30, 0.010);
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
      for(const l of world.letters)if(!l.taken&&l.x>cam.x-30&&l.x<cam.x+VIEW_W+30){ctx.save();ctx.fillStyle='#8df3ff';ctx.shadowColor='#4cc9f0';ctx.shadowBlur=14;ctx.font='bold 18px system-ui';ctx.textAlign='center';ctx.fillText(l.letter,l.x,l.y);ctx.restore();}
      for(const a of world.ammo)if(!a.taken){ctx.font='20px system-ui';ctx.fillText('🍓',a.x-10,a.y+7);}
      for(const k of world.keys)if(!k.taken){ctx.font='19px system-ui';ctx.fillText('🔑',k.x-10,k.y+7);}
      for(const h of world.hearts)if(!h.taken){ctx.font='23px system-ui';ctx.fillText('💖',h.x-12,h.y+8);}
      for(const s of world.shields)if(!s.taken){ctx.font='22px system-ui';ctx.fillText('🛡️',s.x-12,s.y+8);}
      for(const m of world.magnets)if(!m.taken){ctx.font='22px system-ui';ctx.fillText('🧲',m.x-12,m.y+8);}
      for(const c of world.chests)drawChest(c);
      for(const b of bullets){ctx.fillStyle='#fd86ef';ctx.shadowColor='#fd86ef';ctx.shadowBlur=8;ctx.beginPath();ctx.arc(b.x,b.y,5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
      for(const b of world.enemyBullets){ctx.fillStyle='#ff794d';ctx.shadowColor='#ff794d';ctx.shadowBlur=8;ctx.beginPath();ctx.arc(b.x,b.y,6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}

      for (const e of world.enemies) {
        if (e.alive && inView(e)) drawEnemy(e);
      }
      if(remotePlayer&&remotePlayer.level===State.level)drawRemotePlayer(remotePlayer);
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

    function drawChest(c){ctx.save();ctx.fillStyle=c.opened?'#806341':'#b87535';roundRect(c.x,c.y+8,c.w,c.h-8,6);ctx.fill();ctx.fillStyle='#d89546';ctx.translate(c.x+4,c.y+9);ctx.rotate(c.opened?-.3:0);roundRect(0,-7,c.w-8,13,5);ctx.fill();ctx.restore();ctx.fillStyle='#ffd166';ctx.fillRect(c.x+14,c.y+17,6,9);}

    function drawEnemy(e) {
      const bob = Math.sin(e.anim) * 2;
      const x = e.x, y = e.y + bob, w = e.w, h = e.h;
      if(e.kind==='bird'){ctx.save();ctx.font='30px system-ui';ctx.textAlign='center';ctx.fillText('🐦',x+w/2,y+h);ctx.restore();return;}

      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, e.y + h + 3, w * 0.45, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, e.kind==='runner'?'#8df3ff':'#ff7b54');
      g.addColorStop(1, e.kind==='runner'?'#2b7fd4':'#c9184a');
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

      const avatar=window.SaltoOnline?.profile?.avatar||'avatar_blue';
      const avatarColor=avatar==='avatar_rose'?'#f72585':avatar==='avatar_gold'?'#ffd166':'#2b7fd4';
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#8df3ff');
      g.addColorStop(1, avatarColor);
      ctx.save();
      ctx.shadowColor = 'rgba(76,201,240,.65)';
      ctx.shadowBlur  = 18;
      ctx.fillStyle = g;
      roundRect(x, y, w, h, 12);
      ctx.fill();
      ctx.restore();
      if(State.shieldTime>0||State.magnetTime>0){ctx.save();ctx.globalAlpha=.55+.2*Math.sin(State.time*10);ctx.strokeStyle=State.shieldTime>0?'#4cc9f0':'#ffd166';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(cx,bottom-h/2,w*.8,h*.72,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
      const username=window.SaltoOnline?.profile?.username;if(username){ctx.save();ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='rgba(4,8,25,.8)';ctx.fillStyle='#fff';ctx.strokeText(username,cx,y-8);ctx.fillText(username,cx,y-8);ctx.restore();}
      const accessory=window.SaltoOnline?.profile?.accessory;
      if(accessory==='hat_crown'){ctx.fillStyle='#ffd166';ctx.beginPath();ctx.moveTo(x+4,y+5);ctx.lineTo(x+9,y-5);ctx.lineTo(x+16,y+2);ctx.lineTo(x+23,y-5);ctx.lineTo(x+30,y+5);ctx.closePath();ctx.fill();}
      else if(accessory==='hat_astronaut'){ctx.strokeStyle='#d9f4ff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(cx,y+2,14,7,0,Math.PI,Math.PI*2);ctx.stroke();}

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

    function drawRemotePlayer(p){if(!p||!Number.isFinite(p.x))return;ctx.save();ctx.globalAlpha=.82;const color=p.avatar==='avatar_rose'?'#f72585':p.avatar==='avatar_gold'?'#ffd166':'#7b5cff';const g=ctx.createLinearGradient(p.x,p.y,p.x,p.y+44);g.addColorStop(0,'#eaf2ff');g.addColorStop(1,color);ctx.fillStyle=g;roundRect(p.x,p.y,34,44,12);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.x+11,p.y+16,4,0,Math.PI*2);ctx.arc(p.x+23,p.y+16,4,0,Math.PI*2);ctx.fill();ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText(p.username||'Compañero',p.x+17,p.y-8);ctx.restore();}

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
        for(let i=bullets.length-1;i>=0;i--){const b=bullets[i],oldX=b.x;b.x+=b.vx*dt;b.life-=dt;if(b.life<=0){bullets.splice(i,1);continue;}for(const e of world.enemies){if(!e.alive)continue;const left=Math.min(oldX,b.x),right=Math.max(oldX,b.x);if(right>=e.x&&left<=e.x+e.w&&b.y>=e.y&&b.y<=e.y+e.h){e.alive=false;publishEvent('enemy',e.id,{points:25});bullets.splice(i,1);State.score+=25;spawnParticles(e.x+e.w/2,e.y+e.h/2,'#fd86ef',12);addText(e.x+e.w/2,e.y-4,'¡Eliminado!','#fd86ef');updateHUD();break;}}}
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
      const sig = [State.level, State.lives, State.coins, State.score, State.best,State.bullets,State.keys,State.wordProgress.join(''),Math.ceil(State.shieldTime),Math.ceil(State.magnetTime)].join('|');
      if (!force && sig === hudCache) return;
      hudCache = sig;

      el.hudLevel.textContent = (State.level + 1) + '/' + LEVEL_COUNT;
      el.hudLives.textContent = '❤'.repeat(Math.max(0, State.lives)) +
                                '♡'.repeat(Math.max(0, 5 - State.lives));
      el.hudCoins.textContent = State.coins;
      el.hudScore.textContent = State.score;
      el.hudBest.textContent  = State.best;
      const ammoNode=document.getElementById('hudAmmo');if(ammoNode)ammoNode.textContent=State.bullets+' / '+State.keys;
      const wordNode=document.getElementById('wordProgress');if(wordNode&&world){const effects=[State.shieldTime>0?'🛡️ '+Math.ceil(State.shieldTime)+'s':'',State.magnetTime>0?'🧲 '+Math.ceil(State.magnetTime)+'s':''].filter(Boolean).join(' · ');wordNode.textContent='Palabra: '+world.word.split('').map((ch,i)=>State.wordProgress[i]||'＿').join(' ')+(effects?' · '+effects:'');}
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
      if (k === 'f') fireShot();

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
    document.getElementById('btnShoot')?.addEventListener('pointerdown',e=>{e.preventDefault();fireShot();});

    function requestLandscapeMode(){if(!window.matchMedia('(pointer: coarse)').matches)return;const lock=()=>{try{screen.orientation?.lock?.('landscape')?.catch(()=>{});}catch(e){}};if(!document.fullscreenElement&&document.documentElement.requestFullscreen){document.documentElement.requestFullscreen().then(lock).catch(()=>{});}else lock();}
    document.getElementById('btnRotateLandscape')?.addEventListener('click',requestLandscapeMode);
    document.getElementById('btnStart').addEventListener('click', () => { requestLandscapeMode(); Sound.unlock(); startGame(); });
    document.getElementById('btnRetry').addEventListener('click', startGame);
    document.getElementById('btnPlayAgain').addEventListener('click', startGame);
    document.getElementById('btnRestartPause').addEventListener('click', startGame);
    document.getElementById('btnResume').addEventListener('click', togglePause);
    document.getElementById('btnRestart').addEventListener('click', restartGame);
    document.getElementById('btnPause').addEventListener('click', togglePause);
    document.getElementById('btnHome')?.addEventListener('click',async()=>{await saveCheckpoint(true);State.mode='menu';keys.left=keys.right=keys.jump=false;showScreen('screen-start');});

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

    const guestCheckpoint=(()=>{try{return JSON.parse(localStorage.getItem('saltoEstelar.guestCheckpoint')||'null')||JSON.parse(localStorage.getItem('saltoEstelar.localProfile')||'{}').checkpoint||null;}catch{return null;}})();
    if(guestCheckpoint)restoreCheckpoint(guestCheckpoint);
    window.addEventListener('pagehide',()=>saveCheckpoint(true));
    window.SaltoGame={start:startGame,getState:()=>({x:player.x,y:player.y,facing:player.facing,level:State.level,lives:State.lives,score:State.score,coins:State.coins,bullets:State.bullets,keys:State.keys,mode:State.mode,avatar:window.SaltoOnline?.profile?.avatar||'avatar_blue',word:world?.word,wordProgress:[...State.wordProgress]}),getCheckpoint:checkpointPayload,restoreCheckpoint,setRemote:p=>{remotePlayer=p;},setLives:n=>{State.lives=clamp(Number(n)||0,0,5);updateHUD(true);saveCheckpoint();},reviveWithPartner,addLife:()=>{State.lives=Math.min(5,State.lives+1);updateHUD(true);saveCheckpoint();},applySharedEvent,confirmSharedEvent,rejectSharedEvent,applyLevel:level=>{if(level>=0&&level<LEVEL_COUNT&&State.level!==level){loadLevel(level);State.lives=5;State.mode='playing';showScreen(null);showBanner('NIVEL '+(level+1));saveCheckpoint();}},shoot:fireShot,openScreen:showScreen};

  })();

