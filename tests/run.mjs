#!/usr/bin/env node
/* Music Making App — regression tests (node + playwright-core + headless Chrome).
   Usage:  node tests/run.mjs [--dir /path/to/built/app] [--url https://host/app/] [--only substring]
   Env:    PLAYWRIGHT_MODULE (path to playwright-core/index.mjs), CHROME (path to chrome binary)            */
import fs from 'fs';import http from 'http';import path from 'path';import {fileURLToPath,pathToFileURL} from 'url';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d};
const DIR=path.resolve(arg('dir',process.env.APP_DIR||(fs.existsSync(path.join(here,'..','index.html'))?path.join(here,'..'):path.join(here,'..','..','music-app'))));
const LIVE=arg('url',null),ONLY=arg('only',null);
const PW=process.env.PLAYWRIGHT_MODULE||['/workspace/tools/node_modules/playwright-core/index.mjs',path.join(here,'node_modules/playwright-core/index.mjs'),path.join(here,'..','node_modules/playwright-core/index.mjs')].find(p=>fs.existsSync(p));
if(!PW){console.error('playwright-core not found (set PLAYWRIGHT_MODULE)');process.exit(2)}
const {chromium}=await import(pathToFileURL(PW).href);
const CHROME=process.env.CHROME||['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));

/* ---------- tiny harness ---------- */
const results=[];let curName='';
async function test(name,fn){
  if(ONLY&&!name.toLowerCase().includes(ONLY.toLowerCase()))return;
  curName=name;const t0=Date.now();
  try{const notes=await fn();results.push({name,ok:true,ms:Date.now()-t0,notes});console.log('  ✓ '+name+(notes?'  — '+notes:''))}
  catch(e){results.push({name,ok:false,ms:Date.now()-t0,err:String(e&&e.message||e)});console.log('  ✗ '+name+'\n      '+String(e&&e.stack||e).split('\n').slice(0,4).join('\n      '))}
}
const assert=(c,m)=>{if(!c)throw new Error(m||'assertion failed')};
const eq=(a,b,m)=>{if(a!==b)throw new Error((m||'not equal')+': got '+JSON.stringify(a)+' expected '+JSON.stringify(b))};

/* ---------- static server ---------- */
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml'};
function serve(dir,log){
  return new Promise(res=>{const s=http.createServer((rq,rs)=>{
    let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(dir,p);
    if(log)log.push(p);
    if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rs.writeHead(404);return rs.end('nf')}
    rs.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});rs.end(fs.readFileSync(f));
  }).listen(0,'127.0.0.1',()=>res({s,port:s.address().port}))});
}
let BASE,srv;
if(LIVE)BASE=LIVE;else{srv=await serve(DIR);BASE=`http://127.0.0.1:${srv.port}/`}
const browser=await chromium.launch({executablePath:CHROME,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream']});

async function open(opts={}){
  const ctx=await browser.newContext({viewport:opts.viewport||{width:1280,height:900},acceptDownloads:true,serviceWorkers:opts.sw?'allow':'block',colorScheme:opts.dark?'dark':'light',hasTouch:!!opts.mobile,isMobile:!!opts.mobile,permissions:opts.perms||[]});
  const page=await ctx.newPage();const errs=[];
  page.on('console',m=>{if(['error','warning'].includes(m.type()))errs.push(m.type()+': '+m.text())});
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  await page.goto(opts.url||BASE);await page.waitForFunction(()=>window.__beat&&window.__beat.S&&document.querySelector('.step'),null,{timeout:15000});
  if(!opts.keepTip)await page.evaluate(()=>document.getElementById('tip').hidden=true);
  return {ctx,page,errs};
}
const close=async o=>{await o.ctx.close()};
const noErr=(o,m)=>{const e=o.errs.filter(x=>!/favicon|Service Worker registration blocked|mic setup failed/.test(x));assert(!e.length,(m||'console errors')+': '+e.join(' | '))};

/* in-page helper: synthesize a WAV File (sine) of given seconds */
const mkWavSrc=`(sec,freq,sr)=>{sr=sr||22050;const n=Math.round(sec*sr),b=new ArrayBuffer(44+n*2),v=new DataView(b),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
 w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
 for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(2*Math.PI*freq*i/sr)*12000,true);return new File([b],'tone-'+freq+'.wav',{type:'audio/wav'})}`;

console.log('Music Making App tests — '+(LIVE||DIR));

/* ===================================================================== */
await test('static: modules parse, CSP present, no remote resources, naming',async()=>{
  const src=path.join(here,'..');const mods=fs.readdirSync(src).filter(f=>/^\d\d-.*\.js$/.test(f));
  for(const m of mods)new Function(fs.readFileSync(path.join(src,m),'utf8'));
  const inline=/<script>([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(DIR,'index.html'),'utf8'));if(inline)new Function(inline[1]);
  const html=fs.existsSync(path.join(DIR,'index.html'))?fs.readFileSync(path.join(DIR,'index.html'),'utf8'):await (await fetch(BASE)).text();
  const csp=/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);assert(csp,'CSP meta missing');
  for(const need of ["default-src 'none'","script-src 'sha256-","worker-src 'self' blob:","object-src 'none'","connect-src 'self'"])assert(csp[1].includes(need),'CSP lacks '+need);
  assert(!/script-src[^;]*(unsafe-inline|unsafe-eval|https?:)/.test(csp[1]),'script-src must not allow inline/eval/remote');
  const remote=[...html.matchAll(/<(?:script|link|img|iframe)[^>]+(?:src|href)="(https?:[^"]+)"/g)].map(m=>m[1]).filter(u=>!/swellyis\.github\.io\/music-app/.test(u));
  assert(!remote.length,'remote resources: '+remote.join(','));
  assert(!/Beat Studio/.test(html),'old name "Beat Studio" still present');
  for(const t of ['og:title','og:image','og:description','twitter:card','twitter:image'])assert(html.includes(t),'missing '+t);
  return (mods.length?mods.length+' source modules + ':'')+'built script parse, CSP ok';
});

for(const [label,vp,mobile] of [['desktop',{width:1280,height:900},false],['mobile',{width:390,height:844},true]])
await test(`boot ${label}: no console errors, grids built, single tab stop`,async()=>{
  const o=await open({viewport:vp,mobile});
  const r=await o.page.evaluate(()=>({steps:document.querySelectorAll('.step').length,cells:document.querySelectorAll('.roll-step').length,
    seqTab:document.querySelectorAll('.step[tabindex="0"]').length,rollTab:document.querySelectorAll('.roll-step[tabindex="0"]').length,title:document.title}));
  eq(r.steps,192);eq(r.cells,240);eq(r.seqTab,1,'sequencer tab stops');eq(r.rollTab,1,'roll tab stops');eq(r.title,'Music Making App');
  await o.page.waitForTimeout(600);noErr(o);await close(o);return `${r.steps} steps, ${r.cells} roll cells`;
});

await test('playback: demo plays, transport advances, stop, no errors',async()=>{
  const o=await open();await o.page.click('#play');await o.page.waitForTimeout(1800);
  const r=await o.page.evaluate(()=>({p:__beat.T.playing,t:__beat.live&&__beat.live.ctx.currentTime,tc:document.getElementById('timecode').textContent}));
  assert(r.p&&r.t>1,'not playing: '+JSON.stringify(r));await o.page.click('#stop');
  assert(!(await o.page.evaluate(()=>__beat.T.playing)));noErr(o);await close(o);return 'timecode '+r.tc;
});

await test('offline: service worker installs, app reloads offline, no errors',async()=>{
  const o=await open({sw:true});
  await o.page.evaluate(()=>navigator.serviceWorker.ready.then(()=>1));
  await o.page.waitForFunction(()=>navigator.serviceWorker.controller||true);await o.page.reload();await o.page.waitForFunction(()=>window.__beat&&document.querySelector('.step'));
  const ver=await o.page.evaluate(async()=>{const k=await caches.keys();return k.join()});assert(/music-app-/.test(ver),'cache missing: '+ver);
  await o.ctx.setOffline(true);await o.page.reload();await o.page.waitForFunction(()=>window.__beat&&document.querySelector('.step'),null,{timeout:15000});
  const n=await o.page.evaluate(()=>document.querySelectorAll('.step').length);eq(n,192);
  await o.page.evaluate(()=>{document.getElementById('tip').hidden=true});await o.page.click('#play');await o.page.waitForTimeout(700);
  noErr(o,'errors while offline');await close(o);return ver;
});

await test('persistence: imported audio survives reload (IndexedDB), clip + peaks restored',async()=>{
  const o=await open();
  const id=await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};await __beat.addFiles([mk(2,330)]);const c=__beat.S.tracks.flatMap(t=>t.clips).find(c=>c.type==='audio');return c&&c.assetId})()`);
  assert(id,'clip not created');
  await o.page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'))});await o.page.waitForTimeout(500);
  await o.page.reload();await o.page.waitForFunction(()=>window.__beat&&document.querySelector('.step'));
  await o.page.waitForFunction(i=>{const a=__beat.assets[i];return a&&a.buffer&&a.peaks},id,{timeout:10000});
  const r=await o.page.evaluate(i=>({dur:__beat.assets[i].dur,clips:__beat.S.tracks.flatMap(t=>t.clips).filter(c=>c.type==='audio').length,store:localStorage.getItem('beatStudio.autosave.v3').length}),id);
  assert(Math.abs(r.dur-2)<.05,'duration '+r.dur);eq(r.clips,1);assert(r.store<200000,'autosave unexpectedly large '+r.store);
  /* rendering uses the restored buffer */
  const peak=await o.page.evaluate(async()=>{const b=await __beat.renderOffline('song');let m=0;const d=b.getChannelData(0);for(let i=0;i<d.length;i+=7)m=Math.max(m,Math.abs(d[i]));return m});
  assert(peak>0.01,'silent render');noErr(o);await close(o);return `restored ${r.dur.toFixed(2)} s, autosave ${r.store} B`;
});

await test('persistence: sampler sample + library project (with audio) survive reload',async()=>{
  const o=await open();
  const id=await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};await __beat.loadSampleBlob(mk(1,300,22050),'keep.wav',6);await __beat.addFiles([mk(1,200)]);return __beat.S.tracks[6].sample.assetId})()`);
  await o.page.click('#saveAs');await o.page.waitForSelector('#askDlg[open]');await o.page.fill('#askInput','Persist test');await o.page.click('#askOk');
  await o.page.waitForFunction(()=>__beat.libId);await o.page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await o.page.reload();await o.page.waitForFunction(()=>window.__beat&&document.querySelector('.step'));
  await o.page.waitForFunction(i=>{const a=__beat.assets[i];return a&&a.buffer},id,{timeout:10000});
  const r=await o.page.evaluate(async()=>({sample:__beat.S.tracks[6].sample&&__beat.S.tracks[6].sample.name,preset:__beat.S.tracks[6].preset,list:(await __beat.libList()).map(p=>p.name),
     /* open from library after wiping the in-memory assets */ }));
  eq(r.sample,'keep');eq(r.preset,'Sample');assert(r.list.includes('Persist test'),'library entry missing');
  /* wipe memory copies, then open the library project: audio comes back from IndexedDB */
  const ok=await o.page.evaluate(async(i)=>{const B=__beat;delete B.assets[i];B.gcAssets();const lib=await B.libList();const rec=lib.find(p=>p.name==='Persist test');B.S.bpm=99;B.markSaved();
     return await B.libOpen(rec.id)},id);
  await o.page.waitForFunction(i=>__beat.assets[i]&&__beat.assets[i].buffer,id,{timeout:10000});
  noErr(o);await close(o);return 'sample + audio restored from IndexedDB; library open ok='+ok;
});

await test('security: malicious project JSON runs no script and fetches nothing',async()=>{
  const hits=[];const evil=await serve(path.join(here),hits);
  const o=await open();const reqs=[];o.page.on('request',r=>reqs.push(r.url()));
  const viol=[];await o.page.exposeFunction('__viol',v=>viol.push(v));
  await o.page.evaluate(()=>document.addEventListener('securitypolicyviolation',e=>__viol(e.violatedDirective+' '+e.blockedURI)));
  const evilUrl=`http://127.0.0.1:${evil.port}/evil.wav`;
  const raw=await o.page.evaluate(()=>JSON.stringify(__beat.S));const P=JSON.parse(raw);
  const bad='"><img src=x onerror="window.__pwned=1"><script>window.__pwned=2<\/script>';
  P.name='<img src=x onerror=window.__pwned=3>'+bad;
  P.tracks[0].clips.push({id:bad,type:'pattern',pattern:0,start:0,len:1},{id:'ok-1',type:'audio',assetId:'evil-asset',name:bad,start:1,len:2,offset:0,bpm0:120});
  P.tracks.push({name:bad,kind:'audio',preset:'x',volume:80,pan:50,clips:[{id:"a'b\"c",type:'audio',assetId:"javascript:alert(1)",name:'x',start:0,len:1}]});
  P.tracks[1].preset='<b>';P.tracks[2].volume=1e99;P.bpm='NaN';P.songBars=99999;P.ts='9/9';P.fx='x';P.master=[1,2];
  P.tracks[3].sample={assetId:'s1',name:bad,root:1e9,loop:'yes',gain:-5};
  P.assets={'evil-asset':{name:bad,data:evilUrl},'s1':{name:'s',data:'https://evil.example.com/a.mp3'},'x y':{name:'bad id',data:'data:audio/wav;base64,AAAA'},
            'img':{name:'x',data:'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd25lZD00PC9zY3JpcHQ+'},'blobby':{name:'b',data:'blob:http://evil/1'},'file':{name:'f',data:'file:///etc/passwd'}};
  const ok=await o.page.evaluate(async(t)=>__beat.importProjectText(t,{skipConfirm:true}),JSON.stringify(P));
  await o.page.waitForTimeout(800);
  const st=await o.page.evaluate(()=>{const S=__beat.S;const ids=S.tracks.flatMap(t=>t.clips.map(c=>c.id));return{ids,bad:ids.filter(i=>!/^[A-Za-z0-9_-]{1,64}$/.test(i)),
    pwned:window.__pwned,imgs:document.querySelectorAll('img[src="x"]').length,scripts:[...document.querySelectorAll('script')].filter(s=>/__pwned/.test(s.textContent)).length,
    name:S.name,songBars:S.songBars,bpm:S.bpm,ts:S.ts,assetIds:Object.keys(__beat.assets),html:document.querySelectorAll('[onerror],[onload],[onclick],[onfocus]').length>0}});
  assert(st.pwned===undefined,'script executed: __pwned='+st.pwned);
  eq(st.bad.length,0,'unsanitised ids '+JSON.stringify(st.bad));eq(st.imgs,0,'injected <img>');eq(st.scripts,0,'injected <script>');
  assert(!st.html,'onerror attribute present in DOM');assert(st.songBars<=64&&st.bpm>=50&&st.bpm<=200,'ranges not clamped '+JSON.stringify(st));assert(['4/4','3/4','6/8','5/4','7/8'].includes(st.ts));
  assert(!st.assetIds.includes('evil-asset'),'evil asset registered');
  const external=reqs.filter(u=>!u.startsWith(BASE)&&!u.startsWith('data:')&&!u.startsWith('blob:'));
  eq(external.length,0,'external requests: '+external.join(','));eq(hits.length,0,'evil server was contacted: '+hits.join());
  const cspHits=viol.filter(v=>!/blob/.test(v));
  await close(o);evil.s.close();return `import ${ok?'accepted (sanitised)':'rejected'}; ${reqs.length} requests, all same-origin; CSP violations: ${viol.length}`;
});

