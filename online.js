(() => {
  'use strict';
  const $=id=>document.getElementById(id), TOKEN_KEY='saltoEstelar.token', LOCAL_KEY='saltoEstelar.localProfile';
  const state={token:localStorage.getItem(TOKEN_KEY)||'',user:null,profile:null,socket:null,active:false,host:false,room:'',remotePlayer:null,peer:null,stream:null,remoteStream:null,targets:{score:0,other:0,running:false,seconds:30}};
  let catalog={},syncTimer=null,targetTimer=null,targetMove=null,pendingRoomAction='',lastMatchScore=0;
  const api=async(path,body,method='POST')=>{const r=await fetch('/api'+path,{method,headers:{'content-type':'application/json',...(state.token?{authorization:'Bearer '+state.token}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'No se pudo conectar con el servidor.');return d;};
  function localProfile(){try{return JSON.parse(localStorage.getItem(LOCAL_KEY))||{coins:0,level:1,score:0,completedLevels:[],inventory:{owned:['avatar_blue']}};}catch{return {coins:0,level:1,score:0,completedLevels:[],inventory:{owned:['avatar_blue']}};}}
  function saveLocal(p){localStorage.setItem(LOCAL_KEY,JSON.stringify(p));}
  function setMessage(id,msg){const n=$(id);if(n)n.textContent=msg;}
  function show(id){const current=window.SaltoGame?.getState();window.SaltoGame?.openScreen(id||(current?.mode==='menu'?'screen-start':current?.mode==='paused'?'screen-pause':null));}
  function tokenNeeded(){if(!state.token){show('screen-account');setMessage('accountStatus','Crea una cuenta o inicia sesión para usar esta función.');return false;}return true;}
  async function refreshProfile(){if(!state.token)return;try{const d=await api('/me',null,'GET');state.user=d.user;state.profile=d.user.profile;renderProfile();renderShop();}catch(e){state.token='';state.user=null;state.profile=null;localStorage.removeItem(TOKEN_KEY);setMessage('accountStatus',e.message);}}
  function renderProfile(){
    const p=state.profile;if(!p)return;
    setMessage('accountStatus','Conectado como '+state.user.username+'. Este perfil queda asociado a tu cuenta.');
    $('authForms').hidden=true;$('profileDetails').hidden=false;$('btnLogout').hidden=false;
    $('profileDetails').innerHTML=[['Monedas',p.coins],['Nivel actual',p.level],['Niveles completados',p.completedLevels.length],['Puntuación',p.score],['Distancia',Math.round(p.distance||0)],['Logros',p.achievements.length],['Vidas extra',p.inventory?.lives||0],['Inventario',(p.inventory?.owned||[]).length],['Partidas',p.history.length]].map(([k,v])=>`<div><b>${k}</b><br>${v}</div>`).join('');
    const achievementList=$('achievementList');achievementList.hidden=!(p.achievements||[]).length;achievementList.replaceChildren();for(const achievement of (p.achievements||[])){const row=document.createElement('div');row.textContent='🏆 '+({ 'levels-1':'Primer nivel','levels-10':'Diez niveles','levels-50':'Cincuenta niveles','levels-100':'Leyenda: cien niveles' }[achievement]||achievement);achievementList.appendChild(row);}
    const history=$('historyList');history.hidden=!(p.history||[]).length;history.replaceChildren();for(const match of (p.history||[]).slice(0,8)){const row=document.createElement('div');row.textContent=match.type==='purchase'?'Compra: '+(catalog[match.item]?.name||match.item):match.type==='reward'?'Recompensa: +'+match.amount+' monedas':'Nivel '+match.level+' · '+match.score+' puntos · '+match.room;history.appendChild(row);}
    const picker=$('avatarPicker');picker.hidden=false;picker.innerHTML='';
    for(const id of (p.inventory?.owned||[]).filter(x=>catalog[x]?.type==='avatar')){const b=document.createElement('button');b.className='btn btn-ghost';b.textContent=(p.avatar===id?'✓ ':'')+catalog[id].name;b.onclick=async()=>{try{const d=await api('/cosmetics',{itemId:id});state.profile=d.profile;renderProfile();}catch(e){setMessage('accountStatus',e.message);}};picker.appendChild(b);}
    if((p.inventory?.lives||0)>0){const b=document.createElement('button');b.className='btn btn-primary';b.textContent='Usar vida extra';b.onclick=async()=>{try{const d=await api('/use-life',{});state.profile=d.profile;window.SaltoGame?.addLife();renderProfile();}catch(e){setMessage('accountStatus',e.message);}};picker.appendChild(b);}
  }
  async function authenticate(kind){const username=$('authUsername').value.trim(),password=$('authPassword').value;if(!username||!password)return setMessage('accountStatus','Escribe usuario y contraseña.');try{const d=await api('/'+kind,{username,password});state.token=d.token;state.user=d.user;state.profile=d.user.profile;localStorage.setItem(TOKEN_KEY,state.token);renderProfile();setMessage('onlineStatus','Cuenta conectada. Ya puedes crear o unirte a una sala.');const action=pendingRoomAction,invited=new URLSearchParams(location.search).get('room');pendingRoomAction='';if(action||invited)show('screen-online');connectSocket();if(action){const payload=action==='create'?{type:'create-room'}:{type:'join',code:$('roomCode').value.trim().toUpperCase()};sendWhenOpen(payload);}}catch(e){setMessage('accountStatus',e.message);}}
  function socketUrl(){const scheme=location.protocol==='https:'?'wss:':'ws:';return scheme+'//'+location.host+'/?token='+encodeURIComponent(state.token);}
  function connectSocket(){if(!state.token)return;if(state.socket&&(state.socket.readyState===WebSocket.OPEN||state.socket.readyState===WebSocket.CONNECTING))return;const ws=new WebSocket(socketUrl());state.socket=ws;ws.onopen=()=>{const code=new URLSearchParams(location.search).get('room');if(code)ws.send(JSON.stringify({type:'join',code}));};ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}handleMessage(m);};ws.onclose=()=>{if(state.active){state.active=false;state.host=false;setMessage('onlineStatus','Se perdió la conexión a la sala. Vuelve a conectarte.');}if(state.socket===ws)setTimeout(()=>{if(state.token&&!state.active)connectSocket();},2200);};ws.onerror=()=>setMessage('onlineStatus','No se pudo conectar al servidor. Revisa la conexión.');}
  function send(m){if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify(m));}
  function sendWhenOpen(message){connectSocket();let tries=0;const attempt=()=>{if(state.socket?.readyState===WebSocket.OPEN)send(message);else if(++tries<100)setTimeout(attempt,120);else setMessage('onlineStatus','No fue posible conectar con el servidor.');};attempt();}
  function handleMessage(m){
    if(m.type==='room-created'){state.active=true;state.host=true;state.room=m.code;setMessage('onlineStatus','Sala '+m.code+' creada. Comparte el enlace y espera a tu compañero.');const link=location.origin+'/index.html?room='+m.code;$('inviteLink').value=link;$('roomInvite').hidden=false;$('btnVoice').disabled=false;$('btnVideo').disabled=false;$('chatBox').hidden=false;ensureStarted();startSync();return;}
    if(m.type==='joined'){state.active=true;state.host=!!m.host;state.room=m.code;setMessage('onlineStatus','Conectado a la sala '+m.code+'. '+(m.players?.length===2?'Tu compañero está dentro.':'Esperando al anfitrión.'));$('roomInvite').hidden=false;$('inviteLink').value=location.origin+'/index.html?room='+m.code;$('btnVoice').disabled=false;$('btnVideo').disabled=false;$('chatBox').hidden=false;ensureStarted();startSync();return;}
    if(m.type==='peer-joined'){setMessage('onlineStatus',m.player.username+' se unió. ¡Pueden jugar!');if(state.host)ensureOffer();return;}
    if(m.type==='peer-left'){setMessage('onlineStatus','Tu compañero salió de la sala. Puedes invitar a otra persona.');closeCall();return;}
    if(m.type==='state'){state.remotePlayer=m.state;window.SaltoGame?.setRemote(m.state);return;}
    if(m.type==='revive-approved'){window.SaltoGame?.reviveWithPartner();return;}
    if(m.type==='revive-denied'){window.SaltoGame?.openScreen('screen-defeat');setMessage('onlineStatus','No hay un compañero cercano con vidas disponibles para revivirte.');return;}
    if(m.type==='lives-sync'){window.SaltoGame?.setLives(m.lives);return;}
    if(m.type==='game-event'){window.SaltoGame?.applySharedEvent(m.event);if(m.playerId===state.user?.id){if(m.event.kind==='collect'&&m.event.id.includes(':coin:'))reward(1,m.event.id);if(m.event.kind==='chest'){window.SaltoGame?.confirmSharedEvent(m.event);if(m.event.reward===0)reward(10,m.event.id+':coins');}}return;}
    if(m.type==='game-event-rejected'){window.SaltoGame?.rejectSharedEvent(m.event||m.eventId);return;}
    if(m.type==='level'){window.SaltoGame?.applyLevel(m.level);return;}
    if(m.type==='signal')handleSignal(m);
    if(m.type==='chat')addChat(m.username,m.text);
    if(m.type==='target-score'){state.targets.other=m.score||0;setMessage('targetScore',`Tú: ${state.targets.score} · compañero: ${state.targets.other} · munición: ${window.SaltoGame?.getState().bullets||0}`);}
    if(m.type==='error')setMessage('onlineStatus',m.error);
  }
  function ensureStarted(){if(window.SaltoGame?.getState().level===0)window.SaltoGame.start();}
  function startSync(){clearInterval(syncTimer);syncTimer=setInterval(()=>{if(!state.active)return;const p=window.SaltoGame?.getState();if(p)send({type:'state',state:p});},90);}
  function gameEvent(event){if(!state.active)return false;send({type:'game-event',event});return true;}
  function levelChanged(level){send({type:'level',level});}
  function goalReached(level){send({type:'goal',level});setMessage('onlineStatus','El anfitrión debe llegar a la meta para pasar de nivel.');}
  function requestRevive(){if(!state.active)return false;send({type:'revive-request'});return true;}
  async function reward(amount,id){if(!id)return;try{if(state.token){const d=await api('/reward',{rewardId:String(id).replace(/[^\w:-]/g,'_'),amount});state.profile=d.profile;renderProfile();}else{const p=localProfile();p.coins=(p.coins||0)+amount;saveLocal(p);}}catch(e){console.warn('No se guardó la recompensa:',e.message);}}
  function startRun(){lastMatchScore=0;}
  async function matchProgress(data){if(!state.token)return;const current=Math.max(0,Number(data.score)||0),delta=Math.max(0,current-lastMatchScore);lastMatchScore=current;try{const d=await api('/match',{...data,score:delta,coins:0,room:state.room});state.profile=d.profile;renderProfile();}catch(e){console.warn(e.message);}}
  function addChat(username,text){const row=document.createElement('div');row.textContent=(username||'Compañero')+': '+text;$('chatMessages').appendChild(row);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;}
  function createRoom(){if(!tokenNeeded()){pendingRoomAction='create';return;}sendWhenOpen({type:'create-room'});}
  function joinRoom(code){const room=String(code||'').trim().toUpperCase();if(!room)return setMessage('onlineStatus','Escribe el código de invitación.');$('roomCode').value=room;if(!tokenNeeded()){pendingRoomAction='join';return;}sendWhenOpen({type:'join',code:room});}

  async function ensurePeer(){if(state.peer)return state.peer;const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});state.peer=pc;pc.onicecandidate=e=>{if(e.candidate)send({type:'signal',signalType:'candidate',data:e.candidate});};pc.ontrack=e=>{state.remoteStream=e.streams[0];$('remoteVideo').srcObject=state.remoteStream;$('callVideos').hidden=false;};pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState))setMessage('onlineStatus','La llamada se desconectó.');};if(state.stream)state.stream.getTracks().forEach(t=>pc.addTrack(t,state.stream));return pc;}
  async function ensureOffer(){if(!state.stream)return;try{const pc=await ensurePeer();const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({type:'signal',signalType:'offer',data:offer});}catch(e){setMessage('onlineStatus','No se pudo iniciar la señal de llamada: '+e.message);}}
  async function handleSignal(m){try{const pc=await ensurePeer();if(m.signalType==='offer'){await pc.setRemoteDescription(m.data);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);send({type:'signal',signalType:'answer',data:answer});}else if(m.signalType==='answer'){await pc.setRemoteDescription(m.data);}else if(m.signalType==='candidate'&&m.data)await pc.addIceCandidate(m.data);}catch(e){console.warn('Señal WebRTC:',e.message);}}
  async function call(kind){if(!tokenNeeded()||!state.active)return setMessage('onlineStatus','Crea o únete a una sala antes de iniciar la llamada.');try{if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;closeCall();return;}state.stream=await navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'});$('localVideo').srcObject=state.stream;$('callVideos').hidden=false;if(state.peer)state.stream.getTracks().forEach(t=>state.peer.addTrack(t,state.stream));await ensureOffer();setMessage('onlineStatus',kind==='video'?'Videollamada conectándose…':'Llamada de voz conectándose…');}catch(e){setMessage('onlineStatus','No se pudo acceder al micrófono o cámara: '+e.message);}}
  function closeCall(){if(state.peer){state.peer.close();state.peer=null;}if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}state.remoteStream=null;$('callVideos').hidden=true;}

  async function loadCatalog(){try{catalog=(await api('/catalog',null,'GET')).items;renderShop();}catch(e){console.warn(e.message);}}
  function renderShop(){
    const items=$('shopItems');if(!items)return;const p=state.profile||localProfile();
    setMessage('shopBalance','Saldo: '+(p.coins||0)+' monedas · Las compras de cuenta se guardan en el servidor.');items.innerHTML='';
    for(const [id,item] of Object.entries(catalog)){
      const card=document.createElement('div');card.className='shop-card';const title=document.createElement('b');title.textContent=item.name;
      const info=document.createElement('span');info.textContent=item.category+' · '+item.price+' monedas'+(item.type==='life'?' · guardadas: '+(p.inventory?.lives||0):'');
      const button=document.createElement('button');button.className='btn btn-ghost';const owned=p.inventory?.owned?.includes(id),equippable=['avatar','accessory','background'].includes(item.type),equipped=p[item.type]===id;
      button.textContent=item.type==='life'?'Comprar':owned?(equipped?'Equipado':'Equipar'):'Comprar';button.disabled=!!(owned&&(!equippable||equipped));
      button.onclick=async()=>{if(!tokenNeeded())return;try{const d=owned?await api('/cosmetics',{itemId:id}):await api('/purchase',{itemId:id});state.profile=d.profile;renderProfile();renderShop();}catch(e){setMessage('shopBalance',e.message);}};
      card.append(title,info,button);items.appendChild(card);
    }
  }

  function targetRules(){const mode=$('targetDifficulty').value;return mode==='easy'?{seconds:40,threshold:5,team:8,move:1000,size:'2.5rem'}:mode==='hard'?{seconds:25,threshold:10,team:16,move:380,size:'1.7rem'}:{seconds:30,threshold:7,team:12,move:650,size:'2.1rem'};}
  function startTargets(){if(state.targets.running)return;state.targets.running=true;state.targets.score=0;const rules=targetRules();state.targets.seconds=rules.seconds;$('targetArena').querySelector('.moving-target').style.fontSize=rules.size;const update=()=>setMessage('targetScore',`Tú: ${state.targets.score} · compañero: ${state.targets.other} · ${state.targets.seconds}s · balas: ${window.SaltoGame?.getState().bullets||0}`);update();clearInterval(targetTimer);targetTimer=setInterval(()=>{state.targets.seconds--;if(state.targets.seconds<=0){clearInterval(targetTimer);state.targets.running=false;clearTimeout(targetMove);setMessage('targetScore',`Fin · Tú: ${state.targets.score} · compañero: ${state.targets.other}`);if(state.targets.score>=rules.threshold)reward(5,'targets:'+Date.now());else if(state.targets.score+state.targets.other>=rules.team)reward(8,'targets-team:'+Date.now());return;}update();},1000);moveTarget();}
  function moveTarget(){const target=$('targetArena').querySelector('.moving-target');if(!state.targets.running)return;target.style.left=(5+Math.random()*85)+'%';target.style.top=(5+Math.random()*70)+'%';targetMove=setTimeout(moveTarget,targetRules().move);}
  $('targetArena').addEventListener('click',e=>{if(!e.target.closest('.moving-target')||!state.targets.running)return;const g=window.SaltoGame?.getState();if(!g||g.bullets<=0){setMessage('targetScore','Necesitas balas. Encuentra una fruta o un cofre.');return;}window.SaltoGame.shoot();state.targets.score++;send({type:'target-score',score:state.targets.score});setMessage('targetScore',`Tú: ${state.targets.score} · compañero: ${state.targets.other} · ${state.targets.seconds}s`);});
  $('btnTargetStart').addEventListener('click',startTargets);

  $('btnAccount').addEventListener('click',()=>{show('screen-account');if(state.profile)renderProfile();});$('btnShop').addEventListener('click',()=>{show('screen-shop');renderShop();});$('btnOnline').addEventListener('click',()=>show('screen-online'));$('btnTargets').addEventListener('click',()=>show('screen-targets'));
  $('btnLogin').addEventListener('click',()=>authenticate('login'));$('btnRegister').addEventListener('click',()=>authenticate('register'));$('btnLogout').addEventListener('click',()=>{state.socket?.close();closeCall();state.token='';state.user=null;state.profile=null;state.active=false;localStorage.removeItem(TOKEN_KEY);$('authForms').hidden=false;$('profileDetails').hidden=true;$('avatarPicker').hidden=true;$('btnLogout').hidden=true;setMessage('accountStatus','Sesión cerrada.');});
  $('btnCreateRoom').addEventListener('click',createRoom);$('btnJoinRoom').addEventListener('click',()=>joinRoom($('roomCode').value));$('btnCopyInvite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('inviteLink').value);setMessage('onlineStatus','Enlace copiado. Envíalo a tu compañero.');}catch{ $('inviteLink').select();document.execCommand('copy');setMessage('onlineStatus','Enlace copiado.');}});
  $('btnVoice').addEventListener('click',()=>call('audio'));$('btnVideo').addEventListener('click',()=>call('video'));$('chatForm').addEventListener('submit',e=>{e.preventDefault();const text=$('chatInput').value.trim();if(text){send({type:'chat',text});addChat(state.user?.username||'Tú',text);$('chatInput').value='';}});
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>show(null)));

  window.SaltoOnline={get active(){return state.active;},get host(){return state.host;},get remotePlayer(){return state.remotePlayer;},get profile(){return state.profile;},gameEvent,levelChanged,goalReached,reward,matchProgress,requestRevive,startRun};
  loadCatalog().then(()=>refreshProfile());
  const room=new URLSearchParams(location.search).get('room');if(room){$('roomCode').value=room;show('screen-online');if(state.token)connectSocket();}
})();
