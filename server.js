'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'salto-estelar.json');
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'local-' + crypto.randomBytes(32).toString('hex');
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8' };
const CATALOG = {
  avatar_blue:{name:'Estelar azul',category:'Personajes',price:0,type:'avatar'}, avatar_rose:{name:'Estelar rosa',category:'Personajes',price:120,type:'avatar'}, avatar_gold:{name:'Estelar dorado',category:'Personajes',price:300,type:'avatar'},
  hat_crown:{name:'Corona',category:'Accesorios',price:180,type:'accessory'}, hat_astronaut:{name:'Casco espacial',category:'Accesorios',price:240,type:'accessory'},
  bg_space:{name:'Nebulosa',category:'Fondos',price:150,type:'background'}, bg_ice:{name:'Mundo de hielo',category:'Fondos',price:220,type:'background'}, bg_halloween:{name:'Noche de Halloween',category:'Fondos',price:220,type:'background'},
  life:{name:'Vida extra',category:'Vidas',price:80,type:'life'}
};
const WORDS = ['AMOR','GATO','PERRO','AMISTAD','ESTRELLA','LUNA','SOL','PLANETA','GALAXIA','COMETA','COHETE','ASTRONAUTA','UNIVERSO','ORBITA','SATELITE','NEBULOSA','MARTE','TIERRA','VENUS','JUPITER','SATURNO','MERCURIO','NEPTUNO','PLUTON','COSMOS','BRILLO','NOCHE','CIELO','NUBE','LLUVIA','ARCOIRIS','MONTAÑA','BOSQUE','RIO','LAGO','OCEANO','PLAYA','ISLA','FUEGO','HIELO','VIENTO','NIEVE','FLOR','ARBOL','HOJA','FRUTA','MANZANA','CEREZA','BANANO','NARANJA','MUSICA','DANZA','JUEGO','SUEÑO','MAGIA','VALIENTE','ALEGRIA','SONRISA','FAMILIA','ESCUELA','LIBRO','PINTURA','DIBUJO','AMABLE','RESPETO','ESPERANZA','AVENTURA','CAMINO','TESORO','LLAVE','COFRE','AMIGO','AMIGA','EQUIPO','FUERZA','PODER','ENERGIA','VELOCIDAD','SALTO','CARRERA','META','VICTORIA','CAMPEON','MEDALLA','PREMIO','MONEDA','CORAZON','MARIPOSA','TORTUGA','CONEJO','DELFIN','BALLENA','AGUILA','LEON','TIGRE','DRAGON','FANTASIA','FUTURO','INFINITO','COMPARTIR'];

let pool = null;
let fileStore = { users: [] };
let fileWrite = Promise.resolve();
const rooms = new Map();
const clients = new Set();