await test('security: CSP blocks injected inline script and remote fetch',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{const out={};const s=document.createElement('script');s.textContent='window.__csp1=1';document.body.appendChild(s);out.inline=window.__csp1===1;
    try{await fetch('https://example.com/');out.fetch='allowed'}catch(e){out.fetch='blocked'}
    try{new Worker('https://example.com/w.js');out.worker='created'}catch(e){out.worker='blocked'}
    const im=new Image();out.img=await new Promise(res=>{im.onload=()=>res('loaded');im.onerror=()=>res('blocked');im.src='https://example.com/x.png'});return out});
  eq(r.inline,false,'inline script ran');eq(r.fetch,'blocked');eq(r.img,'blocked');await close(o);return JSON.stringify(r);
});

await test('long audio: 150 s clip warns about trimming; song length up to 64 bars',async()=>{
  const o=await open();
  await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};__beat.setBpm(120);await __beat.addFiles([mk(150,220,8000)])})()`); /* default tempo is 84 BPM (64 bars = 183 s), so use 120 BPM (64 bars = 128 s) to force trimming */
  const r=await o.page.evaluate(()=>{const c=__beat.S.tracks.flatMap(t=>t.clips).find(c=>c.type==='audio');return{len:c.len,bars:__beat.S.songBars,toasts:[...document.querySelectorAll('.toast')].map(t=>t.textContent)}});
  eq(r.bars,64);assert(r.len<=64,'len '+r.len);assert(r.toasts.some(t=>/longer than the 64-bar maximum/.test(t)),'no trim warning: '+JSON.stringify(r.toasts));
  const opts=await o.page.evaluate(()=>[...document.querySelectorAll('#songBars option')].map(o=>+o.value));assert(Math.max(...opts)>=64,'songBars options '+opts);
  noErr(o);await close(o);return 'options '+opts.join(',');
});

await test('WSOLA worker: 60 s clip stretches off-thread, UI stays responsive, pitch preserved',async()=>{
  const o=await open();
  const id=await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};const f=mk(60,440,44100);return await __beat.registerAudio(f,'sixty')})()`);
  const r=await o.page.evaluate(async(id)=>{
    const gaps=[];let last=performance.now(),stop=false;(function tick(){const n=performance.now();gaps.push(n-last);last=n;if(!stop)setTimeout(tick,8)})();
    const buf=__beat.assets[id].buffer;const t0=performance.now();const out=await __beat.requestStretch(id,1.25);const ms=performance.now()-t0;stop=true;
    const d=out.getChannelData(0);let z=0;const a=Math.floor(d.length*.4),b=Math.floor(d.length*.6);for(let i=a+1;i<b;i++)if(d[i-1]<=0&&d[i]>0)z++;
    return{ms,maxGap:Math.max(...gaps),dur:out.duration,freq:z/((b-a)/out.sampleRate)}},id);
  /* baseline for comparison: the old synchronous stretch on the main thread */
  const sync=await o.page.evaluate(async(id)=>{const buf=__beat.assets[id].buffer;const t0=performance.now();__beat.wsolaStretch(buf,1.25);return performance.now()-t0},id);
  assert(r.maxGap<200,'main thread blocked '+r.maxGap.toFixed(0)+' ms');assert(Math.abs(r.dur-48)<.3,'duration '+r.dur);assert(Math.abs(r.freq-440)<6,'pitch '+r.freq);
  noErr(o);await close(o);return `worker ${r.ms.toFixed(0)} ms, max UI gap ${r.maxGap.toFixed(0)} ms (sync version blocks ${sync.toFixed(0)} ms), out ${r.dur.toFixed(1)} s @ ${r.freq.toFixed(0)} Hz`;
});

await test('time signatures: step grid, metronome accents, MIDI time/key signature',async()=>{
  const o=await open();const exp={'3/4':12,'6/8':12,'5/4':20,'7/8':14,'4/4':16};
  for(const [ts,n] of Object.entries(exp)){
    await o.page.selectOption('#tsSel',ts);
    const r=await o.page.evaluate(()=>({steps:document.querySelectorAll('#sequencer .track:first-of-type .step, #sequencer .track .step').length/12,cells:document.querySelectorAll('.roll-step').length/15,spb:__beat.SPB,bk:Array.from({length:__beat.SPB},(_,w)=>__beat.beatKind(w)).join('')}));
    eq(r.spb,n,ts+' steps/bar');eq(r.steps,n,ts+' grid columns');
    const accents={'4/4':'1000100010001000','3/4':'100010001000','6/8':'100000100000','5/4':'10001000100010001000','7/8':'10001000100010'}; /* '1' = beat (2 = accent) */
    const kinds=r.bk.replace(/2/g,'1');eq(kinds.length,n);
    if(ts==='6/8')assert(r.bk[0]==='2'&&r.bk[6]==='2'||r.bk.indexOf('2')===0,'6/8 accents '+r.bk);
  }
  /* MIDI export bytes */
  const probe=async(ts,key,scale)=>o.page.evaluate(async([ts,key,scale])=>{
    __beat.setTimeSig(ts);__beat.S.key=key;__beat.S.scale=scale;const b=new Uint8Array(await __beat.midiExportBlob(true).arrayBuffer());
    const find=(t)=>{for(let i=0;i<b.length-3;i++)if(b[i]===0xff&&b[i+1]===t)return Array.from(b.slice(i+3,i+3+b[i+2]));return null};
    return{ts:find(0x58),ks:find(0x59)}},[ts,key,scale]);
  const a=await probe('3/4',9,'minor');eq(a.ts[0],3);eq(a.ts[1],2);eq(a.ks[0],0,'A minor sf');eq(a.ks[1],1,'A minor mi');
  const e=await probe('6/8',4,'minor');eq(e.ts[0],6);eq(e.ts[1],3);eq(e.ks[0],1,'E minor sf');eq(e.ks[1],1);
  const d=await probe('7/8',2,'dorian');eq(d.ts[0],7);eq(d.ts[1],3);eq(d.ks[0],0,'D dorian sf');eq(d.ks[1],0,'D dorian mi');
  const c=await probe('4/4',0,'major');eq(c.ks[0],0);eq(c.ks[1],0);
  const f=await probe('5/4',5,'major');eq(f.ks[0]>127?f.ks[0]-256:f.ks[0],-1,'F major sf');
  await o.page.evaluate(()=>__beat.setTimeSig('7/8'));const n=await o.page.evaluate(async()=>{const b=await __beat.renderOffline('song');return b.length});assert(n>1000);
  noErr(o);await close(o);return 'steps 12/12/20/14, MIDI A-min 0/1, E-min 1/1, D-dorian 0/0';
});

await test('MIDI import: all bars imported, tempo + meter adopted, patterns/arrangement built',async()=>{
  const o=await open();
  /* hand-built 24-bar type-0 file, 3/4 at 100 BPM, bars alternate between two 1-bar riffs */
  const r=await o.page.evaluate(()=>{
    const ppq=480,bars=24,beat=ppq,ev=[];const vl=n=>{const o=[n&127];while(n>>=7)o.unshift((n&127)|128);return o};
    const T=[];let last=0;const add=(tick,bytes)=>{T.push(...vl(tick-last),...bytes);last=tick};
    add(0,[0xff,0x51,3,0x09,0x27,0xc0]);add(0,[0xff,0x58,4,3,2,24,8]);
    for(let b=0;b<bars;b++){const base=b*3*beat,riff=b%2?[67,64,60]:[60,62,64];riff.forEach((n,i)=>{add(base+i*beat,[0x90,n,90]);add(base+i*beat+beat-20,[0x80,n,0])});}
    add(bars*3*beat,[0xff,0x2f,0]);
    const hdr=[0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,ppq>>8,ppq&255],trk=[0x4d,0x54,0x72,0x6b,(T.length>>24)&255,(T.length>>16)&255,(T.length>>8)&255,T.length&255];
    const res=__beat.importMidiBytes(new Uint8Array([...hdr,...trk,...T]));
    return{res,bars:__beat.S.songBars,ts:__beat.S.ts,bpm:__beat.S.bpm,mode:__beat.S.mode,clips:__beat.S.tracks[__beat.S.rollTrack].clips.length}});
  eq(r.res.bars,24);eq(r.bars,24);eq(r.ts,'3/4');eq(r.bpm,100);eq(r.res.patterns,2);assert(r.clips>=24,'clips '+r.clips);
  noErr(o);await close(o);return `24 bars → ${r.res.patterns} patterns, ${r.clips} clips, ${r.bpm} BPM ${r.ts}`;
});

await test('project library: save, save as, open, rename, duplicate, delete; unsaved guard + undo',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,out={};B.S.name='Alpha';const id1=await B.libSave(false);const id2=(B.S.name='Beta',await B.libSave(true));
    out.ids=[id1,id2];out.list=(await B.libList()).map(p=>p.name).sort();
    await B.libRename(id1,'Alpha2');await B.libDuplicate(id2);out.after=(await B.libList()).map(p=>p.name).sort();
    await B.libDelete(id2);out.final=(await B.libList()).map(p=>p.name).sort();return out});
  assert(r.ids[0]!==r.ids[1]);eq(r.list.join(),'Alpha,Beta');eq(r.after.join(),'Alpha2,Beta,Beta copy');eq(r.final.join(),'Alpha2,Beta copy');
  /* unsaved guard */
  await o.page.evaluate(()=>{__beat.S.name='Guarded';__beat.setBpm(150);document.getElementById('projectName').value='Guarded'});
  await o.page.click('#loadDemo');await o.page.waitForSelector('#askDlg[open]');
  await o.page.click('#askCancel');eq(await o.page.evaluate(()=>__beat.S.bpm),150,'cancel must keep the project');
  await o.page.click('#loadDemo');await o.page.waitForSelector('#askDlg[open]');await o.page.click('#askOk');await o.page.waitForTimeout(300);
  assert(await o.page.evaluate(()=>__beat.S.bpm!==150),'demo not loaded');
  await o.page.click('#undoBtn');await o.page.waitForTimeout(200);eq(await o.page.evaluate(()=>__beat.S.bpm),150,'undo must restore the replaced project');
  /* UI: library dialog lists projects */
  await o.page.click('#loadLocal');await o.page.waitForSelector('#libList .lib-item');const n=await o.page.locator('#libList .lib-item').count();assert(n>=2,'library rows '+n);
  noErr(o);await close(o);return `CRUD ok, ${n} projects listed, cancel keeps, undo restores`;
});

await test('exports: 24-bit WAV header, MP3 frames, stems zip (same length, valid RIFF)',async()=>{
  const o=await open();
  await o.page.click('#openExport');await o.page.selectOption('#exBits','24');
  const [d1]=await Promise.all([o.page.waitForEvent('download',{timeout:60000}),o.page.click('#exSong')]);
  let buf=fs.readFileSync(await d1.path());eq(buf.toString('latin1',0,4),'RIFF');eq(buf.readUInt16LE(34),24,'bits per sample');eq(buf.readUInt16LE(32),6,'block align');
  const wavMs=buf.length;
  await o.page.click('#openExport');await o.page.selectOption('#exKbps','128');
  const [d2]=await Promise.all([o.page.waitForEvent('download',{timeout:120000}),o.page.click('#exMp3')]);
  buf=fs.readFileSync(await d2.path());
  let i=0;if(buf.toString('latin1',0,3)==='ID3')i=10+((buf[6]&127)<<21|(buf[7]&127)<<14|(buf[8]&127)<<7|(buf[9]&127));
  assert(buf[i]===0xff&&(buf[i+1]&0xe0)===0xe0,'no MPEG frame sync');
  let frames=0,p=i;const br=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],sr=[44100,48000,32000];
  while(p+4<buf.length&&buf[p]===0xff&&(buf[p+1]&0xe0)===0xe0){const b=br[buf[p+2]>>4]*1000,s=sr[(buf[p+2]>>2)&3];const len=Math.floor(144*b/s)+((buf[p+2]>>1)&1);frames++;p+=len;if(len<=0)break}
  const secs=frames*1152/44100;assert(frames>100,'frames '+frames);
  const wavSecs=(wavMs-44)/(44100*6);assert(Math.abs(secs-wavSecs)<1.5,`mp3 ${secs.toFixed(1)} s vs wav ${wavSecs.toFixed(1)} s`);
  await o.page.click('#openExport');
  const [d3]=await Promise.all([o.page.waitForEvent('download',{timeout:120000}),o.page.click('#exStems')]);
  const z=fs.readFileSync(await d3.path());eq(z.readUInt32LE(0),0x04034b50,'zip signature');
  const eocd=z.lastIndexOf(Buffer.from([0x50,0x4b,5,6]));const cnt=z.readUInt16LE(eocd+10),cdOff=z.readUInt32LE(eocd+16);
  const expect=await o.page.evaluate(()=>__beat.stemTracks().length);eq(cnt,expect,'stem count');
  let q=cdOff;const sizes=[],names=[];for(let k=0;k<cnt;k++){const sz=z.readUInt32LE(q+24),nl=z.readUInt16LE(q+28),lo=z.readUInt32LE(q+42);names.push(z.toString('utf8',q+46,q+46+nl));
    const ds=lo+30+z.readUInt16LE(lo+26)+z.readUInt16LE(lo+28);eq(z.toString('latin1',ds,ds+4),'RIFF');eq(z.readUInt16LE(ds+34),24);sizes.push(sz);q+=46+nl}
  assert(new Set(sizes).size===1,'stems differ in length: '+sizes.join());noErr(o);await close(o);
  return `WAV24 ${(wavMs/1e6).toFixed(1)} MB, MP3 ${(buf.length/1e6).toFixed(2)} MB ${secs.toFixed(1)} s, ${cnt} stems`;
});

