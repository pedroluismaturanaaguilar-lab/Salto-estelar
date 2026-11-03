'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function freePort() {
  return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});
}

test('API de cuenta, recompensas persistentes y sala WebSocket cooperativa', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'salto-estelar-'));
  const port=await freePort(),base='http://127.0.0.1:'+port,secret='test-secret-123';
  let child;
  const start=async()=>{
    child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,TOKEN_SECRET:secret},stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
    for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Server exited: '+log);try{const r=await fetch(base+'/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,60));}
    throw new Error('Server did not start: '+log);
  };
  const stop=async()=>{if(child&&!child.killed){child.kill();await new Promise(resolve=>child.once('exit',resolve));}};
  const post=async(route,data,token)=>fetch(base+'/api'+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
  const openSocket=token=>new Promise((resolve,reject)=>{const ws=new WebSocket('ws://127.0.0.1:'+port+'/?token='+encodeURIComponent(token));ws.addEventListener('open',()=>resolve(ws),{once:true});ws.addEventListener('error',reject,{once:true});});
  const nextMessage=(ws,predicate=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.removeEventListener('message',on);reject(new Error('Timed out waiting for websocket message'));},2500);const on=e=>{const data=JSON.parse(e.data);if(predicate(data)){clearTimeout(timer);ws.removeEventListener('message',on);resolve(data);}};ws.addEventListener('message',on);});
  t.after(async()=>{await stop();await fs.rm(dir,{recursive:true,force:true});});
  await start();

  const page=await fetch(base+'/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/screen-online/);assert.match(html,/screen-shop/);assert.match(html,/screen-targets/);
  assert.equal((await fetch(base+'/server.js')).status,404,'private server source must not be served as a static asset');

  const a=await post('/register',{username:'JugadoraUno',password:'segura12345'});
  assert.equal(a.status,201);const accountA=await a.json();
  const b=await post('/register',{username:'JugadoraDos',password:'segura67890'});
  assert.equal(b.status,201);const accountB=await b.json();
  const catalog=await (await fetch(base+'/api/catalog')).json();
  assert.equal(catalog.words.length,100);assert.equal(new Set(catalog.words).size,100);

  let reward=await (await post('/reward',{rewardId:'l0:coin:1',amount:1},accountA.token)).json();assert.equal(reward.profile.coins,1);
  reward=await (await post('/reward',{rewardId:'l0:coin:1',amount:1},accountA.token)).json();assert.equal(reward.profile.coins,1,'duplicate reward should not be credited');

  const first=await openSocket(accountA.token),second=await openSocket(accountB.token);
  t.after(()=>{first.close();second.close();});
  first.send(JSON.stringify({type:'create-room'}));const created=await nextMessage(first,m=>m.type==='room-created');
  second.send(JSON.stringify({type:'join',code:created.code}));await nextMessage(second,m=>m.type==='joined');await nextMessage(first,m=>m.type==='peer-joined');
  second.send(JSON.stringify({type:'state',state:{x:340,y:390,level:0,facing:1}}));
  const state=await nextMessage(first,m=>m.type==='state');assert.equal(state.state.x,340);
  first.send(JSON.stringify({type:'game-event',event:{id:'l0:coin:99',kind:'collect',level:0}}));
  const accepted=await nextMessage(first,m=>m.type==='game-event');assert.equal(accepted.playerId,accountA.user.id);
  second.send(JSON.stringify({type:'game-event',event:{id:'l0:coin:99',kind:'collect',level:0}}));
  const rejected=await nextMessage(second,m=>m.type==='game-event-rejected');assert.equal(rejected.eventId,'l0:coin:99');
  first.send(JSON.stringify({type:'chat',text:'Hola'}));const chat=await nextMessage(second,m=>m.type==='chat');assert.equal(chat.text,'Hola');

  await stop();await start();
  const login=await post('/login',{username:'JugadoraUno',password:'segura12345'});assert.equal(login.status,200);
  const me=await fetch(base+'/api/me',{headers:{authorization:'Bearer '+accountA.token}});const profile=await me.json();assert.equal(profile.user.profile.coins,1);
});
