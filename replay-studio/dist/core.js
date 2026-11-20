export const uid = () => globalThis.crypto.randomUUID();
export const clone = value => JSON.parse(JSON.stringify(value));
export const clamp = (x,a,b) => Math.min(b,Math.max(a,x));
export function newProject() {
  return {format:'frame-trace',version:1,name:'未命名研究',clips:[],tracks:[
    {id:uid(),name:'操作与反馈',color:'#64d6c2'},
    {id:uid(),name:'关卡与节奏',color:'#a99aef'},
    {id:uid(),name:'体验观察',color:'#e7ad68'}
  ],markers:[],rules:[{start:0,step:10},{start:60,step:60},{start:1800,step:600}]};
}
export function timeline(project) {
  let start=0;
  return project.clips.map(clip => {const row={...clip,start,end:start+clip.duration};start=row.end;return row;});
}
export const duration = p => p.clips.reduce((n,c)=>n+c.duration,0);
export function clipAt(p,time) {
  const clips=timeline(p);
  return clips.find(c=>time>=c.start && time<c.end) || (time>=duration(p)?clips.at(-1):clips[0]);
}
export function markerTime(p,m) {const c=timeline(p).find(c=>c.id===m.clipId);return c?c.start+m.time:0;}
export function timecode(seconds,millis=false) {
  const n=Math.max(0,Math.round(seconds*1000)), s=Math.floor(n/1000);
  return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':')+(millis?'.'+String(n%1000).padStart(3,'0'):'');
}
export function parseTime(text) {
  if(typeof text==='number') return text;
  const parts=String(text).trim().split(':');
  if(parts.length>3||parts.some(x=>!/^\d+(\.\d+)?$/.test(x))) return NaN;
  return parts.reduce((a,b)=>a*60+Number(b),0);
}
export function validateRules(rules) {
  if(!Array.isArray(rules)||!rules.length) throw Error('至少需要一段时间规则。');
  if(rules[0].start!==0) throw Error('第一段必须从 0 秒开始。');
  rules.forEach((r,i)=>{
    if(!Number.isFinite(r.start)||r.start<0||!Number.isFinite(r.step)||r.step<0.001) throw Error('起点必须为非负时间，粒度须至少 0.001 秒。');
    if(i&&r.start<=rules[i-1].start) throw Error('每段的起点必须严格递增。');
  });
}
export function makeBins(total,rules) {
  validateRules(rules);
  if(!Number.isFinite(total)||total<0) throw Error('总时长无效。');
  const bins=[];
  rules.forEach((rule,i)=>{
    const end=Math.min(total,rules[i+1]?.start??total);
    if(end<=rule.start) return;
    const count=Math.ceil((end-rule.start)/rule.step-1e-10);
    if(count+bins.length>16383) throw Error('分段超过 Excel 的 16,383 个时间列，请增大时间粒度。');
    for(let n=0;n<count;n++) bins.push({start:rule.start+n*rule.step,end:Math.min(end,rule.start+(n+1)*rule.step)});
  });
  return bins;
}
export function binFor(bins,time) {
  // Intervals are left-closed and right-open, with the project endpoint in the last bin.
  let lo=0,hi=bins.length-1;
  while(lo<=hi) {const mid=(lo+hi)>>1;const b=bins[mid];if(time<b.start) hi=mid-1;else if(time>=b.end) lo=mid+1;else return mid;}
  return bins.length&&Math.abs(time-bins.at(-1).end)<1e-7?bins.length-1:-1;
}
export function exportRows(project,rules=project.rules) {
  const bins=makeBins(duration(project),rules);
  const fine=bins.some(b=>b.start%1||b.end%1);
  const matrix=[['轨道 / 时间',...bins.map(b=>`${timecode(b.start,fine)} – ${timecode(b.end,fine)}`)]];
  const rows=new Map(project.tracks.map(t=>[t.id,[t.name,...bins.map(()=>[])]]));
  const ordered=[...project.markers].sort((a,b)=>markerTime(project,a)-markerTime(project,b));
  const detail=[['轨道','全局时间','全局秒数','视频片段','片段内时间','片段内秒数','标记内容']];
  for(const m of ordered) {
    const t=markerTime(project,m),bin=binFor(bins,t),track=project.tracks.find(x=>x.id===m.trackId),clip=project.clips.find(x=>x.id===m.clipId);
    if(bin>=0&&rows.has(m.trackId)) rows.get(m.trackId)[bin+1].push(`[${timecode(t,true)}] ${m.text}`);
    detail.push([track?.name??'',timecode(t,true),t,clip?.name??'',timecode(m.time,true),m.time,m.text]);
  }
  matrix.push(...[...rows.values()].map(r=>[r[0],...r.slice(1).map(c=>c.join('\n\n'))]));
  if(matrix.some(row=>row.some(cell=>String(cell).length>32767))) throw Error('某个汇总单元格超过 Excel 的 32,767 字符限制，请缩小时间粒度。');
  return {bins,matrix,detail};
}
export function validateProject(raw) {
  if(!raw||raw.format!=='frame-trace'||raw.version!==1) throw Error('不是支持的帧迹工程文件（版本 1）。');
  const p=clone(raw);
  if(typeof p.name!=='string'||!Array.isArray(p.clips)||!Array.isArray(p.tracks)||!Array.isArray(p.markers)) throw Error('工程结构不完整。');
  const unique=arr=>arr.every(x=>typeof x.id==='string'&&x.id.length>0)&&new Set(arr.map(x=>x.id)).size===arr.length;
  if(!unique(p.clips)||!unique(p.tracks)||!unique(p.markers)) throw Error('工程中存在重复或无效标识。');
  for(const c of p.clips) if(typeof c.name!=='string'||!Number.isFinite(c.duration)||c.duration<=0||!Number.isFinite(c.fps)||c.fps<1||c.fps>240||!Number.isSafeInteger(c.size)||c.size<0) throw Error('片段信息无效。');
  for(const t of p.tracks) if(typeof t.name!=='string'||!t.name.trim()||!/^#[0-9a-f]{6}$/i.test(t.color)) throw Error('轨道信息无效。');
  for(const m of p.markers) {
    const c=p.clips.find(c=>c.id===m.clipId);
    if(!c||!p.tracks.some(t=>t.id===m.trackId)||!Number.isFinite(m.time)||m.time<0||m.time>c.duration||typeof m.text!=='string'||!m.text.trim()||m.text.length>30000) throw Error('标记信息无效。');
  }
  validateRules(p.rules);
  return p;
}
export function nextColor(tracks) {
  for(let n=tracks.length;n<tracks.length+10000;n++) {
    const h=(n*137.508+160)%360,s=.55,l=.63;
    const a=s*Math.min(l,1-l),f=k=>{k=(k+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
    const color='#'+[f(0),f(8),f(4)].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
    if(!tracks.some(t=>t.color===color)) return color;
  }
}
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const MAGIC='FRAMETRACE01';
export function packProject(project,media,embed,view={}) {
  const entries=[];let offset=0;
  if(embed) for(const c of project.clips) {
    const file=media.get(c.id)?.file;
    if(!file) throw Error(`缺少视频「${c.name}」，请先重新关联，或保存轻量工程。`);
    entries.push({id:c.id,offset,size:file.size,type:file.type});offset+=file.size;
  }
  const json=encoder.encode(JSON.stringify({project,entries,view,savedAt:new Date().toISOString()}));
  const head=new Uint8Array(16);head.set(encoder.encode(MAGIC));new DataView(head.buffer).setUint32(12,json.length,true);
  return new Blob([head,json,...entries.map(e=>media.get(e.id).file)],{type:'application/octet-stream'});
}
export async function unpackProject(file) {
  const head=new Uint8Array(await file.slice(0,16).arrayBuffer());
  if(head.length!==16||decoder.decode(head.slice(0,12))!==MAGIC) throw Error('文件不是帧迹工程。');
  const size=new DataView(head.buffer).getUint32(12,true);
  if(size>50*1024*1024||size+16>file.size) throw Error('工程文件头损坏。');
  const manifest=JSON.parse(await file.slice(16,16+size).text());
  const p=validateProject(manifest.project),files=new Map();
  if(!Array.isArray(manifest.entries)) throw Error('工程媒体索引无效。');
  const seen=new Set();let lastEnd=0;
  for(const e of manifest.entries) {
    const clip=p.clips.find(c=>c.id===e.id);
    if(!clip||seen.has(e.id)||!Number.isSafeInteger(e.offset)||!Number.isSafeInteger(e.size)||e.offset<lastEnd||e.size!==clip.size||16+size+e.offset+e.size>file.size) throw Error('工程内的视频数据不完整。');
    seen.add(e.id);lastEnd=e.offset+e.size;
    files.set(e.id,file.slice(16+size+e.offset,16+size+e.offset+e.size,typeof e.type==='string'?e.type:''));
  }
  const v=manifest.view||{};
  const view={current:Number.isFinite(v.current)?clamp(v.current,0,duration(p)):0,selectedTrack:p.tracks.some(t=>t.id===v.selectedTrack)?v.selectedTrack:p.tracks[0]?.id,scale:Number.isFinite(v.scale)&&v.scale>0&&v.scale<10000?v.scale:null};
  return {project:p,files,view};
}