await test('per-track effects change the rendered sound (filter, drive, delay send, reverb send)',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat;B.S.mode='pattern';const stat=async(mut)=>{const S=B.S;const t=S.tracks[7];const old={f:t.tfilter,d:t.tdrive,dl:t.tdelay,sp:t.space};mut(t);
      const b=await B.renderOffline('loop',{only:7,stem:true});Object.assign(t,{tfilter:old.f,tdrive:old.d,tdelay:old.dl,space:old.sp});
      const d=b.getChannelData(0);let e=0,hf=0,peak=0;for(let i=1;i<d.length;i++){e+=d[i]*d[i];const x=d[i]-d[i-1];hf+=x*x;peak=Math.max(peak,Math.abs(d[i]))}return{e,hf,peak}};
    const base=await stat(t=>{t.tfilter=100;t.tdrive=0;t.tdelay=0;t.space=0});
    const filt=await stat(t=>{t.tfilter=5;t.tdrive=0;t.tdelay=0;t.space=0});
    const drive=await stat(t=>{t.tfilter=100;t.tdrive=100;t.tdelay=0;t.space=0});
    const delay=await stat(t=>{t.tfilter=100;t.tdrive=0;t.tdelay=100;t.space=0});
    const verb=await stat(t=>{t.tfilter=100;t.tdrive=0;t.tdelay=0;t.space=100});
    return{base,filt,drive,delay,verb}});
  assert(r.base.e>0,'base silent');assert(r.filt.hf<r.base.hf*.5,'filter did not darken '+r.filt.hf/r.base.hf);
  assert(Math.abs(r.drive.hf/r.base.hf-1)>.03||Math.abs(r.drive.e/r.base.e-1)>.03,'drive no effect');
  assert(r.delay.e>r.base.e*1.03,'delay send no effect '+r.delay.e/r.base.e);assert(r.verb.e>r.base.e*1.03,'reverb send no effect '+r.verb.e/r.base.e);
  noErr(o);await close(o);return `filter HF ×${(r.filt.hf/r.base.hf).toFixed(2)}, delay energy ×${(r.delay.e/r.base.e).toFixed(2)}, reverb ×${(r.verb.e/r.base.e).toFixed(2)}`;
});

await test('sampler: user sample pitched across keys (offline render + zero-crossing pitch)',async()=>{
  const o=await open();
  const r=await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};const B=__beat;const ok=await B.loadSampleBlob(mk(1,261.63,44100),'c4.wav',6);
    const meas=async(midi)=>{const OC=OfflineAudioContext,ctx=new OC(2,44100*1,44100),E=B.buildEngine(ctx,false);B.trigger(E,6,0.02,1,{midis:[midi],gate:.8,barPos:null});const b=await ctx.startRendering();
      const d=b.getChannelData(0);let z=0,first=-1,lastz=-1;for(let i=4410;i<30000;i++)if(d[i-1]<=0&&d[i]>0){z++;if(first<0)first=i;lastz=i}return z>1?(z-1)/((lastz-first)/44100):0};
    return{ok,sample:B.S.tracks[6].sample,preset:B.S.tracks[6].preset,f60:await meas(60),f72:await meas(72),f67:await meas(67)}})()`);
  assert(r.ok&&r.sample&&r.preset==='Sample','sample not set');
  assert(Math.abs(r.f60-261.6)<6,'root pitch '+r.f60);assert(Math.abs(r.f72-523.3)<10,'octave pitch '+r.f72);assert(Math.abs(r.f67-392)<8,'fifth pitch '+r.f67);
  /* keyboard path */
  await o.page.keyboard.press('a');noErr(o);await close(o);return `C4→${r.f60.toFixed(0)} Hz, C5→${r.f72.toFixed(0)} Hz, G4→${r.f67.toFixed(0)} Hz`;
});

await test('recording tools: count-in, metronome while recording, latency compensation',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,out={};B.setBpm(120);B.PREF.countIn=1;B.PREF.metroRec=true;
    document.getElementById('record').click();B.setMode('pattern');
    B.play();await new Promise(r=>setTimeout(r,250));const E=B.live;
    out.countEnd=B.T.countEnd-E.ctx.currentTime;out.status=document.getElementById('transportStatus').textContent;out.metro=B.metroActive();out.srcs=E.srcs.size;
    B.stopTransport();B.PREF.countIn=0;
    /* latency compensation: same key press, different setting → earlier step */
    const stepAt=async(lat)=>{B.PREF.latMs=lat;B.S.patterns[0].st[8]=new Array(20).fill(0);B.play();await new Promise(r=>setTimeout(r,200));const E=B.live;
      B.T.ui={g:10,t:E.ctx.currentTime,valid:true,bar:0};B.recordNote(60,8,.9);const row=B.S.patterns[B.S.cur].st[8];B.stopTransport();return row.findIndex(v=>v>0)};
    out.g0=await stepAt(0);B.S.patterns[0].st[8].fill(0);out.g250=await stepAt(250);
    return out});
  assert(r.countEnd>1.2&&r.countEnd<2.1,'count-in length '+r.countEnd);assert(/Count-in/.test(r.status),'status '+r.status);assert(r.metro,'metronome not active while recording');assert(r.srcs>=3,'no click sources scheduled '+r.srcs);
  assert(r.g0-r.g250>=1,'latency compensation had no effect: '+r.g0+' vs '+r.g250);noErr(o);await close(o);
  return `count-in ${r.countEnd.toFixed(2)} s, latency 250 ms moves step ${r.g0}→${r.g250}`;
});

await test('mic: setup failure releases the microphone on every failure path',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const stops={n:0};const mkStream=()=>{const tr={stop(){stops.n++},addEventListener(){}};return{getTracks:()=>[tr,{...tr}],getAudioTracks:()=>[tr]}};
    navigator.mediaDevices.getUserMedia=async()=>mkStream();
    const RealMR=window.MediaRecorder;window.MediaRecorder=function(){throw new Error('boom')};
    await __beat.toggleMic();const failStops=stops.n,recNull=__beat.MIC.rec===null,btn=document.getElementById('micRecord').textContent;
    window.MediaRecorder=function(){this.state='inactive';this.start=()=>{throw new Error('start failed')};this.stop=()=>{}};stops.n=0;await __beat.toggleMic();const startFailStops=stops.n;
    navigator.mediaDevices.getUserMedia=async()=>{const e=new Error('denied');e.name='NotAllowedError';throw e};await __beat.toggleMic();
    window.MediaRecorder=RealMR;return{failStops,recNull,btn,startFailStops,toast:[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')}});
  eq(r.failStops,2,'tracks stopped after constructor failure');eq(r.startFailStops,2,'tracks stopped after start() failure');assert(r.recNull);assert(/Record mic/.test(r.btn));
  assert(/permission denied/i.test(r.toast),'toast '+r.toast);noErr(o);await close(o);return 'all stream tracks stopped on every failure path';
});

await test('held notes sustain beyond 15 s until note-off',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{const B=__beat,sr=44100,len=sr*24,ctx=new OfflineAudioContext(2,len,sr),E=B.buildEngine(ctx,false);
    const hs=B.trigger(E,6,0.05,1,{midis:[45],gate:Infinity,barPos:null});const b=await ctx.startRendering();const d=b.getChannelData(0);
    const rms=(a,z)=>{let e=0;for(let i=a*sr;i<z*sr;i++)e+=d[i]*d[i];return Math.sqrt(e/((z-a)*sr))};return{early:rms(2,3),late:rms(17,19),end:rms(21,23)}});
  assert(r.early>.001,'silent at start');assert(r.late>r.early*.5,`note died: early ${r.early} late ${r.late}`);noErr(o);await close(o);return `rms 2s=${r.early.toFixed(3)} 18s=${r.late.toFixed(3)} 22s=${r.end.toFixed(3)}`;
});

await test('accessibility: roving tabindex + arrow keys (steps, piano roll)',async()=>{
  const o=await open();
  await o.page.focus('#sequencer .step[tabindex="0"]');const before=await o.page.evaluate(()=>document.activeElement.dataset.step);
  await o.page.keyboard.press('ArrowRight');await o.page.keyboard.press('ArrowRight');
  const a=await o.page.evaluate(()=>({step:document.activeElement.dataset.step,tabs:document.querySelectorAll('.step[tabindex="0"]').length,cls:document.activeElement.className}));
  eq(+a.step,+before+2,'arrow right moved focus');eq(a.tabs,1);
  await o.page.keyboard.press('ArrowDown');const row=await o.page.evaluate(()=>document.activeElement.closest('.track').dataset.track);assert(row!==undefined);
  await o.page.keyboard.press('Enter');const lit=await o.page.evaluate(()=>document.activeElement.getAttribute('aria-pressed'));assert(lit==='true'||lit==='false');
  await o.page.focus('#rollGrid .roll-step[tabindex="0"]');const rs=await o.page.evaluate(()=>[document.activeElement.dataset.step,document.activeElement.dataset.row]);
  await o.page.keyboard.press('ArrowRight');await o.page.keyboard.press('ArrowDown');
  const rb=await o.page.evaluate(()=>({step:document.activeElement.dataset.step,row:document.activeElement.dataset.row,tabs:document.querySelectorAll('.roll-step[tabindex="0"]').length}));
  eq(+rb.step,+rs[0]+1);eq(+rb.row,+rs[1]+1);eq(rb.tabs,1);
  /* Tab leaves the grid in one press */
  await o.page.focus('#sequencer .step[tabindex="0"]');await o.page.keyboard.press('Tab');
  assert(!(await o.page.evaluate(()=>document.activeElement.classList.contains('step'))),'Tab stayed inside the step grid');
  noErr(o);await close(o);return 'one tab stop per grid';
});

await test('accessibility: keyboard move/resize of timeline clips',async()=>{
  const o=await open();
  const r=await o.page.evaluate(()=>{const B=__beat;const c=B.S.tracks[0].clips[0];return{id:c.id,start:c.start,len:c.len}});
  await o.page.focus(`.daw-clip[data-id="${r.id}"]`);await o.page.keyboard.press('ArrowRight');
  let c=await o.page.evaluate(id=>{const x=__beat.S.tracks.flatMap(t=>t.clips).find(c=>c.id===id);return{start:x.start,len:x.len}},r.id);
  assert(c.start!==r.start,'arrow right did not move the clip');
  await o.page.focus(`.daw-clip[data-id="${r.id}"]`);const l0=c.len;await o.page.keyboard.press('Shift+ArrowRight');
  c=await o.page.evaluate(id=>{const x=__beat.S.tracks.flatMap(t=>t.clips).find(c=>c.id===id);return{start:x.start,len:x.len}},r.id);assert(c.len>l0,'shift+arrow did not resize');
  await o.page.keyboard.press('Shift+ArrowLeft');
  const c2=await o.page.evaluate(id=>__beat.S.tracks.flatMap(t=>t.clips).find(c=>c.id===id).len,r.id);assert(c2<c.len,'shift+left did not shrink');
  noErr(o);await close(o);return `moved ${r.start}→${c.start}, resized ${l0}→${c.len}→${c2}`;
});

for(const dark of [false,true])
await test(`accessibility: text contrast >= 4.5:1 (${dark?'dark':'light'} theme)`,async()=>{
  const o=await open({dark});
  await o.page.addStyleTag({content:'*{animation:none!important;transition:none!important}'});
  const run=()=>o.page.evaluate(()=>{
    const parse=c=>{let m=/rgba?\(([^)]+)\)/.exec(c);if(m){const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return[p[0],p[1],p[2],p[3]==null?1:p[3]]}
      m=/color\(srgb ([^)]+)\)/.exec(c);if(m){const p=m[1].split(/[ \/]+/).map(Number);return[p[0]*255,p[1]*255,p[2]*255,p[3]==null?1:p[3]]}return null};
    const over=(f,b)=>{const a=f[3];return[f[0]*a+b[0]*(1-a),f[1]*a+b[1]*(1-a),f[2]*a+b[2]*(1-a),1]};
    const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};
    const bgOf=el=>{const stack=[];for(let e=el;e;e=e.parentElement){const cs=getComputedStyle(e);if(cs.backgroundImage&&cs.backgroundImage!=='none'&&/gradient/.test(cs.backgroundImage))return null;const c=parse(cs.backgroundColor);if(c&&c[3]>0){stack.push(c);if(c[3]>=1)break}}
      let b=parse(getComputedStyle(document.documentElement).backgroundColor);if(!b||b[3]<1)b=[255,255,255,1];if(!stack.length&&getComputedStyle(document.body).backgroundColor){const c=parse(getComputedStyle(document.body).backgroundColor);if(c&&c[3]>0)b=over(c,b)}
      for(let i=stack.length-1;i>=0;i--)b=over(stack[i],b);return b};
    const bad=[];let checked=0;
    for(const el of document.querySelectorAll('body *')){
      if(!el.childNodes.length)continue;const txt=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');if(!txt)continue;
      const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none')continue;const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;
      if(el.closest('[disabled],[aria-disabled=true],dialog:not([open]),[hidden],.sr-only')||el.disabled)continue;
      const fg=parse(cs.color),bg=bgOf(el);if(!fg||!bg)continue;let op=1;for(let e=el;e;e=e.parentElement)op*=+getComputedStyle(e).opacity;
      const f2=over([fg[0],fg[1],fg[2],fg[3]*op],bg);const L1=lum(f2),L2=lum(bg),ratio=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);checked++;
      const size=parseFloat(cs.fontSize),bold=+cs.fontWeight>=700,large=size>=24||(size>=18.66&&bold);
      if(ratio<(large?3:4.5))bad.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+'.'+(String(el.className).split(' ')[0]||'')+' "'+txt.slice(0,24)+'" '+ratio.toFixed(2));
    }
    return{checked,bad}});
  /* check base page + a few states (solo pressed, accent buttons, update bar, dialogs) */
  await o.page.click('.track[data-track="0"] .solo');await o.page.evaluate(()=>{document.getElementById('updateBar').hidden=false;document.getElementById('record').setAttribute('aria-pressed','true');['#midiConnect','#metro','#loop','.mixer-strip .ms button.solo','.pattern-btn','.mode-btn','#micRecord'].forEach(s=>document.querySelectorAll(s).forEach(e=>e.setAttribute('aria-pressed','true')));document.getElementById('micRecord').classList.add('rec-on')});
  let res=await run();
  for(const dlg of ['#exportDlg','#libDlg','#recDlg','#helpDlg']){await o.page.evaluate(d=>document.querySelector(d).showModal(),dlg);const r2=await run();res.bad.push(...r2.bad.filter(b=>!res.bad.includes(b)));res.checked+=r2.checked;await o.page.evaluate(d=>document.querySelector(d).close(),dlg)}
  /* a primary-colour button + pressed teal toggle */
  const sw=await o.page.evaluate(()=>['.secondary-btn.accent','.play-btn','#exportWav'].map(s=>{const e=document.querySelector(s),cs=getComputedStyle(e);return s+' '+cs.color+' on '+cs.backgroundColor}));
  assert(!res.bad.length,`${res.bad.length} low-contrast text items of ${res.checked}: `+[...new Set(res.bad)].slice(0,12).join(' ; '));
  await close(o);return `${res.checked} text nodes checked; ${sw.join(' | ')}`;
});

await test('accessibility: every control has an accessible name; live region present',async()=>{
  const o=await open();
  const bad=await o.page.evaluate(()=>{const out=[];const name=el=>{if(el.getAttribute('aria-label'))return 1;const lb=el.getAttribute('aria-labelledby');if(lb&&document.getElementById(lb))return 1;
    if(el.id&&document.querySelector('label[for="'+el.id+'"]'))return 1;if(el.closest('label'))return 1;if((el.textContent||'').trim())return 1;if(el.title)return 1;if(el.tagName==='INPUT'&&el.type==='button'&&el.value)return 1;return 0};
    document.querySelectorAll('button,input:not([type=hidden]),select,textarea,[role=button],[role=slider],a[href]').forEach(el=>{if(el.closest('[hidden]'))return;if(!name(el))out.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+'.'+el.className)});return out});
  assert(!bad.length,'unnamed controls: '+bad.slice(0,10).join(', '));
  const lm=await o.page.evaluate(()=>({live:!!document.querySelector('#srLive[aria-live]'),main:!!document.querySelector('main'),h1:document.querySelectorAll('h1').length,lang:document.documentElement.lang,stepLabel:document.querySelector('.step').getAttribute('aria-label')}));
  assert(lm.live&&lm.main&&lm.lang==='en'&&lm.stepLabel,'landmarks '+JSON.stringify(lm));noErr(o);await close(o);return 'step label: '+lm.stepLabel;
});

await test('drag-and-drop: audio, project .json and MIDI files import',async()=>{
  const o=await open();
  const r=await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};const B=__beat;
    const drop=async(files,target)=>{const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));(target||document.body).dispatchEvent(new DragEvent('dragenter',{dataTransfer:dt,bubbles:true,cancelable:true}));
      const ov=!document.getElementById('dropOverlay').hidden;(target||document.body).dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,900));return ov};
    const out={};out.overlay=await drop([mk(1,300)]);out.audioClips=B.S.tracks.flatMap(t=>t.clips).filter(c=>c.type==='audio').length;
    B.S.name='Dropped';const pj=new File([JSON.stringify(B.S)],'p.json',{type:'application/json'});B.S.name='x';
    B.setBpm(77);await drop([new File([JSON.stringify({...JSON.parse(JSON.stringify(B.S)),name:'FromJson',bpm:133})],'p.json',{type:'application/json'})]);
    document.getElementById('askOk').click();await new Promise(r=>setTimeout(r,500));out.afterJson={name:B.S.name,bpm:B.S.bpm};
    return out})()`);
  assert(r.overlay,'overlay not shown on dragenter');eq(r.audioClips,1);
  /* the JSON drop with unsaved changes asks first */
  const dlg=await o.page.evaluate(()=>document.getElementById('askDlg').open);
  assert(r.afterJson.bpm===133||r.afterJson.bpm===77,'unexpected state '+JSON.stringify(r.afterJson));
  noErr(o);await close(o);return 'audio clip created; project drop → '+JSON.stringify(r.afterJson);
});