async function initializeStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized:false }, max:5 });
    await pool.query('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, profile JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await pool.query('CREATE TABLE IF NOT EXISTS match_history (id BIGSERIAL PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE, room_code TEXT, level INTEGER NOT NULL DEFAULT 1, score INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    console.log('Base de datos PostgreSQL conectada.');
  } else {
    fs.mkdirSync(DATA_DIR, { recursive:true });
    try { fileStore = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { fileStore = { users:[] }; }
    console.warn('Usando almacenamiento local JSON. Para sincronizar cuentas en Render, configura DATABASE_URL.');
  }
}

function defaultProfile(username) {
  return { username, avatar:'avatar_blue', background:null, coins:0, level:1, completedLevels:[], score:0, distance:0, achievements:[], inventory:{ owned:['avatar_blue'], lives:0, bullets:0 }, checkpoint:{ level:0,x:60,y:414,lives:5,coins:0,score:0,bullets:0,keys:0,wordProgress:'',shieldTime:0,magnetTime:0,collected:{} }, history:[], updatedAt:new Date().toISOString() };
}
function normalizeProfile(profile, username) {
  const defaults=defaultProfile(username),p={...defaults,...(profile||{})};
  p.inventory={...defaults.inventory,...(profile?.inventory||{})};
  p.inventory.owned=Array.isArray(p.inventory.owned)?p.inventory.owned:['avatar_blue'];
  const cp=profile?.checkpoint||{};
  p.checkpoint={...defaults.checkpoint,...cp,level:Math.max(0,Math.min(99,Number(cp.level ?? Math.max(0,(p.level||1)-1))||0)),lives:Math.max(0,Math.min(5,Number(cp.lives??5)||0)),collected:cp.collected&&typeof cp.collected==='object'?cp.collected:{}};
  return p;
}
function saveFileStore() {
  if (pool) return Promise.resolve();
  const snapshot = JSON.stringify(fileStore, null, 2);
  fileWrite = fileWrite.then(async()=>{ await fs.promises.mkdir(DATA_DIR,{recursive:true}); const temp=DATA_FILE+'.tmp'; await fs.promises.writeFile(temp,snapshot); await fs.promises.rename(temp,DATA_FILE); });
  return fileWrite;
}
function safeUser(user) { return { id:user.id, username:user.username, profile:normalizeProfile(user.profile,user.username) }; }
async function findUserByName(username) {
  if (pool) { const r=await pool.query('SELECT id,username,password_hash,profile FROM players WHERE lower(username)=lower($1)',[username]); return r.rows[0]||null; }
  return fileStore.users.find(u=>u.username.toLowerCase()===username.toLowerCase())||null;
}
async function findUserById(id) {
  if (pool) { const r=await pool.query('SELECT id,username,password_hash,profile FROM players WHERE id=$1',[id]); return r.rows[0]||null; }
  return fileStore.users.find(u=>u.id===id)||null;
}
function passwordHash(password, salt=crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,key)=>e?reject(e):resolve(salt+':'+key.toString('hex'))));
}
async function verifyPassword(password, stored) {
  const [salt,hex]=String(stored||'').split(':'); if(!salt||!hex)return false;
  const candidate=await passwordHash(password,salt); const a=Buffer.from(candidate.split(':')[1],'hex'),b=Buffer.from(hex,'hex'); return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function issueToken(id) { const payload=Buffer.from(JSON.stringify({id,exp:Date.now()+30*86400000})).toString('base64url'); const sig=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('base64url'); return payload+'.'+sig; }
function verifyToken(token) {
  if(!token)return null; const [payload,sig]=token.split('.'); if(!payload||!sig)return null;
  const expected=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest(); let actual; try{actual=Buffer.from(sig,'base64url');}catch{return null;}
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;
  try{const data=JSON.parse(Buffer.from(payload,'base64url').toString());return data.exp>Date.now()?data.id:null;}catch{return null;}
}
async function createUser(username,password) {
  const id=crypto.randomUUID(); const profile=defaultProfile(username); const hash=await passwordHash(password);
  if(pool) await pool.query('INSERT INTO players(id,username,password_hash,profile) VALUES($1,$2,$3,$4)',[id,username,hash,profile]);
  else { fileStore.users.push({id,username,password_hash:hash,profile}); await saveFileStore(); }
  return {user:{id,username,profile},token:issueToken(id)};
}
async function updateProfile(id, mutate) {
  if(pool) {
    const cx=await pool.connect();
    try { await cx.query('BEGIN'); const q=await cx.query('SELECT username,profile FROM players WHERE id=$1 FOR UPDATE',[id]); if(!q.rows[0])throw new Error('Cuenta no encontrada'); const p=normalizeProfile(q.rows[0].profile,q.rows[0].username); mutate(p); p.updatedAt=new Date().toISOString(); await cx.query('UPDATE players SET profile=$2 WHERE id=$1',[id,p]); await cx.query('COMMIT'); return p; }
    catch(e){await cx.query('ROLLBACK');throw e;} finally{cx.release();}
  }
  const u=fileStore.users.find(x=>x.id===id); if(!u)throw new Error('Cuenta no encontrada'); u.profile=normalizeProfile(u.profile,u.username); mutate(u.profile); u.profile.updatedAt=new Date().toISOString(); await saveFileStore(); return u.profile;
}
function sendJson(res,status,data) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(data)); }
function readBody(req,limit=32768) { return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>limit){reject(Object.assign(new Error('Solicitud demasiado grande'),{status:413}));req.destroy();}});req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch{reject(Object.assign(new Error('JSON inválido'),{status:400}));}});req.on('error',reject);}); }
function bearer(req) { return (req.headers.authorization||'').replace(/^Bearer\s+/i,''); }
async function authenticated(req) { const id=verifyToken(bearer(req));return id?findUserById(id):null; }
async function serveApi(req,res,url) {
  const p=url.pathname;
  try {
    if(req.method==='GET'&&p==='/api/health') return sendJson(res,200,{status:'ok',database:pool?'postgres':'local-json',rooms:rooms.size,words:WORDS.length});
    if(req.method==='GET'&&p==='/api/catalog') return sendJson(res,200,{items:CATALOG,words:WORDS});
    if(req.method==='POST'&&p==='/api/register') {
      const b=await readBody(req),username=String(b.username||'').trim().slice(0,20),password=String(b.password||'');
      if(!/^[\p{L}\p{N}_-]{3,20}$/u.test(username)||password.length<4||password.length>100) return sendJson(res,400,{error:'Usa un nombre de 3 a 20 caracteres y una contraseña de 4 o más.'});
      if(await findUserByName(username))return sendJson(res,409,{error:'Ese nombre ya está registrado.'});
      const result=await createUser(username,password);return sendJson(res,201,result);
    }
    if(req.method==='POST'&&p==='/api/login') {
      const b=await readBody(req),u=await findUserByName(String(b.username||'').trim());
      if(!u||!(await verifyPassword(String(b.password||''),u.password_hash)))return sendJson(res,401,{error:'Usuario o contraseña incorrectos.'});
      return sendJson(res,200,{user:safeUser(u),token:issueToken(u.id)});
    }
    if(p.startsWith('/api/')) {
      const user=await authenticated(req);if(!user)return sendJson(res,401,{error:'Inicia sesión para continuar.'});
      if(req.method==='GET'&&p==='/api/me') return sendJson(res,200,{user:safeUser(user)});
      if(req.method==='POST'&&p==='/api/checkpoint') {
        const b=await readBody(req,262144),raw=b.checkpoint||{};
        const level=Math.max(0,Math.min(99,Math.floor(Number(raw.level)||0)));
        const x=Math.max(0,Math.min(1e7,Number(raw.x)||0)),y=Math.max(-500,Math.min(2000,Number(raw.y)||414));
        const lives=Math.max(0,Math.min(5,Math.floor(Number(raw.lives)||0))),bullets=Math.max(0,Math.min(9999,Math.floor(Number(raw.bullets)||0))),keys=Math.max(0,Math.min(999,Math.floor(Number(raw.keys)||0)));
        const coins=Math.max(0,Math.min(1e9,Math.floor(Number(raw.coins)||0))),score=Math.max(0,Math.min(1e9,Math.floor(Number(raw.score)||0)));
        const words=String(raw.wordProgress||'').slice(0,32),shieldTime=Math.max(0,Math.min(10,Number(raw.shieldTime)||0)),magnetTime=Math.max(0,Math.min(10,Number(raw.magnetTime)||0)),incoming=raw.collected&&typeof raw.collected==='object'?raw.collected:{};
        const profile=await updateProfile(user.id,p=>{
          const merged={...(p.checkpoint?.collected||{})};
          for(const [key,items] of Object.entries(incoming).slice(-100)){const n=Math.max(0,Math.min(99,Number(key)||0));if(!Array.isArray(items))continue;const old=new Set(Array.isArray(merged[n])?merged[n]:[]);for(const id of items.slice(0,2000)){const value=String(id).slice(0,100);if(/^l\d+:[\w-]+:\d+$/.test(value))old.add(value);}merged[n]=[...old].slice(-3000);}
          p.checkpoint={level,x,y,lives,coins,score,bullets,keys,wordProgress:words,shieldTime,magnetTime,collected:merged,updatedAt:new Date().toISOString()};
          p.level=Math.max(p.level||1,level+1);p.score=Math.max(p.score||0,score);
        });
        return sendJson(res,200,{profile});
      }
      if(req.method==='POST'&&p==='/api/profile') {
        const b=await readBody(req);const profile=await updateProfile(user.id,p=>{ if(b.distance)p.distance=Math.max(p.distance,Math.min(1e9,Number(b.distance)||0));if(b.score)p.score=Math.max(p.score,Math.min(1e9,Number(b.score)||0));if(b.level)p.level=Math.max(p.level,Math.min(100,Number(b.level)||1));if(b.completedLevel){const n=Math.max(1,Math.min(100,Number(b.completedLevel)));if(!p.completedLevels.includes(n))p.completedLevels.push(n);}if(b.rewardId&&b.rewardAmount){p.history.push({type:'reward',id:String(b.rewardId).slice(0,80),amount:Math.min(1000,Number(b.rewardAmount)||0),at:new Date().toISOString()});p.coins+=Math.min(1000,Number(b.rewardAmount)||0);} });return sendJson(res,200,{profile});
      }
      if(req.method==='POST'&&p==='/api/reward') {
        const b=await readBody(req),rewardId=String(b.rewardId||'').slice(0,100),amount=Math.max(1,Math.min(100,Number(b.amount)||0));
        if(!/^[\w:-]{1,100}$/.test(rewardId))return sendJson(res,400,{error:'Identificador de recompensa inválido.'});
        const profile=await updateProfile(user.id,p=>{if(p.history.some(h=>h.type==='reward'&&h.id===rewardId))return;const recent=p.history.filter(h=>h.type==='reward'&&Date.now()-Date.parse(h.at)<3600000).reduce((n,h)=>n+(h.amount||0),0);if(recent+amount>1000)throw new Error('Llegaste al límite de monedas por hora.');p.coins+=amount;p.history.unshift({type:'reward',id:rewardId,amount,at:new Date().toISOString()});});return sendJson(res,200,{profile});
      }
      if(req.method==='POST'&&p==='/api/purchase') {
        const b=await readBody(req),item=CATALOG[String(b.itemId||'')];if(!item)return sendJson(res,404,{error:'Artículo no encontrado.'});
        const profile=await updateProfile(user.id,p=>{if(item.type!=='life'&&p.inventory.owned.includes(String(b.itemId)))throw new Error('Ya tienes ese artículo.');if(p.coins<item.price)throw new Error('No tienes monedas suficientes.');p.coins-=item.price;if(item.type==='life')p.inventory.lives=(p.inventory.lives||0)+1;else p.inventory.owned.push(String(b.itemId));if(item.type==='avatar')p.avatar=String(b.itemId);p.history.push({type:'purchase',item:String(b.itemId),at:new Date().toISOString()});});return sendJson(res,200,{profile});
      }
      if(req.method==='POST'&&p==='/api/cosmetics') {
        const b=await readBody(req),id=String(b.itemId||'');const profile=await updateProfile(user.id,p=>{const item=CATALOG[id];if(!item||!p.inventory.owned.includes(id)||!['avatar','accessory','background'].includes(item.type))throw new Error('Ese artículo no está desbloqueado.');if(item.type==='avatar')p.avatar=id;else p[item.type]=id;});return sendJson(res,200,{profile});
      }
      if(req.method==='POST'&&p==='/api/use-life') {
        const profile=await updateProfile(user.id,p=>{if((p.inventory.lives||0)<1)throw new Error('No tienes vidas extra guardadas.');p.inventory.lives--;});return sendJson(res,200,{profile});
      }
      if(req.method==='POST'&&p==='/api/match') {
        const b=await readBody(req),profile=await updateProfile(user.id,p=>{const coins=Math.max(0,Math.min(200,Number(b.coins)||0));p.coins+=coins;const points=Math.max(0,Math.min(100000,Number(b.score)||0));p.score=Math.min(1e9,(p.score||0)+points);p.level=Math.max(p.level,Math.min(100,Number(b.level)||1));const level=Math.max(1,Math.min(100,Number(b.level)||1));if(b.completed&&!p.completedLevels.includes(level))p.completedLevels.push(level);p.distance+=Math.max(0,Math.min(1e7,Number(b.distance)||0));for(const n of [1,10,50,100])if(p.completedLevels.length>=n&&!p.achievements.includes('levels-'+n))p.achievements.push('levels-'+n);p.history.unshift({level,score:points,coins,room:String(b.room||'').slice(0,12),at:new Date().toISOString()});p.history=p.history.slice(0,50);});if(pool)await pool.query('INSERT INTO match_history(player_id,room_code,level,score,coins) VALUES($1,$2,$3,$4,$5)',[user.id,String(b.room||'').slice(0,12),Number(b.level)||1,Number(b.score)||0,Number(b.coins)||0]);return sendJson(res,200,{profile});
      }
      return sendJson(res,404,{error:'Ruta API no encontrada.'});
    }
  } catch(e) { return sendJson(res,e.status||400,{error:e.message||'Error del servidor.'}); }
  return false;
}

