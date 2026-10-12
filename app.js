const $=id=>document.getElementById(id);
const METERS=['1/4','2/4','3/4','4/4','5/4','6/4','3/8','5/8','6/8','7/8','9/8','12/8'];
const BACKGROUNDS={current:{name:'現在の色',color:'#eef0f3'},blue:{name:'ブルー',color:'#eaf3fa'},mint:{name:'ミント',color:'#eaf5ef'},pink:{name:'ピンク',color:'#faeef1'},beige:{name:'ベージュ',color:'#f6f0e5'},gray:{name:'グレー',color:'#e7ebef'}};
const TIMBRES={classic:{name:'クラシック',type:'triangle',frequency:1200,accent:1800,peak:.65,duration:.04},wood:{name:'ウッド',type:'sine',frequency:850,accent:1100,peak:.8,duration:.06,decay:.45},digital:{name:'デジタル',type:'square',frequency:1600,accent:2100,peak:.25,duration:.03},soft:{name:'ソフト',type:'sine',frequency:600,accent:780,peak:.5,duration:.085}};
const defaults={bpm:105,meter:'4/4',accent:true,volume:70,mute:false,background:'current',timbre:'classic'};
let s={...defaults};try{Object.assign(s,JSON.parse(localStorage.getItem('blue-tempo-v1'))||{})}catch{}
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));s.bpm=clamp(Math.round(Number(s.bpm)||105),30,300);if(!METERS.includes(s.meter))s.meter='4/4';s.volume=clamp(Number(s.volume)||0,0,100);s.accent=!!s.accent;s.mute=!!s.mute;if(!Object.hasOwn(BACKGROUNDS,s.background))s.background='current';if(!Object.hasOwn(TIMBRES,s.timbre))s.timbre='classic';
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
function render(){ syncBackground();syncWeight();$('bpm').textContent=s.bpm;$('meter').textContent=s.meter;$('meter').setAttribute('aria-label','拍子を選択 現在 '+s.meter);for(const button of $('meter-grid').children)button.setAttribute('aria-pressed',button.dataset.meter===s.meter); for(const button of $('timbre-options').children)button.setAttribute('aria-pressed',button.dataset.timbre===s.timbre);$('accent').checked=s.accent;$('accent-state').textContent=s.accent?'ON':'OFF';$('volume').value=s.volume;$('mute').textContent=s.mute?'音 OFF':'音 ON';$('mute').setAttribute('aria-pressed',s.mute);$('mark').textContent=s.bpm<60?'Largo':s.bpm<76?'Adagio':s.bpm<108?'Andante':s.bpm<120?'Moderato':s.bpm<168?'Allegro':'Presto';if(master)master.gain.setValueAtTime(s.mute?0:s.volume/100,ctx.currentTime);save()}
function bpm(n){if(Number.isFinite(n)){s.bpm=clamp(Math.round(n),30,300);render()}}
async function ensureAudio(){
 const Audio=window.AudioContext||window.webkitAudioContext;
 if(!Audio)throw Error('このブラウザでは音声を利用できません');
 ctx ||= new Audio();
 if(!master){master=ctx.createGain();master.connect(ctx.destination)}
 await ctx.resume();
 if(ctx.state!=='running')throw Error('音声を開始できません。もう一度お試しください');
 master.gain.setValueAtTime(s.mute?0:s.volume/100,ctx.currentTime);
 ctx.onstatechange=()=>{if(running&&ctx.state!=='running')stop('音声が中断されました。STARTで再開')};
}
function sound(t,strong,preview=false,timbre=s.timbre){
 const tone=TIMBRES[timbre],frequency=strong?tone.accent:tone.frequency;
 const o=ctx.createOscillator(),g=ctx.createGain();o.type=tone.type;
 o.frequency.setValueAtTime(frequency,t);
 if(tone.decay)o.frequency.exponentialRampToValueAtTime(frequency*tone.decay,t+tone.duration);
 const peak=tone.peak*(preview?s.volume/100:1),attack=timbre==='soft'?.006:.001;
 g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+attack);
 g.gain.exponentialRampToValueAtTime(.001,t+tone.duration);
 o.connect(g);g.connect(preview?ctx.destination:master);o.start(t);o.stop(t+tone.duration+.005);
 voices.add(o);o.onended=()=>{voices.delete(o);o.disconnect();g.disconnect()};
}
function schedule(){
 if(!running)return;
 if(next<ctx.currentTime-.05){stop('再生が中断されました。STARTで再開');return}
 while(next<ctx.currentTime+.1){
  const beat=tick%parseInt(s.meter),duration=60/s.bpm;
  sound(next,s.accent&&beat===0);queue.push({time:next,beat,serial:tick,duration});
  next+=duration;tick++;
 }
}
function animate(){if(!running)return;const t=ctx.currentTime-(ctx.outputLatency||0);while(queue.length&&queue[0].time<=t){lastBeat=queue.shift();[...$('beats').children].forEach((d,i)=>d.classList.toggle('active',i===lastBeat.beat))}if(drag){$('arm').style.transform='rotate(0deg)'}else if(lastBeat){const progress=clamp((t-lastBeat.time)/lastBeat.duration,0,1);const angle=swingAngle*Math.cos(progress*Math.PI)*(lastBeat.serial%2?-1:1);$('arm').style.transform=`rotate(${angle}deg)`}frame=requestAnimationFrame(animate)}
async function start(){if(running||starting)return;starting=true;$('start').disabled=true;try{await ensureAudio();if(document.hidden)return;render();running=true;tick=0;queue=[];lastBeat=null;next=ctx.currentTime+.06;$('start').textContent='STOP';$('start').classList.add('playing');$('status').textContent='';schedule();timer=setInterval(schedule,25);animate();if(navigator.wakeLock)navigator.wakeLock.request('screen').then(w=>{if(running)wake=w;else w.release()}).catch(()=>{});ctx.onstatechange=()=>{if(running&&ctx.state!=='running')stop('音声が中断されました。STARTで再開')}}catch(e){$('status').textContent=e.message}finally{starting=false;$('start').disabled=false}}
function stop(message=''){running=false;clearInterval(timer);cancelAnimationFrame(frame);for(const o of voices){try{o.stop()}catch{}}voices.clear();queue=[];lastBeat=null;$('start').textContent='START';$('start').classList.remove('playing');$('arm').style.transform='rotate(0deg)';[...$('beats').children].forEach(d=>d.classList.remove('active'));$('status').textContent=message;if(wake){wake.release().catch(()=>{});wake=null}}
$('start').onclick=()=>running?stop():start();
for(const [id,delta] of [['minus',-1],['plus',1]]){
 let delay,repeat;
 const end=()=>{clearTimeout(delay);clearInterval(repeat)};
 const begin=()=>{end();bpm(s.bpm+delta);delay=setTimeout(()=>{repeat=setInterval(()=>bpm(s.bpm+delta),75)},400)};
 $(id).onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();$(id).setPointerCapture(e.pointerId);begin()};
 $(id).onpointerup=end;$(id).onpointercancel=end;$(id).onlostpointercapture=end;
 $(id).onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat)begin()}};
 $(id).onkeyup=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();end()}};
 $(id).onblur=end;window.addEventListener('blur',end);
 $(id).onclick=e=>{if(e.detail===0)bpm(s.bpm+delta)};
}
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
// All panels use native dialogs for focus trapping, Escape and background isolation.
let modalOverflow=null;
function releaseModalScroll(){
 if(!document.querySelector('dialog[open]')&&modalOverflow!==null){document.body.style.overflow=modalOverflow;modalOverflow=null}
}
function wireDialog(dialog,trigger,closeButton){
 dialog.addEventListener('close',()=>{
  releaseModalScroll();
  // Do not steal focus from a new input started after close() but before this event.
  if(document.activeElement===document.body||dialog.contains(document.activeElement))trigger.focus();
 });
 closeButton.onclick=()=>{dialog.close();releaseModalScroll()};
 dialog.addEventListener('click',e=>{
  if(e.target!==dialog)return;
  const r=dialog.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();
 });
 return ()=>{finishDrag();if(modalOverflow===null)modalOverflow=document.body.style.overflow;dialog.showModal();document.body.style.overflow='hidden'};
}
const openMeter=wireDialog(meterDialog,$('meter'),$('meter-close'));
$('meter').onclick=()=>{openMeter();[...$('meter-grid').children].find(b=>b.dataset.meter===s.meter)?.focus()};
const openSettings=wireDialog($('settings-dialog'),$('settings-open'),$('settings-close'));
$('settings-open').onclick=()=>{openSettings();document.querySelector('.settings-tabs [aria-selected="true"]').focus()};
const tabs=[$('sound-tab'),$('background-tab')];
function selectTab(tab){
 for(const item of tabs){
  const selected=item===tab;item.setAttribute('aria-selected',selected);item.tabIndex=0;
  $(item.getAttribute('aria-controls')).hidden=!selected;
 }
}
for(const tab of tabs){
 tab.onclick=()=>selectTab(tab);
 tab.onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const target=e.key==='Home'?tabs[0]:e.key==='End'?tabs[1]:tabs[1-tabs.indexOf(tab)];
  selectTab(target);target.focus();
 };
}
function syncBackground(){
 const color=BACKGROUNDS[s.background].color;
 document.documentElement.style.setProperty('--page-background',color);
 document.querySelector('meta[name="theme-color"]').content=color;
 for(const button of $('background-options').children)button.setAttribute('aria-pressed',button.dataset.background===s.background);
}
for(const [key,option] of Object.entries(BACKGROUNDS)){
 const button=document.createElement('button');button.type='button';button.dataset.background=key;
 const swatch=document.createElement('span');swatch.className='color-swatch';swatch.style.backgroundColor=option.color;swatch.setAttribute('aria-hidden','true');
 button.append(swatch,document.createTextNode(option.name));button.setAttribute('aria-pressed',key===s.background);
 button.onclick=()=>{s.background=key;render()};$('background-options').append(button);
}
for(const [key,tone] of Object.entries(TIMBRES)){
 const button=document.createElement('button');button.type='button';button.dataset.timbre=key;
 button.textContent=tone.name;button.setAttribute('aria-pressed',key===s.timbre);
 button.onclick=async()=>{
  s.timbre=key;render();
  // Audition is one short click, using the current volume and respecting mute.
  if(s.mute||s.volume===0)return;
  try{await ensureAudio();if(!s.mute&&s.volume>0)sound(ctx.currentTime+.01,false,true,key)}catch(e){$('status').textContent=e.message}
 };
 $('timbre-options').append(button);
}
const openBpm=wireDialog($('bpm-dialog'),$('tap'),$('bpm-close'));
let bpmDraft='',replaceDraft=true;
function syncDraft(){
 $('bpm-entry').textContent=bpmDraft||'—';
 $('bpm-confirm').disabled=!/^\d+$/.test(bpmDraft)||Number(bpmDraft)<30||Number(bpmDraft)>300;
}
function digit(value){
 if(replaceDraft){bpmDraft='';replaceDraft=false}
 if(bpmDraft.length<3)bpmDraft+=value;
 syncDraft();
}
function deleteDigit(){replaceDraft=false;bpmDraft=bpmDraft.slice(0,-1);syncDraft()}
function confirmBpm(){
 if($('bpm-confirm').disabled)return;
 bpm(Number(bpmDraft));$('bpm-dialog').close();releaseModalScroll();
}
$('tap').onclick=()=>{
 bpmDraft=String(s.bpm);replaceDraft=true;syncDraft();openBpm();
 // Buttons/output only: opening TAP never focuses an editable element.
 $('bpm-close').focus();
};
for(const button of document.querySelectorAll('[data-digit]'))button.onclick=()=>digit(button.dataset.digit);
$('bpm-clear').onclick=()=>{bpmDraft='';replaceDraft=false;syncDraft()};
$('bpm-delete').onclick=deleteDigit;
$('bpm-confirm').onclick=confirmBpm;
$('bpm-cancel').onclick=()=>{$('bpm-dialog').close();releaseModalScroll()};
$('bpm-dialog').addEventListener('keydown',e=>{
 if(!$('bpm-dialog').open)return;
 if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
 if(/^\d$/.test(e.key)){e.preventDefault();digit(e.key)}
 else if(e.key==='Backspace'||e.key==='Delete'){e.preventDefault();deleteDigit()}
 else if(e.key==='Enter'){e.preventDefault();confirmBpm()}
 // Escape is handled by the native dialog; Tab/Space retain native button behavior.
});
$('accent').onchange=()=>{s.accent=$('accent').checked;dots();render()};$('volume').oninput=()=>{s.volume=+$('volume').value;render()};$('mute').onclick=()=>{s.mute=!s.mute;render()};document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop('画面を離れたため停止しました。STARTで再開')});window.addEventListener('pagehide',()=>stop());render();dots();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

// Native touch events avoid dependence on Safari's pointer capture / button values.
// Both input paths share the same measured range and BPM conversion.
const weight=$('weight');
function beginDrag(kind,id,y){
 if(drag)return false;
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
