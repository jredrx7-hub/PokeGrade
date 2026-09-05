const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
let stream = null;
let photoURL = "sample-ho-oh.jpg";
let saved = JSON.parse(localStorage.getItem("pg_scans") || "[]");
let analysis = null;
let cvReady = false;

window.onOpenCvReady = () => {
  cvReady = true;
  const status = $("#engineStatus");
  if (status) { status.textContent = "CV engine ready"; status.className = "engine ready"; }
};

function show(id){
  $$(".screen").forEach(x=>x.classList.remove("active"));
  $("#"+id).classList.add("active");
  if(id!=="scan" && stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
}

function setPhoto(url){
  photoURL=url;
  $("#photo").src=url; $("#photo").style.display="block"; $("#placeholder").style.display="none";
  $("#cardImage").src=url; $("#resultImage").src=url;
  $("#qualityText").textContent="Analyzing image…";
  analyzePhoto(url).then(a=>{
    analysis=a;
    updateQuality(a);
    updateIdentify(a);
  }).catch(()=>{
    analysis=null;
    $("#qualityText").textContent="Photo received — analysis unavailable";
  });
}

async function camera(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});
    $("#video").srcObject=stream; $("#video").style.display="block"; $("#placeholder").style.display="none";
  }catch(e){toast("Camera permission unavailable — use Upload");}
}

function updateQuality(a){
  if(!a) return;
  const q=a.quality.score;
  const label=q>=82?"Excellent":q>=65?"Good":q>=48?"Fair":"Retake recommended";
  $("#qualityText").textContent=`${label} · ${Math.round(q)}/100`;
  $("#qualityText").className=q>=65?"good":q>=48?"warn":"bad";
}

function updateIdentify(a){
  const setText = $("#identitySet");
  const details = $("#identityDetails");
  if(photoURL === "sample-ho-oh.jpg"){
    $("#identityName").textContent="Ho-Oh";
    setText.textContent="Mega Evolution — Chaos Rising";
    details.textContent="010/086 • Holo Rare";
  } else {
    $("#identityName").textContent="Pokémon card";
    setText.textContent="Identification pending";
    details.textContent="Image analysis complete • card database lookup not yet connected";
  }
  const rows = [
    ["Card boundary", a.detected ? "✓ Detected" : "⚠ Not confident", a.detected?"ok":"warn"],
    ["Text region", a.detected ? "✓ Image usable" : "⚠ Retake", a.detected?"ok":"warn"],
    ["Perspective", `${a.perspective.angle.toFixed(1)}° · ${a.perspective.label}`, a.perspective.good?"ok":"warn"],
    ["Holographic glare", `${a.glare.percent.toFixed(1)}% · ${a.glare.label}`, a.glare.good?"ok":"warn"]
  ];
  $("#checks").innerHTML=rows.map(r=>`<div><span>${r[0]}</span><b class="${r[2]}">${r[1]}</b></div>`).join("");
  $("#analysisNote").innerHTML=`<b>Image analysis:</b> ${a.detected?"Card isolated and perspective-corrected in memory. We can now score centering, corners, edges and visible surface." : "The card boundary was not confidently found. Retake with all four corners visible."}`;
}

function updateResult(a){
  if(!a) return;
  $("#grade").textContent=`${a.grade.low.toFixed(1)}–${a.grade.high.toFixed(1)}`;
  $("#confidence").textContent=a.confidence;
  $("#gradeLabel").textContent=a.grade.label;
  setSub("centering",a.subgrades.centering);
  setSub("corners",a.subgrades.corners);
  setSub("edges",a.subgrades.edges);
  setSub("surface",a.subgrades.surface);
  $("#resultWarning").innerHTML=`<b>${a.grade.label === "Retake recommended" ? "⚠ Retake recommended" : "✓ Computer-vision estimate"}</b><span>${a.summary}</span>`;
  $("#nextShots").innerHTML=`<b>Improve confidence</b><span>${a.nextShots}</span>`;
}
function setSub(name,v){
  $(`#${name}Score`).textContent=v.toFixed(1);
  $(`#${name}Meter`).value=Math.max(0,Math.min(1,v/10));
}