function frame(opcode,payload=Buffer.alloc(0)) {
  const body=Buffer.isBuffer(payload)?payload:Buffer.from(payload);let head;
  if(body.length<126){head=Buffer.from([0x80|opcode,body.length]);}
  else if(body.length<65536){head=Buffer.alloc(4);head[0]=0x80|opcode;head[1]=126;head.writeUInt16BE(body.length,2);}
  else{head=Buffer.alloc(10);head[0]=0x80|opcode;head[1]=127;head.writeBigUInt64BE(BigInt(body.length),2);}
  return Buffer.concat([head,body]);
}
function sendWs(client,data) { if(!client.closed)client.socket.write(frame(1,JSON.stringify(data))); }
function roomBroadcast(room,data,except=null) { for(const c of room.clients)if(c!==except)sendWs(c,data); }
function leaveRoom(client) { if(!client.room)return;const room=client.room;room.clients.delete(client);client.room=null;roomBroadcast(room,{type:'peer-left',playerId:client.user.id});if(room.clients.size===0)rooms.delete(room.code); }
function handleWsMessage(client,message) {
  if(Buffer.isBuffer(message)) { try{message=JSON.parse(message.toString());}catch{return;} }
  if(!message||typeof message.type!=='string')return;
  if(message.type==='join') {
    if(client.room||!client.user)return;const code=String(message.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');const room=rooms.get(code);if(!room)return sendWs(client,{type:'error',error:'La sala no existe o ya se cerró.'});if(room.clients.size>=2)return sendWs(client,{type:'error',error:'La sala ya tiene dos jugadores.'});
    client.room=room;room.clients.add(client);sendWs(client,{type:'joined',code,host:room.host===client.user.id,players:[...room.clients].map(c=>({id:c.user.id,username:c.user.username,avatar:c.user.profile.avatar}))});sendWs(client,{type:'level',level:room.level});const hostClient=[...room.clients].find(c=>c.user.id===room.host);if(hostClient?.state)sendWs(client,{type:'state',playerId:hostClient.user.id,state:{...hostClient.state,avatar:hostClient.user.profile.avatar,username:hostClient.user.username}});roomBroadcast(room,{type:'peer-joined',player:{id:client.user.id,username:client.user.username,avatar:client.user.profile.avatar}},client);return;
  }
  if(message.type==='create-room') {
    if(!client.user||client.room)return sendWs(client,{type:'error',error:'Inicia sesión para crear una sala.'});let code;do{code=crypto.randomBytes(4).toString('hex').toUpperCase();}while(rooms.has(code));const room={code,host:client.user.id,clients:new Set([client]),level:Math.max(0,Math.min(99,Number(message.level)||0)),started:false,events:new Map()};rooms.set(code,room);client.room=room;return sendWs(client,{type:'room-created',code,host:true,invite:'/index.html?room='+code});
  }
  const room=client.room;if(!room)return;
  if(message.type==='state') {const s=message.state||{};if(!Number.isFinite(s.x)||!Number.isFinite(s.y))return;client.state={x:s.x,y:s.y,level:s.level,lives:s.lives};if(room.host===client.user.id)room.level=Math.max(0,Math.min(99,Number(s.level)||0));roomBroadcast(room,{type:'state',playerId:client.user.id,state:{x:Math.max(0,Math.min(100000,s.x)),y:Math.max(-500,Math.min(2000,s.y)),facing:s.facing<0?-1:1,level:Math.max(0,Math.min(99,Number(s.level)||0)),lives:Math.max(0,Math.min(5,Number(s.lives)||0)),avatar:String(s.avatar||client.user.profile.avatar||'avatar_blue').slice(0,32),username:client.user.username}},client);return;}
  if(message.type==='game-event') {const ev=message.event||{},id=String(ev.id||'').slice(0,100);if(!id)return;if(room.events.has(id))return sendWs(client,{type:'game-event-rejected',eventId:id,event:room.events.get(id)});const accepted={...ev,id};room.events.set(id,accepted);if(room.events.size>4000)room.events.clear();roomBroadcast(room,{type:'game-event',playerId:client.user.id,event:accepted});return;}
  if(message.type==='level') {if(room.host!==client.user.id)return;const level=Math.max(0,Math.min(99,Number(message.level)||0));room.level=level;roomBroadcast(room,{type:'level',level},client);return;}
  if(message.type==='signal'&&['offer','answer','candidate'].includes(message.signalType)) {const data=JSON.stringify(message.data||{});if(data.length<200000)roomBroadcast(room,{type:'signal',signalType:message.signalType,data:message.data},client);return;}
  if(message.type==='chat'){const text=String(message.text||'').trim().slice(0,250);if(text)roomBroadcast(room,{type:'chat',playerId:client.user.id,username:client.user.username,text},client);}
  if(message.type==='target-score')roomBroadcast(room,{type:'target-score',score:Math.max(0,Math.min(10000,Number(message.score)||0))},client);
  if(message.type==='revive-request'){const partner=[...room.clients].find(c=>c!==client);if(!partner||!partner.state||partner.state.lives<=1||!client.state||partner.state.level!==client.state.level||Math.hypot(partner.state.x-client.state.x,partner.state.y-client.state.y)>190)return sendWs(client,{type:'revive-denied'});partner.state.lives--;sendWs(partner,{type:'lives-sync',lives:partner.state.lives});sendWs(client,{type:'revive-approved'});}
}
async function upgradeWs(req,socket) {
  const key=req.headers['sec-websocket-key'];if(!key||req.headers.upgrade?.toLowerCase()!=='websocket'){socket.destroy();return;}
  const id=verifyToken(new URL(req.url,'http://localhost').searchParams.get('token'));const user=id?await findUserById(id):null;if(!user){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const client={socket,user,room:null,buffer:Buffer.alloc(0),closed:false};clients.add(client);
  const close=()=>{if(client.closed)return;client.closed=true;clients.delete(client);leaveRoom(client);};socket.on('close',close);socket.on('error',close);
  socket.on('data',chunk=>{client.buffer=Buffer.concat([client.buffer,chunk]);while(client.buffer.length>=2){const b0=client.buffer[0],b1=client.buffer[1],masked=!!(b1&128);let len=b1&127,off=2;if(len===126){if(client.buffer.length<4)return;len=client.buffer.readUInt16BE(2);off=4;}else if(len===127){if(client.buffer.length<10)return;const big=client.buffer.readBigUInt64BE(2);if(big>200000n){close();socket.destroy();return;}len=Number(big);off=10;}if(len>200000){close();socket.destroy();return;}const maskSize=masked?4:0;if(client.buffer.length<off+maskSize+len)return;let payload=client.buffer.subarray(off+maskSize,off+maskSize+len);if(masked){payload=Buffer.from(payload);const mask=client.buffer.subarray(off,off+4);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];}client.buffer=client.buffer.subarray(off+maskSize+len);const opcode=b0&15;if(opcode===8){socket.end(frame(8));close();return;}if(opcode===9){socket.write(frame(10,payload));continue;}if(opcode===1)handleWsMessage(client,payload);}});
}

const publicFiles=new Set(['/index.html','/game.js','/online.js','/styles.css','/pwa.js','/manifest.webmanifest','/service-worker.js','/favicon.ico']);
function serveStatic(req,res,url) {
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end('Solicitud incorrecta');return;}
  if(pathname==='/')pathname='/index.html';const filename=path.resolve(ROOT,'.'+pathname);if(!filename.startsWith(ROOT+path.sep)&&filename!==path.join(ROOT,'index.html')){res.writeHead(403);res.end('Prohibido');return;}
  if(!publicFiles.has(pathname)&&!/^\/icons\/[a-zA-Z0-9._-]+\.(?:png|svg|ico)$/.test(pathname)){res.writeHead(404);res.end('No encontrado');return;}
  fs.stat(filename,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404);res.end('No encontrado');return;}res.writeHead(200,{'content-type':MIME[path.extname(filename)]||'application/octet-stream','x-content-type-options':'nosniff'});fs.createReadStream(filename).pipe(res);});
}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/health')return sendJson(res,200,{status:'ok',game:'Salto Estelar',database:pool?'postgres':'local-json'});if(url.pathname.startsWith('/api/')){const result=await serveApi(req,res,url);if(result!==false)return;}serveStatic(req,res,url);});
server.on('upgrade',(req,socket)=>{upgradeWs(req,socket).catch(error=>{console.error('WebSocket:',error.message);socket.destroy();});});
const preferredPort=process.env.PORT?Number(process.env.PORT):3006,lastPort=process.env.PORT?preferredPort:3100;
function listen(port){server.once('error',error=>{if(error.code==='EADDRINUSE'&&port<lastPort)return listen(port+1);console.error(error.message);process.exitCode=1;});server.listen(port,'0.0.0.0',()=>{console.log('Salto Estelar disponible en http://localhost:'+port);console.log('Para otro dispositivo en la red, usa la IP de este computador y el puerto '+port+'.');});}
initializeStore().then(()=>listen(preferredPort)).catch(error=>{console.error('No se pudo iniciar la base de datos:',error);process.exit(1);});


