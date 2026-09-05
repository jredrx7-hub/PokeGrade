const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
let stream=null,photoURL="sample-ho-oh.jpg",saved=JSON.parse(localStorage.getItem("pg_scans")||"[]");
function show(id){$$(".screen").forEach(x=>x.classList.remove("active"));$("#"+id).classList.add("active");if(id!=="scan"&&stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
function setPhoto(url){photoURL=url;$("#photo").src=url;$("#photo").style.display="block";$("#placeholder").style.display="none";$("#cardImage").src=url;$("#resultImage").src=url;$("#qualityText").textContent="Good — photo received"}
async function camera(){try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920}},audio:false});$("#video").srcObject=stream;$("#video").style.display="block";$("#placeholder").style.display="none"}catch(e){toast("Camera permission unavailable — use Upload or Demo")}}
$("#start").onclick=()=>{show("scan");camera()};$("#sample").onclick=()=>{setPhoto("sample-ho-oh.jpg");show("identify")};
$$(".back").forEach(x=>x.onclick=()=>show(x.dataset.back));
$("#file").onchange=e=>{const f=e.target.files[0];if(f){setPhoto(URL.createObjectURL(f));show("identify")}};
$("#snap").onclick=()=>{if(!stream)return toast("Start the camera or use Upload");const v=$("#video"),c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);setPhoto(c.toDataURL("image/jpeg",.9));show("identify")};
$("#demo").onclick=()=>$("#sample").click();
$("#analyze").onclick=()=>{show("result");toast("Pre-grade complete")};
$("#save").onclick=()=>{saved.unshift({name:"Ho-Oh",set:"Chaos Rising",number:"010/086",grade:"8.0–9.0",image:photoURL});localStorage.setItem("pg_scans",JSON.stringify(saved));render();toast("Scan saved on this device")};
function render(){$("#count").textContent=saved.length;$("#cards").innerHTML=saved.length?saved.map(x=>`<div class="grid-card" style="background-image:url('${x.image}')"><span>${x.name} • ${x.grade}</span></div>`).join(""):`<div style="grid-column:1/-1;text-align:center;color:#8791a1;padding:55px 10px">No saved scans yet.</div>`}
$$("nav button").forEach(b=>b.onclick=()=>{if(b.dataset.nav==="home")show("home");else if(b.dataset.nav==="scan")show("scan");else if(b.dataset.nav==="collection"){show("collection");render()}else{$("#more").classList.add("open")}});
$("#closeMore").onclick=()=>$("#more").classList.remove("open");$("#help").onclick=()=>toast("Use straight-on lighting first; angled light helps reveal surface scratches.");
$("#torch").onclick=()=>toast("Flash/torch control will be connected to native camera APIs in the iPhone build.");$("#share").onclick=()=>toast("Shareable grading reports are next.");
function toast(t){const x=$("#toast");x.textContent=t;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),2200)}render();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