async function analyzePhoto(url){
  const img = await loadImage(url);
  const maxW = 1600;
  const scale = Math.min(1,maxW/img.naturalWidth);
  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(img.naturalWidth*scale));
  c.height=Math.max(1,Math.round(img.naturalHeight*scale));
  c.getContext("2d",{willReadFrequently:true}).drawImage(img,0,0,c.width,c.height);
  const basic=basicMetrics(c);
  let detected=false, warped=null, perspective={angle:0,label:"Straight",good:true};
  if(cvReady && window.cv){
    const result=detectAndWarp(c);
    detected=!!result;
    if(result){
      warped=result.warped;
      perspective=result.perspective;
    }
  }
  const target = warped || c;
  const metrics=cardMetrics(target,detected);
  const quality=qualityScore(basic,metrics,perspective);
  const subgrades={
    centering: metrics.centering.score,
    corners: metrics.corners.score,
    edges: metrics.edges.score,
    surface: metrics.surface.score
  };
  const min=Math.min(...Object.values(subgrades));
  const avg=Object.values(subgrades).reduce((a,b)=>a+b,0)/4;
  let high=Math.min(10,Math.round((avg+0.35)*2)/2);
  let low=Math.max(1,Math.round((min-0.15)*2)/2);
  if(quality.score<50) { high=Math.min(high,7.5); low=Math.min(low,6.0); }
  const confidence=quality.score>=80&&detected?"High":quality.score>=60?"Medium":"Low";
  const label=low>=9?"Gem Mint":low>=8?"Near Mint":low>=6.5?"Excellent / Very Good":"Review / Retake";
  const summary = `Centering ${metrics.centering.text}; corner wear proxy ${metrics.corners.wear.toFixed(1)}%; edge wear proxy ${metrics.edges.wear.toFixed(1)}%; bright/glare pixels ${metrics.surface.glare.toFixed(1)}%. This is a computer-vision pre-grade, not a PSA/BGS/CGC grade.`;
  const nextShots = quality.score<65 ? "Retake straight-on in even light. Keep all four corners visible and avoid reflections." : metrics.surface.glare>5 ? "Retake with a 30–45° light reflection to reveal scratches without blowing out the image." : "Capture the back as a second scan and add one angled-light shot for stronger surface confidence.";
  return {detected,perspective,quality,subgrades,grade:{low,high,label},confidence,summary,nextShots,metrics};
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const i=new Image(); i.onload=()=>resolve(i); i.onerror=reject; i.src=src;
  });
}
function basicMetrics(c){
  const ctx=c.getContext("2d",{willReadFrequently:true});
  const d=ctx.getImageData(0,0,c.width,c.height).data;
  let lum=0,bright=0,glare=0;
  for(let i=0;i<d.length;i+=16){
    const r=d[i],g=d[i+1],b=d[i+2]; const l=.2126*r+.7152*g+.0722*b; lum+=l;
    if(l>245) bright++; if(l>248&&Math.max(r,g,b)-Math.min(r,g,b)<10) glare++;
  }
  const n=d.length/16;
  return {brightness:lum/n, bright:bright/n*100, glare:glare/n*100};
}
function detectAndWarp(c){
  try{
    const src=cv.imread(c), gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), contours=new cv.MatVector(), hier=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray,blur,new cv.Size(5,5),0); cv.Canny(blur,60,160,edges);
    cv.findContours(edges,contours,hier,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    const imgArea=c.width*c.height; let best=null;
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i), peri=cv.arcLength(cnt,true), approx=new cv.Mat();
      cv.approxPolyDP(cnt,approx,0.02*peri,true);
      const area=Math.abs(cv.contourArea(approx));
      if(approx.rows===4 && area>imgArea*0.12 && area<imgArea*0.98){
        const pts=[]; for(let j=0;j<4;j++) pts.push({x:approx.intAt(j,0),y:approx.intAt(j,1)});
        const ordered=orderPts(pts); const w1=dist(ordered[0],ordered[1]),w2=dist(ordered[2],ordered[3]),h1=dist(ordered[0],ordered[3]),h2=dist(ordered[1],ordered[2]);
        const w=(w1+w2)/2,h=(h1+h2)/2,ratio=Math.max(w,h)/Math.min(w,h), areaScore=area/imgArea;
        if(ratio>1.20&&ratio<1.58){
          const score=areaScore*100 + (1-Math.min(1,Math.abs(ratio-1.397)/.18))*20;
          if(!best||score>best.score) best={score,ordered,w,h};
        }
      }
      approx.delete(); cnt.delete();
    }
    if(!best){src.delete();gray.delete();blur.delete();edges.delete();contours.delete();hier.delete();return null;}
    const W=744,H=1040;
    const srcPts=cv.matFromArray(4,1,cv.CV_32FC2, best.ordered.flatMap(p=>[p.x,p.y]));
    const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,W,0,W,H,0,H]);
    const M=cv.getPerspectiveTransform(srcPts,dstPts), warped=new cv.Mat(); cv.warpPerspective(src,warped,M,new cv.Size(W,H),cv.INTER_LINEAR,cv.BORDER_REPLICATE,new cv.Scalar());
    const out=document.createElement("canvas"); out.width=W;out.height=H;cv.imshow(out,warped);
    const angle=Math.abs(Math.atan2(best.ordered[1].y-best.ordered[0].y,best.ordered[1].x-best.ordered[0].x)*180/Math.PI);
    [src,gray,blur,edges,contours,hier,srcPts,dstPts,M,warped].forEach(x=>x.delete());
    return {warped:out,perspective:{angle,label:angle<1.5?"Straight":angle<4?"Slight angle":"Angled",good:angle<4}};
  }catch(e){ return null; }
}
function orderPts(p){
  const s=p.map(q=>q.x+q.y), d=p.map(q=>q.x-q.y);
  return [p[s.indexOf(Math.min(...s))],p[d.indexOf(Math.max(...d))],p[s.indexOf(Math.max(...s))],p[d.indexOf(Math.min(...d))]];
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function cardMetrics(c,detected){
  const ctx=c.getContext("2d",{willReadFrequently:true}), W=c.width,H=c.height;
  const d=ctx.getImageData(0,0,W,H).data;
  const lum=(x,y)=>{const i=(y*W+x)*4;return .2126*d[i]+.7152*d[i+1]+.0722*d[i+2]};
  const sat=(x,y)=>{const i=(y*W+x)*4;const mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]);return mx?((mx-mn)/mx):0};
  let glare=0, total=0;
  for(let y=0;y<H;y+=5)for(let x=0;x<W;x+=5){if(lum(x,y)>245&&sat(x,y)<.10)glare++;total++;}
  const glarePct=glare/total*100;
  const border=Math.max(6,Math.round(Math.min(W,H)*.025));
  const inner=Math.max(border+5,Math.round(Math.min(W,H)*.07));
  const left=meanBand(lum,0,border,0,H), right=meanBand(lum,W-border,W,0,H), top=meanBand(lum,0,W,0,border), bottom=meanBand(lum,0,W,H-border,H);
  const centerLR=Math.abs(left-right)/(left+right+1)*100, centerTB=Math.abs(top-bottom)/(top+bottom+1)*100;
  const centeringScore=Math.max(1,10-Math.max(centerLR,centerTB)*1.8);
  const cornerVals=[patchMean(lum,0,0,border*4,border*4),patchMean(lum,W-border*4,0,W,border*4),patchMean(lum,W-border*4,H-border*4,W,H),patchMean(lum,0,H-border*4,border*4,H)];
  const cornerWear=cornerVals.filter(v=>v>215).length/4*100 + cornerVals.reduce((s,v)=>s+Math.max(0,v-185),0)/4/70*20;
  const cornerScore=Math.max(1,10-Math.min(7,cornerWear*.06));
  const edgeWear=((Math.max(0,top-205)+Math.max(0,bottom-205)+Math.max(0,left-205)+Math.max(0,right-205))/4);
  const edgeScore=Math.max(1,10-Math.min(6,edgeWear*.035));
  const surfaceScore=Math.max(1,10-Math.min(7,glarePct*.16));
  const centeringText=`L/R ${Math.round((50-Math.min(25,centerLR))/1)}:${Math.round((50+Math.min(25,centerLR))/1)}, T/B ${Math.round(50-Math.min(25,centerTB))}:${Math.round(50+Math.min(25,centerTB))}`;
  return {centering:{score:centeringScore,text:centeringText},corners:{score:cornerScore,wear:cornerWear},edges:{score:edgeScore,wear:edgeWear},surface:{score:surfaceScore,glare:glarePct},glare:{percent:glarePct,label:glarePct<2?"Low":glarePct<7?"Present":"High",good:glarePct<7},detected};
}
function meanBand(fn,x0,x1,y0,y1){let s=0,n=0;for(let y=y0;y<y1;y+=4)for(let x=x0;x<x1;x+=4){s+=fn(x,y);n++;}return s/n||0}
function patchMean(fn,x0,y0,x1,y1){return meanBand(fn,Math.max(0,x0),Math.min(currentW(fn),x1),Math.max(0,y0),Math.min(currentH(fn),y1))}
function currentW(){return 744} function currentH(){return 1040}
function qualityScore(b,m,p){
  const brightPenalty=Math.abs(b.brightness-145)*.16;
  const glarePenalty=Math.min(30,b.glare*.9);
  const perspectivePenalty=p.good?0:Math.min(25,p.angle*3);
  return {score:Math.max(0,Math.min(100,100-brightPenalty-glarePenalty-perspectivePenalty+(m.detected?8:0)))};
}

