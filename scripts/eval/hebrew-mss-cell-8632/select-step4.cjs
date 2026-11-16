// PRIOR ART: none — the prereg (v2#8632 comment 6853369726) selection rule for step 4 written as code; judge.mjs/paired-arm.mjs score arms, they do not pick a page's write.
// Step 4 selection per prereg: best judged read per page among arms that clear the floor.
const R=process.argv[2];const fs=require("fs"),path=require("path"),crypto=require("crypto");
const key=require(R+"/key.json");const pk=require(R+"/packet.json").items;const pkBy=Object.fromEntries(pk.map(i=>[i.id,i]));
const rd=f=>fs.existsSync(f)?fs.readFileSync(f,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse):[];
const op=Object.fromEntries(rd(R+"/verdicts-opus.jsonl").map(v=>[v.id,v.verdict]));
const ge={};for(const v of rd(R+"/verdicts-gemini.jsonl"))if(v.verdict)ge[v.id]=v.verdict;
const INV=["O1","O2","I1","I2","I6","T14"];const inv=v=>(v.defects||[]).some(d=>INV.includes(d.class));
const items=key.filter(k=>k.kind==="item");
// floor: count invented pages per arm (Opus judge)
const floor={};for(const k of items){const v=op[k.judged_as];if(!v)continue;floor[k.route]=floor[k.route]||0;if(inv(v))floor[k.route]++}
const clears=r=>floor[r]<3;console.error("floor",floor);
const C=R+"/corr/hebrew-flash3-manuscript";const dir={"opus-read":C+"/opus_read","3flash>opus-correct":C+"/3flash_opus_correct/reads"};
const pages={};for(const k of items)(pages[k.page_id]=pages[k.page_id]||[]).push(k);
const out=[],why={};
for(const [pid,ks] of Object.entries(pages)){
 const st=ks.find(k=>k.route==="3flash");const stF=st&&op[st.judged_as]?op[st.judged_as].fidelity:0;
 const cands=[];
 for(const k of ks){if(!dir[k.route])continue;const v=op[k.judged_as];let r=null;
  if(!clears(k.route))r="arm fails floor";else if(!v)r="no opus verdict";else if(!v.accept)r="opus reject";else if(inv(v))r="invented defect";else if(!(v.fidelity>stF))r="fidelity not above stored";else if(ge[k.judged_as]&&!ge[k.judged_as].accept)r="gemini reject";
  if(r){why[k.route+": "+r]=(why[k.route+": "+r]||0)+1;continue}
  const f=path.join(dir[k.route],pid+".txt");const t=fs.readFileSync(f,"utf8").trim();
  const same=(pkBy[k.judged_as]?.text||pkBy[k.judged_as]?.output||"").trim()===t;
  cands.push({route:k.route,page_id:pid,book_id:k.book_id,page_number:k.page_number,fid:v.fidelity,stored_fid:stF,gemini:ge[k.judged_as]?.accept??null,judged_as:k.judged_as,judged_text_matches_file:same,read_sha256:crypto.createHash("sha256").update(t).digest("hex")});}
 cands.sort((a,b)=>b.fid-a.fid||(a.route==="3flash>opus-correct"?-1:1));if(cands[0])out.push(cands[0]);}
console.error(why);console.error("selected",out.length,out.reduce((s,x)=>(s[x.route]=(s[x.route]||0)+1,s),{}),"textmismatch",out.filter(x=>!x.judged_text_matches_file).length);
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