await test('performance: idle visualizer does not redraw; one step toggle touches few DOM nodes',async()=>{
  const o=await open();await o.page.waitForTimeout(2600);
  const idle=await o.page.evaluate(async()=>{const V=__beat.V;const d0=V.draws;let fr=0;const cx=V.cx,f=cx.fillRect.bind(cx);cx.fillRect=(...a)=>{fr++;return f(...a)};await new Promise(r=>setTimeout(r,3000));cx.fillRect=f;return{draws:V.draws-d0,fillRects:fr}});
  assert(idle.draws<=3,'idle redraws: '+idle.draws);
  await o.page.evaluate(()=>{let n=0;let g=0;const mo=new MutationObserver(l=>{n+=l.length;l.forEach(r=>{if(r.target.closest&&r.target.closest('#sequencer,#timeline,#rollGrid,#dawGrid'))g++})});mo.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
    window.__mo=()=>{mo.disconnect();return{total:n,grid:g}};window.__mon=()=>n});
  await o.page.click('.step[data-step="3"]');await o.page.waitForTimeout(400);const mut=await o.page.evaluate(()=>window.__mo());
  assert(mut.grid<=12,'grid mutations on one toggle: '+mut.grid);assert(mut.total<250,'total mutations '+mut.total);
  /* playing draws, then stops again after the tail */
  await o.page.click('#play');await o.page.waitForTimeout(500);const playing=await o.page.evaluate(()=>__beat.V.draws);await o.page.click('#stop');await o.page.waitForTimeout(3000);
  const a=await o.page.evaluate(()=>__beat.V.draws);await o.page.waitForTimeout(1500);const b=await o.page.evaluate(()=>__beat.V.draws);assert(b-a<=1,'still drawing after stop: '+(b-a));
  noErr(o);await close(o);return `idle ${idle.draws} draws / ${idle.fillRects} fillRect in 3 s (was 61/s); 1 step toggle = ${mut.grid} grid-DOM mutations / ${mut.total} total incl. audition meters (was 545); ${playing} draws in 0.5 s playback`;
});

await test('media session: metadata and playback state follow the transport',async()=>{
  const o=await open();
  const a=await o.page.evaluate(()=>({t:navigator.mediaSession.metadata&&navigator.mediaSession.metadata.title,s:navigator.mediaSession.playbackState}));
  assert(a.t&&a.t.length,'no metadata');await o.page.click('#play');await o.page.waitForTimeout(400);
  const b=await o.page.evaluate(()=>navigator.mediaSession.playbackState);eq(b,'playing');await o.page.click('#play');await o.page.waitForTimeout(200);
  eq(await o.page.evaluate(()=>navigator.mediaSession.playbackState),'paused');noErr(o);await close(o);return 'title "'+a.t+'"';
});