$("#start").onclick=()=>{show("scan");camera()};
$("#sample").onclick=()=>{setPhoto("sample-ho-oh.jpg");show("identify")};
$$('.back').forEach(x=>x.onclick=()=>show(x.dataset.back));
$("#file").onchange=e=>{const f=e.target.files[0];if(f){setPhoto(URL.createObjectURL(f));show("identify")}};
$("#snap").onclick=()=>{if(!stream)return toast("Start the camera or use Upload");const v=$("#video"),c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);setPhoto(c.toDataURL("image/jpeg",.92));show("identify")};
$("#demo").onclick=()=>$("#sample").click();
$("#analyze").onclick=()=>{if(!analysis)return toast("Image analysis is still running");updateResult(analysis);show("result");toast("Computer-vision pre-grade complete")};
$("#save").onclick=()=>{const grade=analysis?`${analysis.grade.low.toFixed(1)}–${analysis.grade.high.toFixed(1)}`:"—";saved.unshift({name:photoURL==="sample-ho-oh.jpg"?"Ho-Oh":"Pokémon card",set:photoURL==="sample-ho-oh.jpg"?"Chaos Rising":"Unidentified",number:photoURL==="sample-ho-oh.jpg"?"010/086":"—",grade,image:photoURL});localStorage.setItem("pg_scans",JSON.stringify(saved));render();toast("Scan saved on this device")};
function render(){$("#count").textContent=saved.length;$("#cards").innerHTML=saved.length?saved.map(x=>`<div class="grid-card" style="background-image:url('${x.image}')"><span>${x.name} • ${x.grade}</span></div>`).join(""):`<div style="grid-column:1/-1;text-align:center;color:#8791a1;padding:55px 10px">No saved scans yet.</div>`}
$$('nav button').forEach(b=>b.onclick=()=>{if(b.dataset.nav==="home")show("home");else if(b.dataset.nav==="scan")show("scan");else if(b.dataset.nav==="collection"){show("collection");render()}else $("#more").classList.add("open")});
$("#closeMore").onclick=()=>$("#more").classList.remove("open");
$("#help").onclick=()=>toast("PokeGrade v0.4 uses browser computer vision for card geometry and visible image quality.");
$("#torch").onclick=()=>toast("Use even room light; native torch control comes with the app build.");
$("#share").onclick=()=>toast("Shareable reports are next.");
render();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
