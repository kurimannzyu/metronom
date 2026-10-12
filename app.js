const $=id=>document.getElementById(id);
const METERS=['1/4','2/4','3/4','4/4','5/4','6/4','3/8','5/8','6/8','7/8','9/8','12/8'];
const defaults={bpm:105,meter:'4/4',division:1,accent:true,volume:70,mute:false};
let s={...defaults};try{Object.assign(s,JSON.parse(localStorage.getItem('blue-tempo-v1'))||{})}catch{}
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));s.bpm=clamp(Math.round(Number(s.bpm)||105),30,300);if(!METERS.includes(s.meter))s.meter='4/4';if(![1,2,3,4].includes(+s.division))s.division=1;s.division=+s.division;s.volume=clamp(Number(s.volume)||0,0,100);s.accent=!!s.accent;s.mute=!!s.mute;
let ctx,master,running=false,starting=false,timer,next=0,tick=0,queue=[],lastBeat=null,frame,voices=new Set(),wake;
let drag=null;
// Keep the full handle inside the arm at either BPM limit.
function weightTravel(){return Math.max(0,$('arm').offsetHeight-$('weight').offsetHeight)}
function weightPosition(){return $('weight').offsetHeight/2+(s.bpm-30)/270*weightTravel()}
let swingAngle=26;
function syncSwing(){
 // Reserve room for the entire handle at the widest point of the swing.
 const reach=$('arm').offsetHeight+$('weight').offsetHeight/2;
 const room=document.querySelector('.pendulum').clientWidth/2-$('weight').offsetWidth/2-8;
 swingAngle=Math.min(26,Math.asin(clamp(room/Math.max(1,reach),0,1))*180/Math.PI);
}
function syncWeight(){const w=$('weight');w.style.top=weightPosition()+'px';w.setAttribute('aria-valuenow',s.bpm);w.setAttribute('aria-valuetext',s.bpm+' BPM')}
function save(){try{localStorage.setItem('blue-tempo-v1',JSON.stringify(s))}catch{}}
function dots(){ $('beats').replaceChildren(...Array.from({length:parseInt(s.meter)},(_,i)=>{let d=document.createElement('i');if(i===0&&s.accent)d.className='first';return d}))}
function render(){ syncWeight();$('bpm').value=s.bpm;$('meter').textContent=s.meter;$('meter').setAttribute('aria-label','拍子を選択 現在 '+s.meter);for(const button of $('meter-grid').children)button.setAttribute('aria-pressed',button.dataset.meter===s.meter); $('division').value=s.division;$('accent').checked=s.accent;$('accent-state').textContent=s.accent?'ON':'OFF';$('volume').value=s.volume;$('mute').textContent=s.mute?'音 OFF':'音 ON';$('mute').setAttribute('aria-pressed',s.mute);$('mark').textContent=s.bpm<60?'Largo':s.bpm<76?'Adagio':s.bpm<108?'Andante':s.bpm<120?'Moderato':s.bpm<168?'Allegro':'Presto';if(master)master.gain.setValueAtTime(s.mute?0:s.volume/100,ctx.currentTime);save()}
function bpm(n){if(Number.isFinite(n)){s.bpm=clamp(Math.round(n),30,300);render()}}
function sound(t,strong,sub){let o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=sub?900:strong?1800:1200;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(sub?.22:.65,t+.001);g.gain.exponentialRampToValueAtTime(.001,t+.035);o.connect(g);g.connect(master);o.start(t);o.stop(t+.04);voices.add(o);o.onended=()=>{voices.delete(o);o.disconnect();g.disconnect()}}
function schedule(){if(!running)return;if(next<ctx.currentTime-.05){stop('再生が中断されました。STARTで再開');return}while(next<ctx.currentTime+.1){const count=parseInt(s.meter),sub=tick%s.division,beat=Math.floor(tick/s.division)%count;const dur=60/s.bpm/s.division;sound(next,s.accent&&beat===0&&sub===0,sub!==0);if(sub===0)queue.push({time:next,beat,serial:Math.floor(tick/s.division),duration:60/s.bpm});next+=dur;tick++}}
function animate(){if(!running)return;const t=ctx.currentTime-(ctx.outputLatency||0);while(queue.length&&queue[0].time<=t){lastBeat=queue.shift();[...$('beats').children].forEach((d,i)=>d.classList.toggle('active',i===lastBeat.beat))}if(drag){$('arm').style.transform='rotate(0deg)'}else if(lastBeat){const progress=clamp((t-lastBeat.time)/lastBeat.duration,0,1);const angle=swingAngle*Math.cos(progress*Math.PI)*(lastBeat.serial%2?-1:1);$('arm').style.transform=`rotate(${angle}deg)`}frame=requestAnimationFrame(animate)}
async function start(){if(running||starting)return;starting=true;$('start').disabled=true;try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('このブラウザでは音声を利用できません');ctx ||= new Audio();master ||= ctx.createGain();master.disconnect();master.connect(ctx.destination);await ctx.resume();if(ctx.state!=='running')throw Error('音声を開始できません。もう一度STARTを押してください');if(document.hidden)return;render();running=true;tick=0;queue=[];lastBeat=null;next=ctx.currentTime+.06;$('start').textContent='STOP';$('start').classList.add('playing');$('status').textContent='';schedule();timer=setInterval(schedule,25);animate();if(navigator.wakeLock)navigator.wakeLock.request('screen').then(w=>{if(running)wake=w;else w.release()}).catch(()=>{});ctx.onstatechange=()=>{if(running&&ctx.state!=='running')stop('音声が中断されました。STARTで再開')}}catch(e){$('status').textContent=e.message}finally{starting=false;$('start').disabled=false}}
function stop(message=''){running=false;clearInterval(timer);cancelAnimationFrame(frame);for(const o of voices){try{o.stop()}catch{}}voices.clear();queue=[];lastBeat=null;$('start').textContent='START';$('start').classList.remove('playing');$('arm').style.transform='rotate(0deg)';[...$('beats').children].forEach(d=>d.classList.remove('active'));$('status').textContent=message;if(wake){wake.release().catch(()=>{});wake=null}}
$('start').onclick=()=>running?stop():start();$('bpm').onfocus=()=>$('bpm').select();$('bpm').onblur=()=>bpm(Number($('bpm').value)||s.bpm);$('bpm').onkeydown=e=>{if(e.key==='Enter')$('bpm').blur()};
for(const [id,delta] of [['minus',-1],['plus',1]]){let delay,repeat;const end=()=>{clearTimeout(delay);clearInterval(repeat)};$(id).onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();$(id).setPointerCapture(e.pointerId);bpm(s.bpm+delta);delay=setTimeout(()=>{repeat=setInterval(()=>bpm(s.bpm+delta),75)},400)};$(id).onpointerup=end;$(id).onpointercancel=end;$(id).onlostpointercapture=end;$(id).onclick=e=>{if(e.detail===0)bpm(s.bpm+delta)}}
// The native modal traps focus and supports Escape; selection returns focus to the trigger.
const meterDialog=$('meter-dialog');
for(const meter of METERS){
 const button=document.createElement('button');button.type='button';button.dataset.meter=meter;
 button.setAttribute('aria-label',meter);button.setAttribute('aria-pressed',meter===s.meter);
 const [top,bottom]=meter.split('/');button.innerHTML=`<span>${top}</span><span>${bottom}</span>`;
 button.onclick=()=>{
  s.meter=meter;if(running)stop('拍子を変更しました。STARTで再開');dots();render();meterDialog.close();
 };
 $('meter-grid').append(button);
}
$('meter').onclick=()=>{meterDialog.showModal();document.body.style.overflow='hidden';[...$('meter-grid').children].find(b=>b.dataset.meter===s.meter)?.focus()};
$('meter-close').onclick=()=>meterDialog.close();
meterDialog.addEventListener('click',e=>{if(e.target!==meterDialog)return;const r=meterDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)meterDialog.close()});
meterDialog.addEventListener('close',()=>{document.body.style.overflow='';$('meter').focus()});
$('division').onchange=()=>{s.division=+$('division').value;if(running)stop('分割を変更しました。STARTで再開');render()};$('accent').onchange=()=>{s.accent=$('accent').checked;dots();render()};$('volume').oninput=()=>{s.volume=+$('volume').value;render()};$('mute').onclick=()=>{s.mute=!s.mute;render()};document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop('画面を離れたため停止しました。STARTで再開')});window.addEventListener('pagehide',()=>stop());render();dots();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