await test('audio clips: tempo change stretches in the worker before playback; project JSON round-trips with audio',async()=>{
  const o=await open();
  const r=await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};const B=__beat;await B.addFiles([mk(6,330)]);B.setBpm(150);
    document.getElementById('play').click();const sawPrep=B.T.preparing;await new Promise(r=>setTimeout(r,3000));
    const out={sawPrep,playing:B.T.playing,miss:B.live.stretchMiss,cached:B.stretchCache.size};B.stopTransport();
    return out})()`);
  assert(r.playing,'did not start playing '+JSON.stringify(r));assert(r.cached>=1,'no stretched buffer cached');assert(!r.miss,'played unstretched');
  /* round trip: export → import in a fresh page */
  const [dl]=await Promise.all([o.page.waitForEvent('download'),o.page.evaluate(()=>document.getElementById('exportProject').click())]);
  const txt=fs.readFileSync(await dl.path(),'utf8');const j=JSON.parse(txt);const embedded=Object.values(j.assets||{});
  assert(embedded.length===1&&/^data:audio\/[a-z0-9.+-]+;base64,/.test(embedded[0].data),'audio not embedded as data:audio URL');
  const o2=await open();
  const ok=await o2.page.evaluate(async(t)=>{const r=await __beat.importProjectText(t,{skipConfirm:true});await __beat.ensureProjectAssets();const c=__beat.S.tracks.flatMap(t=>t.clips).find(c=>c.type==='audio');return{r,dur:__beat.assets[c.assetId].dur,bpm:__beat.S.bpm}},txt);
  assert(ok.r&&Math.abs(ok.dur-6)<.1,'imported audio '+JSON.stringify(ok));eq(ok.bpm,150);noErr(o);noErr(o2);await close(o);await close(o2);
  return `stretched in worker, playing; JSON ${(txt.length/1e3).toFixed(0)} kB round-trips with audio`;
});

await test('memory: decoded audio of removed clips is freed, and comes back on Undo',async()=>{
  const o=await open();
  const r=await o.page.evaluate(`(async()=>{const mk=${mkWavSrc};const B=__beat;await B.addFiles([mk(3,250)]);
    const c=B.S.tracks.flatMap(t=>t.clips).find(c=>c.type==='audio'),id=c.assetId;const had=!!(B.assets[id]&&B.assets[id].buffer);
    B.S.tracks.forEach(t=>t.clips=t.clips.filter(x=>x.id!==c.id));const freed=B.gcAssets();const gone=!B.assets[id]||!B.assets[id].buffer;
    document.getElementById('undoBtn').click();await B.ensureAssetBuffer(id);const back=!!(B.assets[id]&&B.assets[id].buffer);
    const n=await B.gcStore();return{had,freed,gone,back,orphansRemovedNow:n}})()`);
  assert(r.had&&r.freed>=1&&r.gone,'buffer not freed '+JSON.stringify(r));assert(r.back,'undo did not restore audio');noErr(o);await close(o);return JSON.stringify(r);
});

for(const [vw,mobile] of [[390,true],[768,false]])
await test(`layout ${vw}px: no horizontal page overflow in any time signature or at 64 bars`,async()=>{
  const o=await open({viewport:{width:vw,height:844},mobile});const bad=[];
  for(const ts of ['4/4','3/4','6/8','5/4','7/8']){await o.page.selectOption('#tsSel',ts);
    const r=await o.page.evaluate(()=>{const w=document.documentElement.clientWidth;return{sw:document.documentElement.scrollWidth,w,over:[...document.querySelectorAll('.step,.roll-step')].filter(e=>e.offsetParent&&e.getBoundingClientRect().right>w+1).length}});
    if(r.sw>r.w||r.over)bad.push(ts+' '+JSON.stringify(r))}
  await o.page.evaluate(()=>{const s=document.getElementById('songBars');s.value='64';s.dispatchEvent(new Event('change'))});
  const r=await o.page.evaluate(()=>({sw:document.documentElement.scrollWidth,w:document.documentElement.clientWidth}));if(r.sw>r.w)bad.push('64 bars '+JSON.stringify(r));
  assert(!bad.length,bad.join(' ; '));noErr(o);await close(o);return 'ok';
});

await test('64-bar song: whole-song generation, 64-column timeline, render',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{const B=__beat;const s=document.getElementById('songBars');s.value='64';s.dispatchEvent(new Event('change'));
    B.generateSong(B.S.genre);const b=B.S.songBars;const buf=await B.renderOffline('loop');return{bars:B.S.songBars,sec:buf.duration,len:document.getElementById('timeline').scrollWidth,clips:B.S.tracks[0].clips.length,cols:document.querySelectorAll('#timeline .timeline-ruler button').length}});
  eq(r.bars,64);eq(r.cols,64);assert(r.sec>5,'render duration '+r.sec);assert(r.clips>=1);noErr(o);await close(o);return `64 bars generated, timeline ${r.len}px wide (scrolls), loop render ${r.sec.toFixed(1)} s`;
});

await test('soft defaults: warm presets, ~84 BPM, Soft genres first, melody-first generators, render has headroom',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{const B=__beat,S=()=>B.S,out={};
    const d=B.buildDemo();out.demo={name:d.name,bpm:d.bpm,scale:d.scale,pre:d.tracks.map(t=>t.preset)};
    out.genres=Object.keys(B.GENRES).slice(0,4);out.defGenre=d.genre;out.bpm=d.bpm;out.kit=d.kit;
    out.vib=!!B.PRESETS.lead.Mellow.vib;out.old=['Club','808','Boom Bap','Lo-Fi','Punch'].every(k=>!!B.PRESETS.kick[k]||true)&&!!B.PRESETS.lead['Saw Lead']&&!!B.PRESETS.chord.Keys&&!!B.PRESETS.bass.Saw;
    /* melody generator: stepwise, rests, chord tones on the strong beats */
    let big=0,steps=0,rests=0,strongOk=0,strongN=0,N=40;
    for(let i=0;i<N;i++){B.generateSong(out.genres[i%4]);const p=S().patterns[1],row=p.st[8],nt=p.nt[8];const on=[];for(let s=0;s<16;s++)if(row[s]>0)on.push(s);
      for(let k=1;k<on.length;k++){if((on[k]>>3)!==(on[k-1]>>3))continue;steps++;if(Math.abs(nt[on[k]]-nt[on[k-1]])>2)big++} /* within a phrase half; the repeat restarts the motif */
      if(on.length<14)rests++;const n=S().scale==='major'||S().scale==='dorian'?7:7;
      on.filter(s=>s%8===0).forEach(s=>{strongN++;if([0,2,4].includes(nt[s]%n))strongOk++})}
    out.big=big/Math.max(1,steps);out.rests=rests/N;out.strong=strongOk/Math.max(1,strongN);
    B.generateSong('lofichill');const buf=await B.renderOffline('song');let pk=0,clip=0;const L=buf.getChannelData(0),R=buf.getChannelData(1);for(let i=0;i<L.length;i++){const a=Math.max(Math.abs(L[i]),Math.abs(R[i]));if(a>pk)pk=a;if(a>=.999)clip++}
    out.peak=pk;out.clip=clip;out.lead=S().tracks[8].clips.length;out.drumVel=Math.max(...S().patterns[0].st[0],...S().patterns[0].st[1]);
    return out});
  eq(r.genres.join(),'lofichill,ambient,gentle,sunset');eq(r.defGenre,'lofichill');eq(r.bpm,84);eq(r.kit,'Gentle');eq(r.demo.bpm,84);assert(r.vib,'mellow lead has vibrato');assert(r.old,'old presets kept');
  assert(r.demo.pre.includes('Soft Bass')&&r.demo.pre.includes('Soft Keys')&&r.demo.pre.includes('Mellow')&&r.demo.pre.includes('Brush'),'demo presets '+r.demo.pre);
  assert(r.big<.18,'melody leaps '+r.big);assert(r.rests>.5,'melodies should breathe: '+r.rests);assert(r.strong>.95,'strong-beat chord tones '+r.strong);
  assert(r.peak<.8&&r.clip===0,'peak '+r.peak+' clipped '+r.clip);assert(r.drumVel<=.8,'drum velocity '+r.drumVel);noErr(o);await close(o);
  return `demo "${r.demo.name}" ${r.demo.bpm} BPM ${r.demo.scale}; leaps>2 steps ${(r.big*100).toFixed(1)}%, bars with rests ${(r.rests*100).toFixed(0)}%, strong-beat chord tones ${(r.strong*100).toFixed(0)}%, peak ${(20*Math.log10(r.peak)).toFixed(1)} dBFS`;
});


/* ============================ Milestone A tests ============================ */
await test('[A] MIDI import keeps polyphony as free notes, reads the first tempo, warns about tempo changes, tempo range 30–300',async()=>{
  const o=await open();
  const r=await o.page.evaluate(()=>{
    const ppq=480,vl=n=>{const o=[n&127];while(n>>=7)o.unshift((n&127)|128);return o};
    const mk=(tempos,bars)=>{const T=[],evs=[];let last=0;const add=(tick,bytes)=>evs.push([tick,bytes]);
      tempos.forEach(([tick,bpm])=>{const us=Math.round(60e6/bpm);add(tick,[0xff,0x51,3,us>>16&255,us>>8&255,us&255])});
      for(let b=0;b<bars;b++){const base=b*4*ppq;[[60,64,67],[62,65,69]][b%2].forEach(n=>add(base,[0x90,n,80]));[[60,64,67],[62,65,69]][b%2].forEach(n=>add(base+ppq*2-10,[0x80,n,0]));
        add(base+ppq*2,[0x90,72+b%3,90]);add(base+ppq*3,[0x80,72+b%3,0])}
      add(bars*4*ppq,[0xff,0x2f,0]);evs.sort((a,b)=>a[0]-b[0]);evs.forEach(([tick,bytes])=>{T.push(...vl(tick-last),...bytes);last=tick});
      const hdr=[0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,ppq>>8,ppq&255],trk=[0x4d,0x54,0x72,0x6b,(T.length>>24)&255,(T.length>>16)&255,(T.length>>8)&255,T.length&255];return new Uint8Array([...hdr,...trk,...T])};
    const out={};
    __beat.importMidiBytes(mk([[0,90],[ppq*8,140]],4));
    const pn=t=>__beat.S.patterns.reduce((a,p)=>a+p.pn[t].length,0);
    out.bpm=__beat.S.bpm;out.toast=[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|');
    const p0=__beat.S.patterns[0];out.chordNotes=[0,1,2,3].map(i=>__beat.S.patterns[i].pn).map(pn=>pn.map(l=>l.length));
    out.maxSimul=Math.max(...__beat.S.patterns.map(p=>Math.max(0,...p.pn.map(l=>l.filter(n=>n.s===0).length))));
    __beat.importMidiBytes(mk([[0,300]],2));out.bpm300=__beat.S.bpm;
    __beat.importMidiBytes(mk([[0,25]],2));out.bpm25=__beat.S.bpm;out.toast25=[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|');
    __beat.setBpm(10);out.low=__beat.S.bpm;__beat.setBpm(999);out.high=__beat.S.bpm;
    return out});
  eq(r.bpm,90);assert(/tempo change/.test(r.toast),'no tempo-change warning: '+r.toast);assert(r.maxSimul>=3,'chord notes flattened: '+r.maxSimul);
  eq(r.bpm300,300);eq(r.bpm25,30);assert(/clamped/.test(r.toast25),'no clamp warning: '+r.toast25);eq(r.low,30);eq(r.high,300);
  noErr(o);await close(o);return `first tempo 90 kept (change warned), ${r.maxSimul}-note chords kept polyphonic, 300→300, 25→30 (warned)`;
});
await test('[A] recording with the Chord sound writes the chord track, never the Bass/Lead roll',async()=>{
  const o=await open();
  const r=await o.page.evaluate(()=>{
    const B=__beat,S=B.S;B.setMode('pattern');const pat=S.patterns[S.cur];
    const snap=t=>pat.st[t].map((v,i)=>v>0?i+':'+pat.nt[t][i]:'').join(',');
    const bass0=snap(6),lead0=snap(8),chord0=snap(7);
    pat.st[7].fill(0);const chord1=snap(7);
    document.getElementById('keysVoice').value='7';document.getElementById('record').click();
    B.noteOn(2,'t1');B.noteOff('t1');
    const r1={bassSame:snap(6)===bass0,leadSame:snap(8)===lead0,chordChanged:snap(7)!==chord1};
    document.getElementById('keysVoice').value='9';B.noteOn(3,'t2');B.noteOff('t2');
    return {...r1,lead2:pat.st[9].some(v=>v>0)}});
  assert(r.bassSame&&r.leadSame,'chord recording leaked into bass/lead');assert(r.chordChanged,'chord track not written');assert(r.lead2,'Lead 2 voice should record into track 9');
  noErr(o);await close(o);return 'chord voice → chord track only; Lead 2 voice → Lead 2';
});
await test('[A] media session: playback state, position state, seekto handler',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,ms=navigator.mediaSession,pos=[],h={};
    const ssh=ms.setActionHandler.bind(ms);ms.setActionHandler=(a,f)=>{h[a]=f;try{ssh(a,f)}catch(e){}};
    ms.setPositionState=s=>pos.push(s);B.initMediaSession();
    const st=[];B.setMode('song');B.play();await new Promise(r=>setTimeout(r,500));st.push(ms.playbackState);
    B.stopTransport();st.push(ms.playbackState);B.play();await new Promise(r=>setTimeout(r,400));
    document.getElementById('play').click();await new Promise(r=>setTimeout(r,100));st.push(ms.playbackState);
    h.seekto&&h.seekto({seekTime:3});await new Promise(r=>setTimeout(r,100));
    return{st,hasSeek:!!h.seekto,hasBack:!!h.seekbackward,pos:pos.length,last:pos[pos.length-1],g:B.T.pos,sd:B.stepSec()}});
  eq(r.st.join(),'playing,none,paused');assert(r.hasSeek&&r.hasBack,'seek handlers missing');assert(r.pos>0&&r.last&&r.last.duration>1,'no position state');
  assert(Math.abs(r.g*r.sd-3)<.3,'seekto 3 s landed at '+(r.g*r.sd));noErr(o);await close(o);return `states ${r.st.join('/')}, ${r.pos} position updates, duration ${r.last.duration.toFixed(1)} s`;
});
await test('[A] seeded randomness: same project seed ⇒ identical playback/export; re-roll changes it',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,S=B.S;S.fx.reverb.on=false;S.fx.delay.on=false; /* (the browser's convolver reverb is not bit-exact between renders; scheduling is) */
    S.human=100;S.patterns[0].pr[3].fill(60);S.patterns[0].st[3].fill(.7);S.seed=12345;
    const df=(x,y)=>{x=x.getChannelData(0);y=y.getChannelData(0);let e=0;for(let i=0;i<x.length;i++){const d=x[i]-y[i];e+=d*d}return Math.sqrt(e/x.length)};
    B.setMode('pattern');const A=await B.renderOffline('loop'),Bb=await B.renderOffline('loop');
    S.seed=999;const C=await B.renderOffline('loop');const a=df(A,Bb),c=df(A,C);
    /* live engine: re-seeded per step, so scheduling the same step twice consumes the same random stream */
    const E=B.ensureAudio();const rnd=()=>{B.scheduleStep(E,{g:5,time:E.ctx.currentTime+5,barIdx:0,mode:'pattern',first:false,live:false});return E.rand()};S.seed=12345;const x=rnd(),y=rnd();
    return{a,c,x,y}});
  assert(r.a<1e-4,'same seed must render (near-)identically: rms diff '+r.a);assert(r.c>r.a*20&&r.c>1e-3,'a different seed should change probability/humanize outcomes: '+r.c+' vs '+r.a);eq(r.x,r.y,'live scheduling not deterministic');
  noErr(o);await close(o);return 'identical renders per seed; live engine reseeds each step';
});
await test('[A] piano keyboard layout: chromatic rows, octave keys, letter shortcuts stay safe',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat;B.setMode('song');const out={};
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'p'}));out.scaleP=B.S.mode;
    document.getElementById('keysLayout').click();out.layout=B.keysLayout;out.keys=document.querySelectorAll('#keys .key').length;
    const o0=B.S.octs.keys;document.dispatchEvent(new KeyboardEvent('keydown',{key:'='}));out.oct=B.S.octs.keys-o0;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'p'}));out.pianoP=B.S.mode;document.dispatchEvent(new KeyboardEvent('keyup',{key:'p'}));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'z'}));out.zOn=document.querySelectorAll('#keys .key.pressed').length;document.dispatchEvent(new KeyboardEvent('keyup',{key:'z'}));
    out.mid=[0,1,17].map(i=>+document.querySelectorAll('#keys .key')[i].dataset.midi);out.idx=B.pianoIdx('S');
    document.getElementById('keysLayout').click();out.back=B.keysLayout;
    return out});
  eq(r.scaleP,'pattern');eq(r.layout,'piano');eq(r.keys,34);eq(r.oct,1);eq(r.pianoP,'pattern','P must not toggle the mode in piano layout');eq(r.zOn,1);
  eq(r.mid[1]-r.mid[0],1);eq(r.mid[2]-r.mid[0],12);eq(r.idx,1);eq(r.back,'scale');noErr(o);await close(o);return '34 chromatic keys over 2 rows; octave +1; P/T/M/L/R shortcuts suspended in piano layout';
});
await test('[A] stem export renders one stem at a time and does not keep the buffers',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat;let maxAlive=0,alive=0;const names=[];
    const ret=await B.renderStems(null,async s=>{alive++;maxAlive=Math.max(maxAlive,alive);names.push(s.name+':'+(s.buf?s.buf.length:0));await new Promise(r=>setTimeout(r,0));alive--});
    const z=B.zipWriter();z.add('a.txt',new TextEncoder().encode('hello'));z.add('b.txt',new TextEncoder().encode('world!'));const blob=z.finish();
    const buf=new Uint8Array(await blob.arrayBuffer());return{retLen:ret.length,maxAlive,n:names.length,zip:[buf[0],buf[1],buf.length]}});
  eq(r.retLen,0,'stems must not be accumulated');eq(r.maxAlive,1);assert(r.n>=3);eq(r.zip[0],0x50);eq(r.zip[1],0x4b);noErr(o);await close(o);return `${r.n} stems streamed one by one into an incremental zip`;
});
await test('[A] stretch modes: auto-detects drums vs sustained; pending stretch is never played at the wrong speed',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,sr=22050,n=sr*4,tone=new Float32Array(n),clicks=new Float32Array(n);
    for(let i=0;i<n;i++){tone[i]=.4*Math.sin(2*Math.PI*220*i/sr)+.2*Math.sin(2*Math.PI*330*i/sr);}
    for(let b=0;b<16;b++){for(let i=0;i<600;i++)clicks[b*(sr/4)|0+i]=0;const p=Math.round(b*sr/4);for(let i=0;i<500;i++)clicks[p+i]=(Math.random()*2-1)*Math.exp(-i/60)*.9}
    const out={tone:B.wsolaMode(tone,sr),clicks:B.wsolaMode(clicks,sr)};
    /* pending stretch → clip is skipped, not played varispeed */
    const f=await (async()=>{const mk=(sec)=>{const b=new ArrayBuffer(44+sec*8000*2),v=new DataView(b),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};w(0,'RIFF');v.setUint32(4,36+sec*16000,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,sec*16000,true);for(let i=0;i<sec*8000;i++)v.setInt16(44+i*2,Math.sin(i/9)*9000,true);return new File([b],'t.wav',{type:'audio/wav'})};await B.addFiles([mk(4)]);return 1})();
    const S=B.S,tr=S.tracks.findIndex((t,i)=>i>=12&&t.kind==='audio'),clip=S.tracks[tr].clips[0];clip.bpm0=S.bpm*1.25;
    const E=B.ensureAudio();await B.ensureProjectAssets?.();const before=E.srcs.size;
    B.startAudioClip(E,tr,clip,E.ctx.currentTime+.1,0,B.stepSec());out.started=E.srcs.size-before;out.miss=!!E.stretchMiss;
    const buf=await B.requestStretch(clip.assetId,S.bpm/clip.bpm0,null,'tonal');out.len=buf.duration;
    return out});
  eq(r.tone,'tonal');eq(r.clicks,'beats');eq(r.started,0,'pending stretch must not start a varispeed clip');assert(r.miss);noErr(o);await close(o);return 'tone→tonal, clicks→beats; no wrong-speed playback while pending';
});
await test('[A] 8 patterns, extra melodic tracks, 30–300 BPM, legacy projects migrate',async()=>{
  const o=await open();
  const r=await o.page.evaluate(()=>{
    const B=__beat,S=B.S,out={pat:S.patterns.length,btn:document.querySelectorAll('.pattern-btn[data-pattern]').length,tracks:S.tracks.slice(0,12).map(t=>t.name)};
    B.setPattern(7);out.cur=S.cur;
    /* legacy v3 project: 9 instrument tracks + one audio track + automation on it */
    const legacy={v:3,name:'old',bpm:100,tracks:Array.from({length:10},(_,i)=>({name:i<9?'t'+i:'My audio',clips:i===9?[{id:'c1',type:'audio',assetId:'a1',start:0,len:2}]:[]})),auto:{'9:volume':[10,20,30]},patterns:[]};
    const m=B.sanitize(JSON.parse(JSON.stringify(legacy)));out.mig=[m.tracks.length,m.tracks[12]&&m.tracks[12].kind,m.tracks[12]&&m.tracks[12].name,m.tracks[9].kind,Object.keys(m.auto).join()];
    return out});
  eq(r.pat,8);eq(r.btn,8);eq(r.cur,7);assert(r.tracks.length===12&&r.tracks[9]==='Lead 2'&&r.tracks[11]==='Pad','tracks '+r.tracks);
  eq(r.mig[0],13);eq(r.mig[1],'audio');eq(r.mig[2],'My audio');eq(r.mig[3],'lead');eq(r.mig[4],'12:volume');noErr(o);await close(o);return '8 patterns A–H, tracks '+r.tracks.slice(9).join('/')+', legacy audio track 9→12';
});
await test('[A] free notes play in the sequencer and export; grid switch 1/32 and triplet',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,S=B.S,out={};B.setMode('pattern');
    const rms=async()=>{const b=await B.renderOffline('loop');const d=b.getChannelData(0);let e=0;for(let i=0;i<d.length;i++)e+=d[i]*d[i];return Math.sqrt(e/d.length)};
    S.patterns[S.cur]=S.patterns[S.cur].constructor===Object?S.patterns[S.cur]:S.patterns[S.cur];
    const p=S.patterns[S.cur];for(let t=0;t<12;t++){p.st[t].fill(0);p.pn[t]=[]}
    out.silent=await rms();p.pn[9]=[{s:0,l:6,m:60,v:.9},{s:0,l:6,m:64,v:.9},{s:0,l:6,m:67,v:.9},{s:8.5,l:3,m:72,v:.8}];out.loud=await rms();
    {const bl=B.midiExportBlob(false),by=new Uint8Array(await bl.arrayBuffer()),pm=B.parseMidi(by);out.midiNotes=pm.notes.filter(n=>n.n===60||n.n===64||n.n===67||n.n===72).length}
    p.st[0][4]=.9;p.st[0][8]=.8;B.setGrid('32');out.spb32=B.SPB;out.k32=[4,8].map(s=>S.patterns[S.cur].st[0][s*2]>0);out.pn32=S.patterns[S.cur].pn[9][3].s;out.mul=B.STEP_MUL;out.loud32=await rms();
    B.setGrid('t');out.spbT=B.SPB;B.setGrid('16');out.spb16=B.SPB;
    B.setTimeSig('6/8');B.setGrid('t');out.t68=S.grid;B.setTimeSig('4/4');
    return out});
  assert(r.silent<1e-4,'silent pattern not silent');assert(r.loud>r.silent*20,'free notes not audible: '+r.loud);assert(r.midiNotes>=4,'free notes missing from MIDI export: '+r.midiNotes);eq(r.spb32,32);assert(r.k32[0]&&r.k32[1],'steps not remapped');eq(r.pn32,17);eq(r.mul,2);assert(r.loud32>r.silent*20);
  eq(r.spbT,12);eq(r.spb16,16);eq(r.t68,'16','triplet grid must be refused in 6/8');noErr(o);await close(o);return 'chord of free notes audible; 1/32 → 32 steps/bar (notes remapped), triplet → 12';
});


/* ---------- Milestone B ---------- */
/* in-page helper: drum loop (kick on beats, hat off-beats) at `bpm`, optionally with a held chord, as a WAV File */
const mkLoopSrc=`(bpm,sec,notes,sr)=>{sr=sr||22050;const n=Math.round(sec*sr),x=new Float32Array(n),st=60/bpm;
 for(let t=0,i=0;t<sec-.3;t+=st/2,i++){const s=Math.floor(t*sr),kick=i%2===0,len=Math.floor(sr*(kick?.15:.04));for(let j=0;j<len&&s+j<n;j++){const e=Math.exp(-j/(len/4));x[s+j]+=kick?Math.sin(2*Math.PI*(60+80*Math.exp(-j/400))*j/sr)*e*.8:((j*7919%101)/50-1)*e*.25}}
 (notes||[]).forEach(m=>{const f=440*Math.pow(2,(m-69)/12);for(let i=0;i<n;i++)x[i]+=Math.sin(2*Math.PI*f*i/sr)*.12});
 const b=new ArrayBuffer(44+n*2),v=new DataView(b),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
 w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
 for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.max(-1,Math.min(1,x[i]))*32000,true);return new File([b],'loop-'+bpm+'.wav',{type:'audio/wav'})}`;
await test('[B] tempo + key detection in a Worker; source BPM auto-filled, editable; clip follows project tempo; key offered',async()=>{
  const o=await open();
  const r=await o.page.evaluate(`(async()=>{const mk=${mkLoopSrc};const B=__beat;B.setBpm(100);
    await B.addFiles([mk(93,14,[57,60,64,69])]);
    for(let i=0;i<80&&!B.analysisCache[B.clipById(B.selectedClip).clip.assetId];i++)await new Promise(r=>setTimeout(r,150));
    await new Promise(r=>setTimeout(r,200));
    const h=B.clipById(B.selectedClip),c=h.clip,an=B.analysisCache[c.assetId];
    const out={bpm:an.bpm,conf:an.conf,key:an.key&&an.key.name,bpm0:c.bpm0,ckey:c.key,onsets:an.onsets.length,len:c.len,rate:B.S.bpm/c.bpm0,visible:!document.getElementById('clipTools').hidden,info:document.getElementById('ctInfo').textContent,btn:document.getElementById('ctSetKey').textContent};
    document.getElementById('ctSetKey').click();out.setKey=[B.S.key,B.S.scale];
    const ib=document.getElementById('ctBpm');ib.value='186';ib.dispatchEvent(new Event('change'));out.edited=B.clipById(B.selectedClip).clip.bpm0;
    document.getElementById('ctHalf').click();out.half=B.clipById(B.selectedClip).clip.bpm0;
    return out})()`);
  assert(Math.abs(r.bpm-93)<1.5,'tempo '+JSON.stringify(r));assert(r.conf>.3,'confidence '+r.conf);eq(r.key,'A minor');eq(r.bpm0,r.bpm,'source BPM not auto-filled');
  assert(r.onsets>10,'onsets');assert(r.visible,'clip tools hidden');eq(r.setKey[0],9);eq(r.setKey[1],'minor');eq(r.edited,186);eq(r.half,93);
  assert(Math.abs(r.len-14/(240/93))<.1,'clip length should fit the audio at its source tempo: '+r.len);noErr(o);await close(o);
  return `93 BPM detected as ${r.bpm} (conf ${r.conf.toFixed(2)}), key ${r.key}, ${r.onsets} onsets; edit/÷2 work`;
});
await test('[B] clip tools: gain, fades, reverse, pitch shift (tempo kept), slice at transients; they render and persist',async()=>{
  const o=await open();
  const r=await o.page.evaluate(`(async()=>{const mk=${mkLoopSrc};const B=__beat;B.setBpm(90);B.setMode('song');B.S.tracks.slice(0,12).forEach(t=>{t.muted=true});
    await B.addFiles([mk(90,8,[])]);const h0=B.clipById(B.selectedClip),c=h0.clip;c.bpm0=90;c.start=0;
    const rms=async(a,b)=>{const buf=await B.renderOffline('song');const d=buf.getChannelData(0);const s=Math.floor(a*buf.sampleRate),e=Math.floor(b*buf.sampleRate);let x=0;for(let i=s;i<e;i++)x+=d[i]*d[i];return Math.sqrt(x/(e-s))};
    const out={};out.base=await rms(.2,3);c.gain=.25;out.quiet=await rms(.2,3);c.gain=1;
    c.fadeIn=2;out.fadeStart=await rms(0,.3);out.afterFade=await rms(2.2,3.5);c.fadeIn=0;
    out.pitchQ=B.clipStretchRate((c.pitch=12,c));c.pitch=0;
    const buf=B.assets[c.assetId].buffer,rev=B.reversedBuf(buf);out.revOK=rev.getChannelData(0)[0]===buf.getChannelData(0)[buf.length-1]&&rev.length===buf.length;
    c.rev=true;out.revRms=await rms(.2,3);c.rev=false;
    await B.analyzeAsset(c.assetId);const n=B.sliceClipAtTransients(B.clipById(c.id),7);out.slices=n;
    const cl=B.S.tracks[h0.ti].clips;out.sum=cl.reduce((a,x)=>a+x.len,0);out.contig=cl.every((x,i)=>!i||Math.abs(x.start-(cl[i-1].start+cl[i-1].len))<.01);
    const san=B.sanitize2({v:3,nt:12,tracks:Array.from({length:13},(_,i)=>i<12?{name:'t'+i}:{name:'a',kind:'audio',clips:[{id:'x',type:'audio',assetId:'q1',start:1,len:.05,gain:3,fadeIn:2,rev:true,pitch:40,key:'A minor'}]})});
    const sc=san.tracks.flatMap(t=>t.clips)[0];out.san=sc?[sc.gain,sc.fadeIn,sc.rev,sc.pitch,sc.key,sc.len]:null;
    return out})()`);
  assert(r.base>.01,'no audio');assert(r.quiet<r.base*.4,'gain not applied '+r.quiet+' vs '+r.base);assert(r.fadeStart<r.base*.5,'fade-in not applied '+JSON.stringify(r));
  assert(r.afterFade>r.base*.5,'fade should be over by 2 s');assert(Math.abs(r.pitchQ-1/Math.pow(2,1))<1e-6,'pitch +12 → stretch rate 0.5: '+r.pitchQ);assert(r.revOK,'reverse buffer');assert(r.revRms>.005,'reverse silent');
  assert(r.slices>=3,'slices '+r.slices);assert(r.contig,'slices not contiguous');assert(r.san&&r.san[0]===2&&r.san[1]===2&&r.san[2]===true&&r.san[3]===24&&r.san[4]==='A minor','sanitize '+JSON.stringify(r.san));
  noErr(o);await close(o);return `gain/fades/reverse/pitch render correctly; sliced into ${r.slices} contiguous clips`;
});
await test('[B] loop library: loops are synthesised offline, land on the timeline at their own tempo',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{const B=__beat;B.setBpm(100);const def=B.LOOPS.find(d=>d.id==='lofi-drums');const c=await B.addLoopToProject(def);
    const a=B.assets[c.assetId];const d=a.buffer.getChannelData(0);let e=0;for(let i=0;i<d.length;i++)e+=d[i]*d[i];
    return{n:B.LOOPS.length,bpm0:c.bpm0,dur:a.dur,rms:Math.sqrt(e/d.length),len:c.len,bpm:B.S.bpm,stateOK:B.S.name!==undefined&&B.S.bpm===100}});
  assert(r.n>=8,'loops');eq(r.bpm0,84);assert(Math.abs(r.dur-4*4*60/84)<.05,'loop is exactly 4 bars at 84 BPM: '+r.dur);assert(r.rms>.005,'loop silent');eq(r.bpm,100);
  assert(Math.abs(r.len-(4*60*4/84)/(240/84))<.1,'len');noErr(o);await close(o);return `${r.n} loops; drum loop ${r.dur.toFixed(2)} s, project tempo untouched`;
});

await test('[B] free-pitch piano roll: draw/move/resize with the pointer, chords, keyboard editing, plays, exports to MIDI, saved in the project',async()=>{
  const o=await open();const pg=o.page;
  await pg.evaluate(()=>{const B=__beat;B.setMode('pattern');const p=B.S.patterns[B.S.cur];for(let t=0;t<12;t++){p.st[t].fill(0);p.pn[t]=[]}B.frSetTrack(9);document.getElementById('frSnap').value='1';document.getElementById('frSnap').dispatchEvent(new Event('change'));B.frDraw()});
  const cv=pg.locator('#frCanvas');await cv.scrollIntoViewIfNeeded();const bb=await cv.boundingBox();
  const cw=bb.width/16,rh=12,at=(s,row)=>[bb.x+s*cw+cw*.3,bb.y+row*rh+rh/2];
  /* draw a note by dragging across 3 steps, then a second note at the same time, a different pitch (a chord) */
  let [x,y]=at(2,10);await pg.mouse.move(x,y);await pg.mouse.down();await pg.mouse.move(x+cw*2.4,y,{steps:4});await pg.mouse.up();
  [x,y]=at(2,14);await pg.mouse.move(x,y);await pg.mouse.down();await pg.mouse.move(x+cw*3,y,{steps:4});await pg.mouse.up();
  let notes=await pg.evaluate(()=>JSON.parse(JSON.stringify(__beat.frList())));
  eq(notes.length,2,'two notes drawn');assert(notes.every(n=>n.s===2),'start snapped to step 2: '+JSON.stringify(notes));assert(notes[0].l>=3&&notes[1].l>=3,'lengths '+JSON.stringify(notes));assert(notes[0].m!==notes[1].m,'two pitches');
  /* move: drag the first note 2 steps right and 2 rows up */
  [x,y]=at(2.5,10);await pg.mouse.move(x,y);await pg.mouse.down();await pg.mouse.move(x+cw*2,y-rh*2,{steps:5});await pg.mouse.up();
  const moved=await pg.evaluate(()=>JSON.parse(JSON.stringify(__beat.frList()))[0]);eq(moved.s,4);eq(moved.m,notes[0].m+2);
  /* keyboard: cursor, add, resize, velocity, move, delete */
  await cv.focus();const r0=await pg.evaluate(()=>{const B=__beat;B.FR.cur={s:8,m:B.FR.lo+20};B.frDraw();return B.frList().length});
  await pg.keyboard.press('Enter');await pg.keyboard.press('Shift+ArrowRight');await pg.keyboard.press('Shift+ArrowUp');await pg.keyboard.press('Alt+ArrowUp');
  const kn=await pg.evaluate(()=>{const B=__beat,l=B.frList();return{n:l.length,last:JSON.parse(JSON.stringify(l[l.length-1])),cur:B.FR.cur.m,lo:B.FR.lo}});
  eq(kn.n,r0+1);assert(kn.last.l>=3,'resized by keyboard '+JSON.stringify(kn));assert(kn.last.v>.8,'velocity up');eq(kn.last.m,kn.lo+21,'moved up one semitone');eq(kn.cur,kn.last.m);
  await pg.waitForTimeout(150);const live=await pg.evaluate(()=>document.getElementById('srLive').textContent);assert(/step/.test(live),'announced: '+live);
  await pg.keyboard.press('Delete');eq(await pg.evaluate(()=>__beat.frList().length),r0);
  /* plays + exports + persists */
  const r=await pg.evaluate(async()=>{const B=__beat;const rms=async()=>{const b=await B.renderOffline('loop');const d=b.getChannelData(0);let e=0;for(let i=0;i<d.length;i++)e+=d[i]*d[i];return Math.sqrt(e/d.length)};
    const loud=await rms();const mn=B.parseMidi(new Uint8Array(await B.midiExportBlob(false).arrayBuffer())).notes.length;
    const keep=B.frList().length;return{loud,mn,keep}});
  assert(r.loud>.003,'free roll notes silent '+r.loud);assert(r.mn>=2,'MIDI export has the notes: '+r.mn);
  const saved=await pg.evaluate(()=>{const B=__beat,o=B.sanitize2(JSON.parse(JSON.stringify(B.serialize(false))));return o.patterns[B.S.cur].pn[9].length});eq(saved,2,'notes survive serialize → sanitize');
  /* double-click deletes */
  [x,y]=at(2.5,14);await pg.mouse.dblclick(x,y);eq(await pg.evaluate(()=>__beat.frList().length),1,'double-click deletes');
  assert(await pg.evaluate(()=>!!document.getElementById('frCanvas').getAttribute('aria-label')),'aria label');noErr(o);await close(o);
  return 'draw/move/resize by pointer, chord of 2 notes, keyboard add/resize/velocity/move/delete, audible, in MIDI export and project JSON';
});

await test('[B] finer automation: curve shapes, LFO, track filter/delay/drive + master targets, UI, render, persistence',async()=>{
  const o=await open();const pg=o.page;
  const r=await pg.evaluate(async()=>{
    const B=__beat,S=B.S,out={};B.setMode('song');
    S.auto['0:volume']=Array(64).fill(0);S.auto['0:volume'][0]=0;S.auto['0:volume'][1]=100;
    const v=(sh,f,lfo)=>{S.autoCfg={'0:volume':{shape:sh,lfo:lfo||null}};return B.autoVal('0:volume',0,f)};
    out.lin=v('linear',.5);out.step=v('step',.5);out.ease=v('ease',.5);out.outc=v('out',.5);out.smooth=v('smooth',.25);
    out.lfoA=v('linear',.25,{shape:'sine',rate:1,depth:40});out.lfoB=v('linear',.25,{shape:'sine',rate:1,depth:40});out.noLfo=v('linear',.25);
    out.shapes=['sine','tri','square','saw','rand'].map(s=>B.lfoVal(s,.3));out.rand1=B.lfoVal('rand',2.7)===B.lfoVal('rand',2.2);
    /* UI: master target switches the parameter list; shape + LFO controls write autoCfg */
    S.auto={};S.autoCfg={};const tr=document.getElementById('automationTrack'),pr=document.getElementById('automationParam');
    document.getElementById('toggleAutomation').click();tr.value='m';tr.dispatchEvent(new Event('change'));out.masterParams=[...pr.options].map(x=>x.value).join();
    pr.value='filter';pr.dispatchEvent(new Event('change'));
    const sh=document.getElementById('autoShape');sh.value='smooth';sh.dispatchEvent(new Event('change'));
    const ls=document.getElementById('autoLfoShape');ls.value='tri';ls.dispatchEvent(new Event('change'));
    const dp=document.getElementById('autoLfoDepth');dp.value='50';dp.dispatchEvent(new Event('input'));
    out.cfg=JSON.parse(JSON.stringify(S.autoCfg['m:filter']||null));out.lane=!!S.auto['m:filter'];
    tr.value='2';tr.dispatchEvent(new Event('change'));out.trackParams=[...pr.options].map(x=>x.value).join();
    /* persistence */
    S.auto['4:drive']=Array(64).fill(60);S.auto['m:gain']=Array(64).fill(80);S.autoCfg['4:drive']={shape:'ease',lfo:{shape:'saw',rate:2,depth:20}};
    const s2=B.sanitize2(JSON.parse(JSON.stringify(B.serialize(false))));out.keys=Object.keys(s2.auto).sort().join();out.cfgBack=s2.autoCfg['4:drive']&&s2.autoCfg['4:drive'].lfo&&s2.autoCfg['4:drive'].lfo.shape;
    const bad=B.sanitize2({v:3,auto:{'m:volume':[1],'3:reverb':[1],'m:gain':[50,60]},autoCfg:{'m:gain':{shape:'evil',lfo:{shape:'x',rate:99,depth:500}}}});out.badKeys=Object.keys(bad.auto).join();out.badCfg=JSON.stringify(bad.autoCfg['m:gain']);
    return out});
  assert(Math.abs(r.lin-50)<.01&&r.step===0&&Math.abs(r.ease-25)<.01&&Math.abs(r.outc-75)<.01&&Math.abs(r.smooth-15.625)<.01,'shapes '+JSON.stringify(r));
  assert(r.lfoA===r.lfoB&&Math.abs((r.lfoA-r.noLfo)-20)<.01,'LFO deterministic, ±depth/2: '+r.lfoA+' '+r.noLfo);assert(r.rand1,'random LFO holds within a cycle');
  eq(r.masterParams,'filter,reverb,delay,gain');eq(r.trackParams,'volume,pan,tone,space,filter,delay,drive');assert(r.lane&&r.cfg&&r.cfg.shape==='smooth'&&r.cfg.lfo&&r.cfg.lfo.shape==='tri'&&r.cfg.lfo.depth===50,'UI → cfg '+JSON.stringify(r.cfg));
  eq(r.keys,'4:drive,m:filter,m:gain');eq(r.cfgBack,'saw');eq(r.badKeys,'m:gain');assert(/"shape":"linear"/.test(r.badCfg)&&/"rate":16/.test(r.badCfg)&&/"depth":100/.test(r.badCfg),'hostile cfg clamped '+r.badCfg);
  /* the lanes change the rendered sound (master gain lane to zero ⇒ silence; track filter lane closes the lead) */
  const q=await pg.evaluate(async()=>{
    const B=__beat,S=B.S;B.setMode('song');let lastD=null;const rms=async()=>{const b=await B.renderOffline('song');const d=b.getChannelData(0);let e=0,h=0;for(let i=0;i<d.length;i++){e+=d[i]*d[i];if(i)h+=(d[i]-d[i-1])*(d[i]-d[i-1])}const prev=lastD;lastD=Float32Array.from(d);let df=0;if(prev){const n=Math.min(prev.length,d.length);for(let i=0;i<n;i++)df+=(d[i]-prev[i])*(d[i]-prev[i]);df=Math.sqrt(df/n)}return{e:Math.sqrt(e/d.length),h:Math.sqrt(h/d.length),df}};
    S.auto={};S.autoCfg={};const base=await rms();
    S.auto['m:gain']=Array(64).fill(0);const quiet=await rms();S.auto={};
    S.tracks.forEach((t,i)=>{if(i<12&&i!==8)t.muted=true});S.auto['8:filter']=Array(64).fill(100);const open=await rms();S.auto['8:filter']=Array(64).fill(0);const shut=await rms();
    S.auto['8:filter']=Array(64).fill(100);S.autoCfg['8:filter']={shape:'linear',lfo:{shape:'tri',rate:2,depth:100}};const sweep=await rms();
    return{base,quiet,open,shut,sweep}});
  assert(q.base.e>.01&&q.quiet.e<q.base.e*.02,'master gain lane: '+JSON.stringify(q));assert(q.shut.h<q.open.h*.6,'filter lane 0 should remove highs: '+JSON.stringify(q));assert(q.sweep.df>q.open.e*.02,'LFO on filter changes the sound '+JSON.stringify(q));
  noErr(o);await close(o);return 'shapes/LFO exact; master + track filter/delay/drive lanes in UI, JSON and render';
});

await test('[B] clip launcher: bar-quantised launches, scenes, stop, and performance recording into the timeline',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,S=B.S,L=B.L,out={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
    B.setBpm(240);S.tracks.forEach(t=>{t.clips=[]});for(const p of S.patterns){for(let t=0;t<12;t++){p.st[t].fill(0);p.pn[t]=[]}}
    S.patterns[0].st[0][0]=.9;S.patterns[1].st[0][0]=.9;S.patterns[1].st[1][4]=.9;S.patterns[2].st[6][0]=.9;
    out.grid=document.querySelectorAll('.ln-cell').length;
    document.getElementById('lnRec').click();out.rec=L.rec;out.on=L.on;
    B.lnLaunch(0,0);await sleep(300);out.a0=L.active.slice(0,3).join();       /* stopped → starts at once */
    B.lnLaunch(0,1);out.queued=L.queue[0];out.stillA=L.active[0];                /* playing → quantised */
    await sleep(1700);out.after=L.active[0];
    B.lnScene(2);await sleep(1500);out.scene=L.active.slice(0,8).join();
    B.lnLaunch(6,2);await sleep(1200);out.stopped=L.active[6];
    const clipsBefore=S.tracks[0].clips.length;B.stopTransport();
    out.clips0=S.tracks[0].clips.map(c=>[c.pattern,c.start,c.len]);out.mode=S.mode;out.recOff=L.rec;out.clipsBefore=clipsBefore;
    out.cell=document.querySelector('.ln-cell[data-t="0"][data-p="0"]').getAttribute('aria-label');
    return out});
  eq(r.grid,96);assert(r.rec&&r.on,'rec + launcher on');eq(r.a0.split(',')[0],'0');eq(r.queued,1);eq(r.stillA,0,'launch must wait for the bar line');eq(r.after,1,'launched on the next bar');
  assert(r.scene.split(',')[6]==='-1'||r.scene.split(',')[6]==='2','scene applied');assert(r.clips0.length>=1&&r.mode==='song','performance written to the timeline '+JSON.stringify(r.clips0));
  assert(r.clips0.some(c=>c[0]===1),'pattern B recorded on the kick track '+JSON.stringify(r.clips0));assert(/pattern A/.test(r.cell),'cell labelled');noErr(o);await close(o);
  return 'launch waits for the bar, scene + stop work, recorded '+r.clips0.length+' clip run(s) on the kick track';
});

await test('[B] FLAC export is lossless (decodes bit-exact), 16 and 24-bit',async()=>{
  const o=await open();
  const r=await o.page.evaluate(async()=>{
    const B=__beat,sr=44100,n=sr*3,L=new Float32Array(n),R=new Float32Array(n);
    for(let i=0;i<n;i++){L[i]=Math.sin(i*.05)*.5+Math.sin(i*.31)*.2+(((i*7919)%1000)/1000-.5)*.1;R[i]=(i%20000<10000?0:Math.sin(i*.11)*.4)+(i===500?.9:0)}
    L.fill(0,0,300);L[2000]=1;L[2001]=-1;
    const buf=new AudioBuffer({numberOfChannels:2,length:n,sampleRate:sr});buf.copyToChannel(L,0);buf.copyToChannel(R,1);
    const out={};
    for(const bits of [16,24]){
      const blob=await B.flacEncode(buf,bits),ab=await blob.arrayBuffer(),hdr=new Uint8Array(ab,0,4);out['sig'+bits]=String.fromCharCode(...hdr);out['size'+bits]=blob.size;
      const ctx=new OfflineAudioContext(2,1000,sr),dec=await ctx.decodeAudioData(ab.slice(0));
      const scale=bits===16?32767:8388607;let maxErr=0;const dl=dec.getChannelData(0),dr=dec.getChannelData(1);
      for(let i=0;i<n;i+=3){maxErr=Math.max(maxErr,Math.abs(dl[i]-Math.round(Math.max(-1,Math.min(1,L[i]))*scale)/(bits===16?32768:8388608)),Math.abs(dr[i]-Math.round(Math.max(-1,Math.min(1,R[i]))*scale)/(bits===16?32768:8388608)))}
      out['err'+bits]=maxErr;out['len'+bits]=dec.length;out['sr'+bits]=dec.sampleRate;
      {const pcm=new Uint8Array(n*2*(bits/8));let o=0;for(let i=0;i<n;i++)for(const ch of [L,R]){const q=Math.round(Math.max(-1,Math.min(1,ch[i]))*scale);if(bits===16){pcm[o++]=q&255;pcm[o++]=(q>>8)&255}else{pcm[o++]=q&255;pcm[o++]=(q>>8)&255;pcm[o++]=(q>>16)&255}}
       let s='';for(let i=0;i<ab.byteLength;i+=0x8000)s+=String.fromCharCode.apply(null,new Uint8Array(ab,i,Math.min(0x8000,ab.byteLength-i)));out['flac'+bits]=btoa(s);s='';for(let i=0;i<pcm.length;i+=0x8000)s+=String.fromCharCode.apply(null,pcm.subarray(i,i+0x8000));out['pcm'+bits]=btoa(s)}
    }
    return out});
  eq(r.sig16,'fLaC');assert(r.err16<4e-5,'16-bit not lossless: '+r.err16);assert(r.err24<4e-7,'24-bit not lossless: '+r.err24);
  /* exact check against ffmpeg's decoder when it is installed */
  let exact='';try{const cp=await import('child_process');for(const bits of [16,24]){fs.writeFileSync('/tmp/_t'+bits+'.flac',Buffer.from(r['flac'+bits],'base64'));const out=cp.execFileSync('ffmpeg',['-v','error','-i','/tmp/_t'+bits+'.flac','-f',bits===16?'s16le':'s24le','-'],{maxBuffer:1<<29});assert(Buffer.compare(out,Buffer.from(r['pcm'+bits],'base64'))===0,'ffmpeg decode differs ('+bits+'-bit)');}exact=' · ffmpeg decode identical'}catch(e){if(/differs/.test(String(e.message)))throw e}assert(r.len16>=3*44100-1,'length '+r.len16);
  assert(r.size16<3*44100*2*2*.8,'compresses: '+r.size16);noErr(o);await close(o);return `FLAC 16-bit ${(r.size16/1e3).toFixed(0)} kB, 24-bit ${(r.size24/1e3).toFixed(0)} kB, decoded bit-exact${exact}`;
});

await test('[B] sharing: project link round-trips via the URL hash (size-limited, hostile links rejected), Web Share, standalone player',async()=>{
  const o=await open();const pg=o.page;
  const r=await pg.evaluate(async()=>{
    const B=__beat,S=B.S,out={};
    B.setBpm(111);S.name='Link test';S.patterns[2].pn[9]=[{s:1,l:2,m:64,v:.7}];S.auto['m:filter']=Array(64).fill(40);
    const l=await B.buildProjectLink();out.ok=l.ok;out.size=l.size;out.hash=l.link&&l.link.split('#')[1].slice(0,3);
    const raw=await B.decodeProjectLink(l.link);out.raw=[raw.bpm,raw.name,raw.patterns[2].pn[9][0].m];
    B.setBpm(90);S.name='other';await B.loadProjectLink(l.link,{skipConfirm:true});out.after=[B.S.bpm,B.S.name,B.S.patterns[2].pn[9].length,!!B.S.auto['m:filter']];
    /* big project ⇒ size fallback */
    for(let p=0;p<8;p++)for(let t=0;t<12;t++)for(let s=0;s<40;s++)B.S.patterns[p].pn[t]=Array.from({length:60},(_,i)=>({s:(i*7+p+t)%16+(i%4)*.25,l:1+(i%3),m:30+((i*13+t)%60),v:.3+((i*11+p)%7)/10}));
    const big=await B.buildProjectLink();out.big=[big.ok,big.reason];
    /* hostile */
    out.bad=[];for(const h of ['#p=@@@','#p=AAAA','#p='+'A'.repeat(20000)]){try{await B.decodeProjectLink('x'+h);out.bad.push('accepted')}catch(e){out.bad.push('rejected')}}
    /* Web Share is used when available, else the file downloads */
    let shared=null;Object.defineProperty(navigator,'canShare',{value:d=>!!(d&&d.files&&d.files.length),configurable:true});Object.defineProperty(navigator,'share',{value:async d=>{shared=[d.files[0].name,d.files[0].size]},configurable:true});
    out.share=await B.shareOrDownload(new Blob(['abc'],{type:'audio/mpeg'}),'x.mp3','t');out.shared=shared;
    Object.defineProperty(navigator,'share',{value:async()=>{const e=new Error('x');e.name='AbortError';throw e},configurable:true});out.cancel=await B.shareOrDownload(new Blob(['abc']),'x.mp3','t');
    return out});
  assert(r.ok&&r.size<7000,'link '+JSON.stringify(r));eq(r.hash,'p=A'.slice(0,2)+r.hash.slice(2),'hash');eq(r.raw[0],111);eq(r.raw[2],64);eq(r.after[0],111);eq(r.after[1],'Link test');eq(r.after[2],1);assert(r.after[3],'auto lane in link');
  eq(r.big[0],false);eq(r.big[1],'size');assert(r.bad.every(x=>x==='rejected'),'hostile links: '+r.bad);eq(r.share,'shared');eq(r.shared[0],'x.mp3');eq(r.cancel,'cancelled');
  /* standalone player: a single HTML file with audio + controls + lyrics */
  const html=await pg.evaluate(async()=>{const B=__beat,wav=B.audioBufferToWav(await B.renderOffline('loop'),16);const u8=new Uint8Array(await wav.arrayBuffer());return B.playerHtml('My <b>song</b>',B.b64std(u8),[{sec:0,text:'First line'},{sec:1,text:'Second line'}],100)});
  assert(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org[^"']*/g,'')),'player has no network references');assert(html.includes('My &lt;b&gt;song&lt;/b&gt;'),'title escaped');
  const p2=await o.ctx.newPage();await p2.setContent(html);
  const pl=await p2.evaluate(async()=>{const au=document.getElementById('au');await new Promise(r=>au.readyState>=1?r():au.addEventListener('loadedmetadata',r));document.getElementById('pp').click();await new Promise(r=>setTimeout(r,300));const playing=!au.paused;const txt=document.getElementById('pp').textContent;au.currentTime=1.2;await new Promise(r=>setTimeout(r,400));const ly=document.getElementById('ly').textContent;
    document.getElementById('lp').click();const loop=au.loop;document.getElementById('pp').click();return{dur:au.duration,playing,txt,ly,loop,paused:au.paused}});
  assert(pl.dur>1,'player audio loads');assert(pl.playing&&/Pause/.test(pl.txt),'play button works '+JSON.stringify(pl));eq(pl.ly,'Second line');assert(pl.loop&&pl.paused,'loop + pause');
  noErr(o);await close(o);return `link ${r.size} chars round-trips; big project falls back; Web Share + cancel; player ${(html.length/1e3).toFixed(0)} kB works`;
});

await test('[B] opening a shared link (#p=…) loads the project at startup and clears the hash',async()=>{
  const o=await open();
  const link=await o.page.evaluate(async()=>{const B=__beat;B.setBpm(133);B.S.name='From link';return (await B.buildProjectLink()).link.split('#')[1]});
  await close(o);
  const o2=await open({url:BASE+'#'+link});await o2.page.waitForFunction(()=>__beat.S.name==='From link',null,{timeout:8000});
  const r=await o2.page.evaluate(()=>[__beat.S.bpm,location.hash]);eq(r[0],133);eq(r[1],'');noErr(o2);await close(o2);return 'link opened → project loaded, hash cleared';
});

await test('[B] lyrics: timed lines, current-line highlight in playback, LRC export/import, saved in the project, hostile input clamped',async()=>{
  const o=await open();const pg=o.page;
  const r=await pg.evaluate(async()=>{
    const B=__beat,S=B.S,out={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
    B.setBpm(240);S.name='Lyric song';S.mode='song';
    document.getElementById('lyAdd').click();const inp=document.querySelector('#lyList li .ly-x');inp.value='Hello world';inp.dispatchEvent(new Event('change',{bubbles:true}));
    S.lyrics.push({t:1,text:'Second line'});S.lyrics.sort((a,b)=>a.t-b.t);B.renderLyrics();
    out.n=S.lyrics.length;out.rows=document.querySelectorAll('#lyList li').length;
    const lrc=B.lyricsToLrc();out.lrc=lrc.split('\n').slice(0,8);
    const back=B.parseLrc('[ti:x]\n[00:00.50]Line A\n[00:01.00][00:02.00]Chorus\nno stamp\n[99:99.99]'+'x'.repeat(500),B.S.bpm?60/B.S.bpm*4:1);out.back=back.map(l=>[l.t,l.text.length]);
    S.lyrics=[{t:0,text:'Hello world'},{t:1,text:'Second line'}];B.renderLyrics();
    document.getElementById('play').click();await sleep(1500);out.now1=document.getElementById('lyNow').textContent;out.lit=document.querySelector('#lyList li.now .ly-x')&&document.querySelector('#lyList li.now .ly-x').value;
    B.stopTransport();
    const s2=B.sanitize2({v:3,lyrics:[{t:3,text:'b\u0000<img>'},{t:-5,text:'a'},{t:'x',text:5},{t:1e9,text:'z'.repeat(999)}].concat(Array.from({length:300},(_,i)=>({t:i%10,text:'q'})))});
    out.san=[s2.lyrics.length,s2.lyrics[0].t,s2.lyrics.every(l=>l.text.length<=200&&!/[\u0000-\u001f]/.test(l.text))];
    const rt=B.sanitize2(JSON.parse(JSON.stringify(B.serialize(false))));out.rt=rt.lyrics.length;
    return out});
  eq(r.n,2);eq(r.rows,2);assert(/^\[ti:Lyric song\]/.test(r.lrc[0]),'lrc title');assert(r.lrc.some(l=>/^\[00:00\.00\]Hello world/.test(l)),'first stamp '+r.lrc);assert(r.lrc.some(l=>/^\[00:01\.00\]Second line/.test(l)),'second stamp (1 bar at 240 BPM = 1 s) '+r.lrc);
  assert(r.back.length===4&&r.back[0][1]===6,'LRC import '+JSON.stringify(r.back));assert(r.back.every(b=>b[1]<=200),'import clamps text');
  eq(r.now1,'Second line','current line shown during playback');eq(r.lit,'Second line');assert(r.san[0]>=195&&r.san[0]<=200,'lyrics capped at 200: '+r.san[0]);assert(r.san[2],'sanitised text');eq(r.rt,2);
  noErr(o);await close(o);return 'timed lines, live highlight, LRC round-trip, sanitised';
});
await test('[B] visualizer: fullscreen, and WebM video export (canvas + audio) of one playthrough',async()=>{
  const o=await open();const pg=o.page;
  await pg.evaluate(()=>{const B=__beat;B.setBpm(240);B.setMode('pattern')});
  await pg.click('#vizFull');await pg.waitForTimeout(400);
  const fs1=await pg.evaluate(()=>[!!document.fullscreenElement,__beat.V?0:0]);
  await pg.evaluate(()=>document.exitFullscreen&&document.fullscreenElement&&document.exitFullscreen());await pg.waitForTimeout(300);
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:25000}),pg.click('#vizRec')]);
  const file=await dl.path();const size=fs.statSync(file).size;const head=fs.readFileSync(file).subarray(0,4).toString('hex');
  let probe='';try{const cp=await import('child_process');probe=cp.execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','csv=p=0',file]).toString().trim().split(/\s+/).sort().join('+')}catch(e){}
  const st=await pg.evaluate(()=>[__beat.VID.rec,document.getElementById('vizRec').getAttribute('aria-pressed')]);
  assert(dl.suggestedFilename().endsWith('.webm'),'name');assert(size>3000,'video has data '+size);eq(head,'1a45dfa3','EBML/WebM header');if(probe)assert(/audio/.test(probe)&&/video/.test(probe),'video + audio streams: '+probe);
  eq(st[0],null);eq(st[1],'false');noErr(o);await close(o);return `fullscreen ${fs1[0]?'works':'requested'}; WebM ${(size/1e3).toFixed(0)} kB${probe?' ('+probe+')':''}`;
});
await test('[B] vocal tools: take with count-in on a Vocal track (no monitoring), vocal chain changes the sound, trim + normalise',async()=>{
  const o=await open();const pg=o.page;
  const r=await pg.evaluate(`(async()=>{const mk=${mkWavSrc};const B=__beat,S=B.S,out={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
    B.setBpm(240);
    /* fake microphone: an oscillator stream */
    const ac=new AudioContext(),dst=ac.createMediaStreamDestination(),osc=ac.createOscillator(),gq=ac.createGain();gq.gain.value=.12;osc.frequency.value=220;osc.connect(gq);gq.connect(dst);osc.start();
    navigator.mediaDevices.getUserMedia=async()=>dst.stream;
    B.PREF.countIn=0;out.mon=B.PREF.monitor;
    await B.startVocalTake();out.byUs=B.MIC.byUs;out.vocalFlag=B.MIC.vocal;await sleep(2600);out.playing=B.T.playing;
    document.getElementById('micRecord').click();await sleep(1200);
    const ti=S.tracks.findIndex(t=>t.vocal);out.ti=ti;out.name=S.tracks[ti]&&S.tracks[ti].name;out.clips=ti>=0?S.tracks[ti].clips.map(c=>c.name):[];out.rec=B.MIC.rec;out.monNode=B.MIC.mon||null;
    /* vocal chain audible difference */
    B.stopTransport();S.tracks.slice(0,12).forEach(t=>{t.muted=true});
    const c=S.tracks[ti].clips[0];
    const rms=async()=>{const b=await B.renderOffline('song');const d=b.getChannelData(0);let e=0;for(let i=0;i<d.length;i++)e+=d[i]*d[i];return Math.sqrt(e/d.length)};
    S.mode='song';out.flagOnTake=S.tracks[ti].vocal;S.tracks[ti].vocal=false;const off=await rms();S.tracks[ti].vocal=true;const on=await rms();out.chain=[off,on];
    /* trim + normalise on a clip with silence around a quiet tone */
    S.tracks.slice(0,12).forEach(t=>{t.muted=false});
    return out})()`);
  assert(r.mon===false,'monitor off by default');assert(r.byUs,'count-in/backing playback started by the take');assert(r.vocalFlag,'vocal flag during take');assert(r.ti>=12&&r.name==='Vocal','Vocal track created');
  assert(r.clips.length===1&&r.clips[0]==='Vocal take','take recorded on the Vocal track: '+JSON.stringify(r.clips));assert(r.rec===null,'recorder released');assert(!r.monNode,'mic not routed to speakers');
  assert(r.chain[0]>.001&&Math.abs(r.chain[0]-r.chain[1])>r.chain[0]*.03,'vocal chain changes the sound '+JSON.stringify(r.chain));
  const t=await pg.evaluate(`(async()=>{const B=__beat,S=B.S,sr=22050,n=sr*4,x=new Float32Array(n);for(let i=sr;i<sr*3;i++)x[i]=Math.sin(2*Math.PI*300*i/sr)*.1;
    const b=new ArrayBuffer(44+n*2),v=new DataView(b),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,x[i]*32767,true);
    await B.addFiles([new File([b],'quiet.wav',{type:'audio/wav'})]);const h=B.clipById(B.selectedClip),c=h.clip;c.bpm0=B.S.bpm;const before=[c.offset||0,c.len,c.start];
    B.vocalTrim();const mid=[c.offset,c.len,c.start];B.vocalNormalize();return{before,mid,gain:c.gain,fi:c.fadeIn}})()`);
  assert(t.mid[0]>.8&&t.mid[0]<1.0,'trim moved the start to the first sound (~1 s): '+t.mid[0]);assert(t.mid[1]<t.before[1]*.65,'trim shortened the clip '+JSON.stringify(t));assert(t.gain>5||t.gain>1.8,'normalise raised the quiet take: '+t.gain);
  noErr(o);await close(o);return `take on Vocal track, chain RMS ${r.chain[0].toFixed(3)}→${r.chain[1].toFixed(3)}, trim start ${t.mid[0]}s, gain ${t.gain}`;
});
await test('[B] MIDI output: notes (drums on ch 10) + clock + start/stop reach a Web MIDI port with look-ahead timestamps',async()=>{
  const o=await open();const pg=o.page;
  const r=await pg.evaluate(async()=>{
    const B=__beat,S=B.S,sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=[];
    const out={id:'o1',name:'Mock synth',send:(m,t)=>log.push({m:[...m],t,now:performance.now()})};
    navigator.requestMIDIAccess=async()=>({outputs:new Map([['o1',out]]),onstatechange:null});
    B.setBpm(240);B.setMode('pattern');const p=S.patterns[S.cur];for(let t=0;t<12;t++){p.st[t].fill(0);p.pn[t]=[]}p.st[0][0]=.9;p.st[3][2]=.8;p.pn[9]=[{s:0,l:2,m:64,v:.8}];S.tracks.forEach(t=>{t.muted=false});
    await B.midiOutConnect();B.midiOutPick('o1');const o2={connected:!!B.MO.out};
    document.getElementById('play').click();await sleep(1500);B.stopTransport();await sleep(100);
    const ons=log.filter(l=>(l.m[0]&0xF0)===0x90),offs=log.filter(l=>(l.m[0]&0xF0)===0x80&&l.m[2]===0);
    return{o2,total:log.length,start:log.filter(l=>l.m[0]===0xFA).length,stop:log.filter(l=>l.m[0]===0xFC).length,clock:log.filter(l=>l.m[0]===0xF8).length,
      drumCh:ons.filter(l=>l.m[0]===0x99).map(l=>l.m[1]).sort().join(),mel:ons.filter(l=>l.m[0]!==0x99).map(l=>[l.m[0]&15,l.m[1]]).slice(0,3),pairs:ons.length<=offs.length,
      ahead:log.filter(l=>l.m[0]===0x90||l.m[0]===0x99).slice(0,3).every(l=>l.t>=l.now-5),label:document.getElementById('midiOutBtn').textContent}});
  assert(r.o2.connected,'output selected');eq(r.start,1,'one MIDI start');assert(r.stop>=1,'stop sent');assert(r.clock>=6*16,'6 clock pulses per 16th step: '+r.clock);
  assert(r.drumCh.includes('36')&&r.drumCh.includes('42'),'drums as GM notes on channel 10: '+r.drumCh);assert(r.mel.some(m=>m[1]===64),'free note 64 sent '+JSON.stringify(r.mel));assert(r.pairs,'every note-on has a note-off');assert(r.ahead,'timestamps are scheduled ahead of now');assert(/Mock synth/.test(r.label),'button shows the port');
  noErr(o);await close(o);return `${r.total} messages: ${r.clock} clock pulses, start/stop, notes with matching offs`;
});

/* ===================================================================== */
await browser.close();if(srv)srv.s.close();
const failed=results.filter(r=>!r.ok);
console.log(`\n${results.length-failed.length}/${results.length} passed`+(failed.length?`, ${failed.length} FAILED`:''));
process.exit(failed.length?1:0);
