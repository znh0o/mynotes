import { readFile } from 'node:fs/promises';
// Rebuild marketing screenshots in a fresh, isolated browser profile.
// No data from a user's installed app is read or changed.
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const url = process.env.DEMO_URL || 'http://127.0.0.1:4173/mynotes/';
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  const original = window.matchMedia.bind(window);
  window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : original(query);
});
const page = await context.newPage();
try {
  await page.goto(url);
  await page.locator('.library-shell').waitFor();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 2; i++) {
    const sheet = pdf.addPage([794, 1123]);
    const text = (value, x, y, size, heavy = false, color = rgb(.17,.25,.36)) => sheet.drawText(value, { x, y:1123-y, size, font: heavy ? bold : regular, color });
    sheet.drawRectangle({ x:0, y:0, width:794, height:1123, color:rgb(.998,.993,.978) });
    text('FIELD NOTES  /  BIOLOGY', 62, 67, 12, true, rgb(.35,.51,.48));
    text(i ? 'From light to life.' : 'The science of light.', 62, 133, 37, true);
    text(i ? '02   ENERGY & ECOSYSTEMS' : '01   PHOTOSYNTHESIS', 62, 170, 12, true, rgb(.42,.52,.55));
    sheet.drawLine({start:{x:62,y:920},end:{x:732,y:920},thickness:1,color:rgb(.8,.86,.83)});
    if (!i) {
      text('How plants turn sunlight into chemical energy',62,246,19,true);
      ['Plants capture light energy through chlorophyll.', 'Inside the chloroplast, light-dependent reactions', 'produce ATP and NADPH. The Calvin cycle uses', 'this energy to fix carbon dioxide into sugars.'].forEach((line,n)=>text(line,62,286+n*30,17));
      sheet.drawRectangle({x:62,y:438,width:670,height:240,color:rgb(.91,.95,.91)});
      text('SUNLIGHT',112,516,13,true); text('CHLOROPLAST',306,516,13,true); text('GLUCOSE',578,516,13,true);
      for (let x of [172,390,622]) sheet.drawCircle({x,y:536,size:40,borderColor:rgb(.38,.59,.48),borderWidth:2});
      for (let x of [216,434]) sheet.drawLine({start:{x,y:536},end:{x:x+135,y:536},thickness:1.5,color:rgb(.38,.59,.48)});
      text('light',158,592,17);text('energy',365,592,17);text('sugar',600,592,17);
      text('6CO2 + 6H2O + light  ->  C6H12O6 + 6O2',103,659,22,true);
      text('REMEMBER',62,764,12,true,rgb(.35,.51,.48));
      ['Energy flows through an ecosystem.', 'Matter cycles between living things', 'and their environment.'].forEach((line,n)=>text(line,62,807+n*31,19));
    } else {
      text('Two stages. One connected process.',62,246,21,true);
      [['LIGHT REACTIONS','Thylakoid membrane','Light -> ATP + NADPH'],['CALVIN CYCLE','Stroma','CO2 -> carbohydrate']].forEach((section,n)=>{
        const top=300+n*250;
        sheet.drawRectangle({x:62,y:1123-top-195,width:670,height:195,color:n?rgb(.96,.93,.85):rgb(.91,.95,.91)});
        text(section[0],88,top+37,13,true);text(section[1],88,top+82,25,true);text(section[2],88,top+128,19);
      });
      text('CHECK YOUR UNDERSTANDING',62,875,12,true,rgb(.35,.51,.48));
      text('Where does the oxygen we breathe come from?',62,920,19);
    }
    text('NOTELIN STUDY SERIES',62,1060,10,false,rgb(.5,.58,.59));text(`0${i+1}`,700,1060,11,true);
  }
  const pdfBytes = [...await pdf.save()];
  // User-supplied study notes, cropped to the page content only.
  const project = await PDFDocument.create();
  const projectImage = await project.embedPng(await readFile('scripts/demo-assets/user-science-notes.png'));
  project.addPage([1338,770]).drawImage(projectImage,{x:0,y:0,width:1338,height:770});
  const projectBytes=[...await project.save()];
  await page.evaluate(async ({pdfBytes,projectBytes}) => {
    const open = indexedDB.open('mynotes-v1');
    const db = await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error)});
    const tx = db.transaction(['notes','pages','assets','folders','settings'],'readwrite');
    const notes=tx.objectStore('notes'), pages=tx.objectStore('pages');
    // This database belongs exclusively to the temporary Playwright context.
    notes.clear(); pages.clear();
    const ink='#263d56', green='#427966', blue='#486ec1', ochre='#bd8740';
    let seq=0;
    const text=(x,y,w,value,size=20,color=ink,bold=false)=>({id:`demo-${++seq}`,kind:'text',x,y,w,h:size*1.55*value.split('\n').length,text:value,size,color,bold});
    const shape=(kind,x,y,w,h,color,width=1)=>({id:`demo-${++seq}`,kind:'shape',shape:kind,x,y,w,h,color,width});
    const stroke=(path,color,width=2,tool='pen')=>{
      const svg=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('d',path);
      const len=svg.getTotalLength(), count=Math.ceil(len/3);
      return {id:`demo-${++seq}`,kind:'stroke',tool,color,width,pressure:false,points:Array.from({length:count+1},(_,i)=>{const p=svg.getPointAtLength(len*i/count);return{x:p.x,y:p.y,p:.5,t:i}})};
    };
    const note=(id,title,cover,pageIds,offset)=>({id,title,cover,folderId:null,pageIds,created:Date.now()-offset,updated:Date.now()-offset,opened:Date.now()-offset,favorite:offset===0,deleted:null});
    const sheet=(id,noteId,items,paper='blank',width=1200,height=720)=>({id,noteId,width,height,paper,paperColor:'#fffef9',spacing:24,items,revision:1});
    const biology=[
      text(60,39,600,'BIOLOGY   /   CHAPTER 03',12,green,true),text(60,68,800,'빛을 에너지로 바꾸는 방법',36,ink,true),
      text(61,121,620,'광합성 · Photosynthesis',16,'#73837f'),text(971,46,170,'OCT 25, 2026',12,'#84918c'),
      shape('line',60,162,1080,0,'#d6e1d9'),
      text(61,187,480,'01   잎 속의 작은 에너지 공장',21,green,true),
      text(61,228,480,'식물은 빛에너지를 흡수해\n이산화탄소와 물로 포도당을 만든다.',19,ink),
      stroke('M63 272 L400 272','#efd578',19,'highlighter'),
      // A botanical sketch made of actual editable pen strokes.
      stroke('M230 497 C144 476 138 383 179 324 C220 300 300 315 333 359 C340 421 300 478 230 497',green,2.8),
      stroke('M225 520 Q247 437 274 344',green,2.4),
      stroke('M237 471 Q188 442 178 405 M248 433 Q205 403 193 358 M260 393 Q237 359 235 327 M242 450 Q287 443 314 402 M251 418 Q296 396 323 372 M262 381 Q291 362 307 341',green,1.4),
      stroke('M72 345 Q109 315 146 341 M136 329 L148 342 L133 347',ochre,2.2),
      text(64,301,100,'빛',18,ochre,true),text(69,423,130,'CO₂ + H₂O',20,blue),
      stroke('M116 459 Q143 471 171 461 M159 454 L174 461 L163 470',blue,2),
      text(348,363,160,'잎',19,green,true),text(350,397,180,'엽록체에서 빛 흡수',15,'#76867c'),
      stroke('M348 388 Q326 386 312 399',green,1.7),
      text(340,473,150,'O₂ 방출',18,blue),stroke('M301 468 Q329 459 352 443 M341 443 L355 440 L351 453',blue,2),
      stroke('M64 588 L497 588','#d3e6d4',78,'highlighter'),
      text(76,562,410,'빛 + 물 + 이산화탄소 → 포도당 + 산소',18,green,true),text(76,602,410,'에너지는 사라지지 않고 형태가 바뀐다.',15,'#627e6e'),
      shape('line',567,190,0,448,'#e2e6dd'),
      text(615,187,500,'02   두 단계로 이해하기',21,green,true),
      text(615,237,440,'명반응',23,ink,true),text(615,278,460,'틸라코이드에서 빛을 흡수하고\nATP와 NADPH를 생성한다.',18),
      stroke('M616 320 L857 320','#eed079',17,'highlighter'),
      text(615,370,440,'캘빈 회로',23,ink,true),text(615,411,460,'스트로마에서 CO₂를 고정하고\n명반응의 에너지로 당을 합성한다.',18),
      stroke('M619 461 Q761 455 926 460',blue,1.8),
      stroke('M1046 270 C1090 282 1091 390 1049 411 M1049 398 L1046 414 L1062 408',blue,2.2),
      text(614,524,440,'✓  꼭 기억할 것',19,ochre,true),text(615,562,480,'산소는 물의 광분해에서 나온다.\n명반응과 캘빈 회로는 서로 연결된다.',17),
      stroke('M613 651 Q761 646 922 650','#d9b96b',3),
      text(60,682,600,'SCIENCE JOURNAL   /   오늘 배운 것을 나의 언어로.',11,'#8b978e'),text(1097,682,60,'03',12,green,true)
    ];
    const projectPage={...sheet('project-1','project',[],'blank',1338,770),pdfAssetId:'project-pdf',pdfIndex:1};
    pages.put(projectPage);notes.put(note('project','통합과학1 정리','#7165b5',[projectPage.id],0));
    tx.objectStore('assets').put({id:'project-pdf',noteId:'project',name:'통합과학1 정리.pdf',blob:new Blob([new Uint8Array(projectBytes)],{type:'application/pdf'})});
    const b1=sheet('bio-1','biology',biology), b2=sheet('bio-2','biology',[text(65,65,900,'다음 시간 · 세포 호흡',36,green,true),text(65,160,900,'광합성으로 저장한 에너지는 어떻게 쓰일까?',24)],'dots');
    pages.put(b1);pages.put(b2);notes.put(note('biology','생명과학 · 나의 개념 노트','#547e6b',[b1.id,b2.id],0));
    const pdfItems=[
      [stroke('M64 286 L530 286','#f0d566',22,'highlighter'),stroke('M65 375 L514 375','#f0d566',22,'highlighter'),text(70,410,650,'핵심: 빛에너지 → 화학 에너지',22,blue,true),stroke('M493 795 C548 747 637 751 687 781 C724 819 676 854 624 838',blue,2),text(472,876,250,'물에서 산소가!',21,blue),stroke('M493 905 Q570 897 673 906',blue,2)],
      [stroke('M88 382 L358 382','#8ec9a0',23,'highlighter'),stroke('M88 632 L284 632','#f0d566',23,'highlighter'),text(382,446,310,'빛이 필요한 단계',22,blue),text(387,696,285,'탄소를 고정!',22,blue),text(65,970,660,'→ 물(H₂O)의 광분해에서 나온 산소',23,blue,true),stroke('M64 1007 L545 1005',blue,2)]
    ];
    const pdfPages=pdfItems.map((items,i)=>({...sheet(`pdf-${i}`,'pdf-study',items,'blank',794,1123),pdfAssetId:'study-pdf',pdfIndex:i+1}));
    pdfPages.forEach(p=>pages.put(p));notes.put(note('pdf-study','광합성 리딩 · PDF 스터디','#6785b1',pdfPages.map(p=>p.id),1000));
    tx.objectStore('assets').put({id:'study-pdf',noteId:'pdf-study',name:'Photosynthesis.pdf',blob:new Blob([new Uint8Array(pdfBytes)],{type:'application/pdf'})});
    [['math','수학 · 함수의 언어','#a99a77','함수와 그래프','개념을 연결하고, 풀이를 기록하는 시간.'],['reading','문장 수집 노트','#b78378','오래 남기고 싶은 문장','읽으며 만난 생각을 나의 말로 정리하기.'],['planner','이번 주의 기록','#8d85ad','WEEKLY PLAN','MON   생명과학 개념 정리\nTUE    수학 문제 풀이\nWED   책 읽고 문장 수집']].forEach(([id,title,cover,heading,body],i)=>{
      const p=sheet(`${id}-1`,id,[text(65,60,900,heading,38,cover,true),shape('line',65,133,1050,0,cover,1.3),text(65,180,900,body,24,ink)],'dots');pages.put(p);notes.put(note(id,title,cover,[p.id],(i+2)*1000));
    });
    tx.objectStore('folders').put({id:'folder-school',name:'이번 학기',color:green});
    tx.objectStore('folders').put({id:'folder-personal',name:'일상과 기록',color:ochre});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  }, {pdfBytes,projectBytes});
  await page.reload();
  const settle = async()=>{await page.locator('.page-loading').waitFor({state:'hidden'});await page.locator('.app-slide-layer').waitFor({state:'detached'});await page.evaluate(()=>document.fonts.ready);};
  const capture=async(name)=>{
    await page.mouse.move(1,1);
    await sharp(await page.screenshot()).resize(1440,900,{fit:'fill'}).webp({quality:94}).toFile(`public/notelin-${name}-preview.webp`);
  };
  await page.getByRole('button',{name:'통합과학1 정리 열기',exact:true}).click();await settle();
  await capture('editor');
  await page.getByRole('button',{name:'서재로 돌아가기'}).click();
  await page.getByRole('button',{name:'광합성 리딩 · PDF 스터디 열기',exact:true}).click();await settle();
  await page.getByRole('button',{name:'보기 옵션',exact:true}).click();
  await page.locator('[data-action="two-page"]').click();
  await page.getByRole('button',{name:'보기 옵션',exact:true}).click();
  await page.locator('.spread-companion').waitFor();await settle();
  await page.waitForFunction(() => {
    const c = document.querySelector('.spread-background');
    if (!c || !c.width) return false;
    const data = c.getContext('2d').getImageData(0,0,c.width,Math.floor(c.height*.2)).data;
    let dark=0; for(let i=0;i<data.length;i+=4) if(data[i]<100&&data[i+3]>100) dark++;
    return dark>100;
  });
  await capture('pdf');
  await page.getByRole('button',{name:'서재로 돌아가기'}).click();
  await page.locator('.app-slide-layer').waitFor({state:'detached'});
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>window.scrollTo(0,0));
  await sharp(await page.screenshot()).resize(1440,1000).webp({quality:94}).toFile('public/notelin-library-preview.webp');
  console.log('Created three demo assets from the real app in an isolated browser context.');
} finally {await context.close();await browser.close();}