// Native touch events avoid dependence on Safari's pointer capture / button values.
// Both input paths share the same measured range and BPM conversion.
const weight=$('weight');
function beginDrag(kind,id,y){
 if(drag)return false;
 if(document.activeElement===$('bpm'))$('bpm').blur();
 const travel=weightTravel();
 if(travel<=0)return false;
 drag={kind,id,y,bpm:s.bpm,travel};
 $('arm').style.transform='rotate(0deg)';
 weight.classList.add('dragging');
 return true;
}
function moveDrag(y){
 bpm(drag.bpm+(y-drag.y)/drag.travel*270);
}
function finishDrag(){
 if(!drag)return;
 const previous=drag;drag=null;
 weight.classList.remove('dragging');
 if(previous.kind==='pointer'){
  try{if(weight.hasPointerCapture(previous.id))weight.releasePointerCapture(previous.id)}catch{}
 }
 if(!running)$('arm').style.transform='rotate(0deg)';
}
weight.addEventListener('pointerdown',e=>{
 if(e.pointerType==='touch'||e.button!==0)return;
 if(!beginDrag('pointer',e.pointerId,e.clientY))return;
 e.preventDefault();
 // Document listeners keep dragging functional if capture is unavailable or rejected.
 try{weight.setPointerCapture(e.pointerId)}catch{}
});
document.addEventListener('pointermove',e=>{
 if(drag?.kind!=='pointer'||e.pointerId!==drag.id)return;
 e.preventDefault();moveDrag(e.clientY);
},{passive:false});
for(const event of ['pointerup','pointercancel'])document.addEventListener(event,e=>{
 if(drag?.kind==='pointer'&&e.pointerId===drag.id)finishDrag();
});
weight.addEventListener('lostpointercapture',e=>{
 if(drag?.kind==='pointer'&&e.pointerId===drag.id)finishDrag();
});
weight.addEventListener('touchstart',e=>{
 if(drag){e.preventDefault();return}
 const touch=e.changedTouches[0];
 if(touch&&beginDrag('touch',touch.identifier,touch.clientY))e.preventDefault();
},{passive:false});
document.addEventListener('touchmove',e=>{
 if(drag?.kind!=='touch')return;
 // Prevent scrolling only while this handle owns a touch gesture.
 e.preventDefault();
 const touch=Array.from(e.changedTouches).find(t=>t.identifier===drag.id);
 if(touch)moveDrag(touch.clientY);
},{passive:false});
for(const event of ['touchend','touchcancel'])document.addEventListener(event,e=>{
 if(drag?.kind!=='touch')return;
 if(Array.from(e.changedTouches).some(t=>t.identifier===drag.id)){
  e.preventDefault();finishDrag();
 }
},{passive:false});
window.addEventListener('blur',finishDrag);
window.addEventListener('pagehide',finishDrag);
document.addEventListener('visibilitychange',()=>{if(document.hidden)finishDrag()});
weight.addEventListener('keydown',e=>{
 const delta={ArrowDown:1,ArrowUp:-1,ArrowRight:1,ArrowLeft:-1,PageDown:10,PageUp:-10}[e.key];
 if(delta!==undefined||e.key==='Home'||e.key==='End'){
  e.preventDefault();bpm(e.key==='Home'?30:e.key==='End'?300:s.bpm+delta);
 }
});
function syncGeometry(){
 if(drag&&Math.abs(weightTravel()-drag.travel)>1)finishDrag();
 syncWeight();syncSwing();
}
new ResizeObserver(syncGeometry).observe(document.querySelector('.pendulum'));
window.addEventListener('resize',syncGeometry);
syncGeometry();
