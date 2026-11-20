import {uid,clone,clamp,newProject,timeline,duration,clipAt,markerTime,timecode,parseTime,makeBins,exportRows,validateProject,nextColor,packProject,unpackProject} from './core.js';
import {buildWorkbook} from './xlsx.js';

const $=id=>document.getElementById(id);
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const video=$('video'), media=new Map(), DRAFT='frame-trace-draft-v1';
let project=newProject(), current=0, activeId=null, selectedTrack=project.tracks[0].id, editing=null;
let playing=false, scale=1, undoStack=[],redoStack=[],savedSnapshot=JSON.stringify(project),toastTimer,draftTimer,dragId=null,busy=false;
let sourceGeneration=0, pendingSeek=null;
let markerSaveTimer, composingMarker=false, pointerActive=false, pendingEditorRender=false;
const safeName=()=>project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').trim()||'未命名研究';
const dirty=()=>JSON.stringify(project)!==savedSnapshot;
function toast(message,error=false) {$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:4200);}
function report(error){console.error(error);toast(error.message||String(error),true);}
function persistDraft(){try{localStorage.setItem(DRAFT,JSON.stringify({project,current,selectedTrack,scale,savedAt:new Date().toISOString()}));$('save-status').textContent='● 已自动备份标注';}catch{$('save-status').textContent='自动备份失败，请保存工程';}}
function autosave(){clearTimeout(draftTimer);$('save-status').textContent='正在自动备份…';draftTimer=setTimeout(persistDraft,300);}
function checkpoint(){undoStack.push(clone(project));if(undoStack.length>100)undoStack.shift();redoStack=[];}
function changed(){autosave();render();}
function mutate(fn){checkpoint();fn();changed();}
function undo(redo=false){const from=redo?redoStack:undoStack,to=redo?undoStack:redoStack;if(!from.length)return;to.push(clone(project));project=from.pop();resetEditor();current=clamp(current,0,duration(project));if(!project.tracks.some(t=>t.id===selectedTrack))selectedTrack=project.tracks[0]?.id;changed();seek(current);}
function modal(title,description,body,actions=''){ $('modal-content').innerHTML=`<div class="modal-header"><h2>${escape(title)}</h2><button class="dialog-close" aria-label="关闭">×</button></div><p class="modal-description">${description}</p>${body}${actions?`<div class="modal-actions">${actions}</div>`:''}`;$('modal-content').querySelector('.dialog-close').onclick=()=> $('modal').close();$('modal').showModal();}
function closeModal(){$('modal').close();}
function resetEditor(){clearTimeout(markerSaveTimer);editing=null;$('delete-editing-marker').hidden=true;$('marker-text').value='';$('editor-mode').textContent='在当前时间打标';$('cancel-edit').hidden=true;$('save-marker').hidden=false;$('save-marker').textContent='＋ 添加标记';$('marker-save-hint').textContent='Ctrl / ⌘ + Enter 保存标记';$('marker-at').value=timecode(current,true);}
function render(){
  $('project-name').value=project.name;$('clip-count').textContent=project.clips.length;$('marker-count').textContent=project.markers.length;
  $('timeline-summary').textContent=`${project.clips.length} 段视频 · ${project.tracks.length} 条轨道`;
  $('total-time').textContent=timecode(duration(project));
  $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
  $('play').disabled=!project.clips.length;$('prev-frame').disabled=!project.clips.length;$('next-frame').disabled=!project.clips.length;
  $('marker-track').innerHTML=project.tracks.map(t=>`<option value="${escape(t.id)}">${escape(t.name)}</option>`).join('');
  if(!project.tracks.some(t=>t.id===selectedTrack))selectedTrack=project.tracks[0]?.id;
  $('marker-track').value=(editing?project.markers.find(m=>m.id===editing)?.trackId:selectedTrack)||'';
  if(!editing){$('editor-mode').textContent='在当前时间打标';$('cancel-edit').hidden=true;$('save-marker').textContent='＋ 添加标记';}
  renderClips();renderMarkers();renderTimeline();syncTime();
}
function renderClips(){
  $('clip-list').innerHTML=project.clips.length?project.clips.map((c,i)=>`<div class="clip-card ${c.id===activeId?'active':''}" draggable="true" data-clip="${escape(c.id)}"><div class="clip-title"><span class="clip-index">${String(i+1).padStart(2,'0')}</span><span class="clip-name" title="${escape(c.name)}">${escape(c.name)}</span></div><div class="clip-meta"><span>${timecode(c.duration)}</span><span>${(c.size/1048576).toFixed(1)} MB</span></div>${media.has(c.id)?'':'<div class="missing-text">◌ 原视频未关联</div>'}<div class="clip-tools"><button data-move="-1" title="前移" ${i===0?'disabled':''}>↑</button><button data-move="1" title="后移" ${i===project.clips.length-1?'disabled':''}>↓</button><label title="按源视频 FPS 设置逐帧步长；可变帧率为近似定位">FPS <input data-fps type="number" min="1" max="240" step="0.001" value="${c.fps}" aria-label="${escape(c.name)} 帧率"></label><button class="delete-clip" data-delete-clip title="移除片段" aria-label="移除 ${escape(c.name)}">×</button></div></div>`).join(''):'<div class="clip-empty">你的素材库还是空的<br><span class="micro">从一段游戏录屏开始</span></div>';
  $('relink').hidden=project.clips.every(c=>media.has(c.id));
}
function renderMarkers(){
  const query=$('search-markers').value.trim().toLowerCase();
  const notes=[...project.markers].sort((a,b)=>markerTime(project,a)-markerTime(project,b)).filter(m=>!query||(m.text+' '+project.tracks.find(t=>t.id===m.trackId)?.name).toLowerCase().includes(query));
  $('marker-list').innerHTML=notes.length?notes.map(m=>{const t=project.tracks.find(t=>t.id===m.trackId);return `<article class="note-card" style="--track:${t.color}" data-marker="${escape(m.id)}"><div class="note-card-head"><span>${escape(t.name)}</span><button data-seek-marker>${timecode(markerTime(project,m),true)}</button></div><p data-edit-marker>${escape(m.text)}</p><div class="note-card-foot"><button data-edit-marker>编辑</button><button data-delete-marker>删除</button></div></article>`;}).join(''):`<div class="note-empty">${query?'没有匹配的标记':'还没有标记记录<br>播放到关键时刻，按 M 记录观察'}</div>`;
}
function labelWidth(){return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--label-width'));}
function tickStep(){return [.1,.2,.5,1,2,5,10,15,30,60,120,300,600,1800,3600,7200,14400,86400].find(s=>s*scale>=75)||86400;}
function renderTimeline(){
  const total=duration(project)||120,width=Math.max($('timeline-scroll').clientWidth-labelWidth()-2,total*scale+60),step=tickStep();
  const grid=$('timeline-grid');grid.style.width=`${width+labelWidth()}px`;grid.style.setProperty('--tick-width',`${step*scale}px`);
  const lane=(cls,label,content,height='')=>`<div class="timeline-row ${cls}" ${height?`style="height:${height}px"`:''}><div class="timeline-label">${label}</div><div class="timeline-content ${cls==='ruler-row'?'ruler':''}" style="width:${width}px">${content}</div></div>`;
  let ticks='';for(let t=0;t<=total+step&&t*scale<width;t+=step)ticks+=`<div class="tick" style="left:${t*scale}px"><span>${timecode(t,step<1)}</span></div>`;
  let html=lane('ruler-row','总时间 / TIMECODE',ticks);
  html+=lane('video-row','▤ <span>视频序列</span>',project.clips.length?timeline(project).map((c,i)=>`<div class="timeline-clip ${c.id===activeId?'active':''}" data-clip="${escape(c.id)}" draggable="true" style="left:${c.start*scale}px;width:${Math.max(4,c.duration*scale-3)}px" title="${escape(c.name)} · 拖动调整顺序"><b>${String(i+1).padStart(2,'0')}</b><span>${escape(c.name)}</span></div>`).join(''):'<div class="timeline-empty">导入的视频将按顺序出现在这里</div>');
  html+=lane('track-heading-row','<button id="add-track" class="outlined">＋ 添加轨道</button>','');
  for(const track of project.tracks){
    const ends=[];let chips='';
    for(const m of project.markers.filter(m=>m.trackId===track.id).sort((a,b)=>markerTime(project,a)-markerTime(project,b))){
      const x=markerTime(project,m)*scale,chipWidth=Math.min(175,Math.max(35,m.text.length*8+26));
      let row=ends.findIndex(end=>end+6<x);if(row<0)row=ends.length;ends[row]=x+chipWidth;
      chips+=`<button class="marker-chip" data-marker="${escape(m.id)}" style="--track:${track.color};left:${x}px;top:${12+row*33}px;width:${chipWidth}px" title="${timecode(markerTime(project,m),true)} · ${escape(m.text)}">${escape(m.text)}</button>`;
    }
    html+=`<div class="timeline-row track-row" data-track="${escape(track.id)}" style="height:${Math.max(52,ends.length*33+20)}px"><div class="timeline-label ${selectedTrack===track.id?'active':''}" style="--track:${track.color}"><span class="track-dot"></span><span class="track-name" title="${escape(track.name)}">${escape(track.name)}</span><button data-edit-track aria-label="编辑轨道 ${escape(track.name)}">⋯</button></div><div class="timeline-content" style="width:${width}px">${chips}</div></div>`;
  }
  html+='<div class="playhead" id="playhead"><div class="playhead-handle" title="拖动播放头"></div></div>';grid.innerHTML=html;syncTime();
}
function syncTime(){
  if(document.activeElement!==$('seek-time'))$('seek-time').value=timecode(current,true);
  if(!editing&&document.activeElement!==$('marker-at'))$('marker-at').value=timecode(current,true);
  const head=$('playhead');if(head)head.style.left=`${labelWidth()+current*scale}px`;
  const c=clipAt(project,current);$('frame-info').textContent=c?`${c.fps} FPS 步进 · 片段内 ${timecode(clamp(current-c.start,0,c.duration),true)}`:'逐帧步进 · 导入后可设置片段 FPS';
}
function pause(){playing=false;video.pause();$('play').textContent='▶';$('play').setAttribute('aria-label','播放');}
async function resume(){if(!project.clips.length)return;if(current>=duration(project)-.001)seek(0);const c=clipAt(project,current);if(!c||!media.has(c.id)){toast('请先关联当前片段的原视频。',true);return;}playing=true;$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','暂停');try{await video.play();}catch(e){if(e.name!=='AbortError'){pause();toast('无法播放此视频，请确认浏览器支持它的编码。',true);}}}
function seek(t,keepPlaying=false){
  if(!keepPlaying)pause();current=clamp(t,0,duration(project));const c=clipAt(project,current);
  if(!c){activeId=null;video.removeAttribute('src');video.load();$('empty-preview').hidden=false;$('missing-preview').hidden=true;$('video-badge').hidden=true;$('active-clip-name').textContent='等待导入素材';syncTime();return;}
  const source=media.get(c.id),changedSource=activeId!==c.id||video.dataset.url!==(source?.url||'');
  const local=clamp(current-c.start,0,Math.max(0,c.duration-.00001));
  $('empty-preview').hidden=true;$('missing-preview').hidden=!!source;$('video-badge').hidden=!source;$('missing-name').textContent=c.name;$('active-clip-name').textContent=c.name;
  if(changedSource){
    activeId=c.id;sourceGeneration++;const generation=sourceGeneration;
    video.pause();video.dataset.url=source?.url||'';pendingSeek=local;
    video.onloadedmetadata=()=>{if(generation!==sourceGeneration)return;video.currentTime=pendingSeek??0;pendingSeek=null;video.playbackRate=Number($('playback-rate').value);if(playing)resume();};
    if(source)video.src=source.url;else{video.removeAttribute('src');video.load();pause();}
    renderClips();document.querySelectorAll('.timeline-clip').forEach(el=>el.classList.toggle('active',el.dataset.clip===activeId));
  }else if(source){if(video.readyState>=1)video.currentTime=local;else pendingSeek=local;}
  syncTime();if(keepPlaying&&source&&video.readyState>=1)resume();
}
function frame(delta){const c=clipAt(project,current);if(c)seek(current+delta/c.fps);}
function playbackLoop(){if(playing&&video.readyState>=2&&!video.seeking){const c=timeline(project).find(c=>c.id===activeId);if(c){current=clamp(c.start+video.currentTime,0,duration(project));syncTime();const x=current*scale,label=labelWidth(),s=$('timeline-scroll');if(x+label>s.scrollLeft+s.clientWidth-40)s.scrollLeft=Math.max(0,x-s.clientWidth*.45);}}requestAnimationFrame(playbackLoop);}
video.addEventListener('ended',()=>{const clips=timeline(project),index=clips.findIndex(c=>c.id===activeId);if(index<clips.length-1){seek(clips[index+1].start,true);}else{current=duration(project);pause();syncTime();}});
video.addEventListener('error',()=>{if(video.getAttribute('src')){pause();toast('浏览器无法解码当前视频。建议使用 H.264 编码的 MP4 或 WebM。标记和工程不会受影响。',true);}});
function metadata(file){return new Promise((resolve,reject)=>{const el=document.createElement('video'),url=URL.createObjectURL(file);const finish=(err)=>{clearTimeout(timer);const d=el.duration;el.onloadedmetadata=el.onerror=null;el.removeAttribute('src');el.load();URL.revokeObjectURL(url);err?reject(err):resolve(d);};const timer=setTimeout(()=>finish(Error(`读取「${file.name}」超时。`)),20000);el.preload='metadata';el.onloadedmetadata=()=>Number.isFinite(el.duration)&&el.duration>0?finish():finish(Error(`「${file.name}」的时长不可用。`));el.onerror=()=>finish(Error(`无法读取「${file.name}」，请使用浏览器可解码的视频。`));el.src=url;});}
function addMedia(id,file){const previous=media.get(id);if(previous)URL.revokeObjectURL(previous.url);media.set(id,{file,url:URL.createObjectURL(file)});}
async function importVideos(files){
  if(busy)return;busy=true;pause();const imported=[],errors=[];
  try{for(const file of files){$('bottom-status').textContent=`读取 ${file.name}…`;try{const d=await metadata(file);const id=uid();imported.push({id,name:file.name,size:file.size,lastModified:file.lastModified,duration:d,fps:30});addMedia(id,file);}catch(e){errors.push(e.message);}}
    if(imported.length){mutate(()=>project.clips.push(...imported));fit();seek(timeline(project).find(c=>c.id===imported[0].id).start);toast(`已导入 ${imported.length} 段视频。可在素材卡片中设置源视频 FPS。`);}
    if(errors.length)toast(errors.join(' / '),true);
  }finally{busy=false;$('bottom-status').textContent='准备就绪';$('video-input').value='';}
}
async function relinkVideos(files){
  if(busy)return;busy=true;let count=0;
  try{for(const file of files){const candidates=project.clips.filter(c=>!media.has(c.id)&&c.name===file.name&&c.size===file.size);if(!candidates.length)continue;const d=await metadata(file);for(const c of candidates){if(Math.abs(c.duration-d)<.25){addMedia(c.id,file);count++;}}}render();seek(current);toast(count?`已关联 ${count} 个片段。`:'未找到匹配素材：请选取文件名、大小和时长一致的原视频。',!count);}catch(e){report(e);}finally{busy=false;$('relink-input').value='';}
}
function moveClip(id,to){const from=project.clips.findIndex(c=>c.id===id);if(from<0||to<0||to>=project.clips.length||from===to)return;const before=clipAt(project,current),local=before?current-before.start:0;mutate(()=>{const [clip]=project.clips.splice(from,1);project.clips.splice(to,0,clip);});const target=timeline(project).find(c=>c.id===before?.id);seek(target?target.start+local:0);}
function removeClip(id){const c=project.clips.find(c=>c.id===id),count=project.markers.filter(m=>m.clipId===id).length;if(!confirm(`移除「${c.name}」${count?`及其 ${count} 条标记`:''}？可以撤销。`))return;pause();if(project.markers.some(m=>m.id===editing&&m.clipId===id))resetEditor();mutate(()=>{project.clips=project.clips.filter(c=>c.id!==id);project.markers=project.markers.filter(m=>m.clipId!==id);});seek(Math.min(current,duration(project)));}
function startMarker(track=selectedTrack){if(!project.clips.length){toast('先导入一段视频，再添加标记。',true);return;}if(!project.tracks.length){trackDialog();return;}pause();resetEditor();selectedTrack=track;$('marker-track').value=track;$('marker-text').focus();}
function editMarker(id){clearTimeout(markerSaveTimer);const m=project.markers.find(m=>m.id===id);if(!m)return;seek(markerTime(project,m));editing=id;selectedTrack=m.trackId;$('marker-track').value=m.trackId;$('marker-text').value=m.text;$('marker-at').value=timecode(markerTime(project,m),true);$('editor-mode').textContent='编辑标记';$('cancel-edit').hidden=false;$('cancel-edit').textContent='完成编辑';$('save-marker').hidden=true;$('delete-editing-marker').hidden=false;$('marker-save-hint').textContent='停止输入或离开输入框后自动保存';$('marker-text').focus();}
function deleteMarker(id){
  if(!project.markers.some(m=>m.id===id))return;
  if(editing===id)resetEditor();
  mutate(()=>project.markers=project.markers.filter(m=>m.id!==id));
  toast('标记已删除，可撤销恢复。');
}
function saveMarker(auto=false){
  clearTimeout(markerSaveTimer);
  if(auto&&!editing)return;
  const text=$('marker-text').value.trim(),t=parseTime($('marker-at').value),trackId=$('marker-track').value;
  if(!text){toast('请填写标记内容。',true);$('marker-text').focus();return;}
  if(!project.tracks.some(x=>x.id===trackId)){toast('请先添加并选择轨道。',true);return;}
  if(!Number.isFinite(t)||t<0||t>duration(project)||!project.clips.length){toast('标记时间必须位于视频时间轴内。',true);return;}
  const c=clipAt(project,t),m={id:editing||uid(),trackId,clipId:c.id,time:clamp(t-c.start,0,c.duration),text};
  if(auto){
    const index=project.markers.findIndex(x=>x.id===editing);if(index<0)return;
    const previous=project.markers[index];
    if(previous.text===m.text&&previous.trackId===m.trackId&&previous.clipId===m.clipId&&Math.abs(previous.time-m.time)<.00051)return;
    checkpoint();project.markers[index]=m;autosave();
    // Keep the pointer's target alive until its click completes (switching notes, deleting, etc.).
    if(pointerActive)pendingEditorRender=true;else render();
    $('marker-save-hint').textContent='已自动保存';return;
  }
  mutate(()=>{if(editing)project.markers[project.markers.findIndex(x=>x.id===editing)]=m;else project.markers.push(m);});resetEditor();renderMarkers();toast('标记已保存');
}
function trackDialog(id){
  const track=project.tracks.find(t=>t.id===id),color=track?.color||nextColor(project.tracks);
  modal(track?'编辑轨道':'添加研究轨道','轨道用于分类观察；每条轨道有独立的名称和颜色。',`<div class="field"><label for="track-name-input">轨道名称</label><input id="track-name-input" maxlength="80" placeholder="例如：战斗系统、商业化、新手引导" value="${escape(track?.name||'')}"></div><div class="field"><label for="track-color-input">轨道颜色</label><input id="track-color-input" type="color" value="${color}"></div>${track?'<div class="field"><button id="track-up" class="outlined">↑ 轨道上移</button> <button id="track-down" class="outlined">↓ 轨道下移</button></div>':''}<p id="track-error" class="error-text"></p>`,`${track?'<button id="remove-track" style="color:#edac99;margin-right:auto">删除轨道</button>':''}<button id="track-cancel">取消</button><button id="track-submit" class="primary">${track?'保存修改':'创建轨道'}</button>`);
  $('track-cancel').onclick=closeModal;$('track-name-input').focus();
  $('track-submit').onclick=()=>{const name=$('track-name-input').value.trim(),value=$('track-color-input').value;if(!name){$('track-error').textContent='请填写轨道名称。';return;}if(project.tracks.some(t=>t.id!==id&&(t.color===value||t.name===name))){$('track-error').textContent='请使用未被其他轨道占用的名称和颜色。';return;}mutate(()=>{if(track){track.name=name;track.color=value;}else{const t={id:uid(),name,color:value};project.tracks.push(t);selectedTrack=t.id;}});closeModal();};
  if(track){$('remove-track').onclick=()=>{const count=project.markers.filter(m=>m.trackId===id).length;if(!confirm(`删除轨道「${track.name}」及 ${count} 条标记？可以撤销。`))return;mutate(()=>{project.tracks=project.tracks.filter(t=>t.id!==id);project.markers=project.markers.filter(m=>m.trackId!==id);});resetEditor();closeModal();};
    const index=project.tracks.indexOf(track);$('track-up').disabled=index===0;$('track-down').disabled=index===project.tracks.length-1;
    for(const [button,d]of [['track-up',-1],['track-down',1]])$(button).onclick=()=>{mutate(()=>{project.tracks.splice(index,1);project.tracks.splice(index+d,0,track);});closeModal();};
  }
}
function fit(){const total=duration(project)||120;scale=Math.max(.001,($('timeline-scroll').clientWidth-labelWidth()-60)/total);$('zoom').value=clamp(Math.log2(scale/.02)*8,0,100);$('timeline-scroll').scrollLeft=0;renderTimeline();}
function zoomTo(value){const old=scale;scale=.02*2**(Number(value)/8);$('zoom').value=value;renderTimeline();$('timeline-scroll').scrollLeft=Math.max(0,($('timeline-scroll').scrollLeft+current*old)*scale/old-current*old);}
function confirmReplace(){if(busy){toast('正在读取视频，请稍候。');return false;}return !dirty()||confirm('当前工程有未保存到文件的修改。继续将替换工作区，请先确认已保存需要保留的工程。');}
function clearMedia(){for(const m of media.values())URL.revokeObjectURL(m.url);media.clear();activeId=null;video.dataset.url='';}
function loadProject(p,files=new Map(),view={}){pause();clearMedia();project=p;for(const [id,file]of files)addMedia(id,file);current=clamp(view.current||0,0,duration(p));selectedTrack=p.tracks.some(t=>t.id===view.selectedTrack)?view.selectedTrack:p.tracks[0]?.id;undoStack=[];redoStack=[];savedSnapshot=JSON.stringify(p);resetEditor();render();if(view.scale>0&&view.scale<10000){scale=view.scale;$('zoom').value=clamp(Math.log2(scale/.02)*8,0,100);renderTimeline();}else fit();seek(current);autosave();$('draft-banner').hidden=true;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function saveDialog(){
  if(busy){toast('正在读取视频，请稍候。');return;}
  const total=project.clips.reduce((n,c)=>n+c.size,0);
  modal('保存研究工程','选择适合你的保存方式。两种文件都保留视频顺序、轨道、标记和 Excel 分段规则。',`<label class="save-option"><input type="radio" name="save-mode" value="light" checked><span><strong>轻量工程 <span class="muted">.replay</span></strong><small>仅保存研究数据，文件小。重新打开时，选择原视频即可恢复画面。适合日常保存。</small></span></label><label class="save-option"><input type="radio" name="save-mode" value="full"><span><strong>完整工程 <span class="muted">.replay</span></strong><small>包含全部原视频，约 ${(total/1048576).toFixed(1)} MB。一个文件即可移交给同事，打开后继续工作。</small></span></label><p class="muted small">浏览器也会自动备份标注。跨设备或交接工作请保存工程文件。</p>`,'<button id="save-cancel">取消</button><button id="save-confirm" class="primary">保存工程文件</button>');
  $('save-cancel').onclick=closeModal;
  $('save-confirm').onclick=async()=>{const embed=document.querySelector('input[name="save-mode"]:checked').value==='full';const snapshot=clone(project);let writable;
    try{
      const blob=packProject(snapshot,media,embed,{current,selectedTrack,scale});
      if(typeof window.showSaveFilePicker==='function'){const handle=await window.showSaveFilePicker({suggestedName:safeName()+'.replay',types:[{description:'帧迹工程',accept:{'application/octet-stream':['.replay']}}]});$('save-confirm').disabled=true;$('save-confirm').textContent='正在保存…';writable=await handle.createWritable();await blob.stream().pipeTo(writable);}
      else download(blob,safeName()+'.replay');
      savedSnapshot=JSON.stringify(snapshot);$('save-status').textContent='工程文件已保存';closeModal();toast(embed?'完整工程已保存，包含原视频。':'轻量工程已保存，请保留原视频以便重新关联。');
    }catch(e){if(e.name!=='AbortError')report(e);}finally{if($('save-confirm')){$('save-confirm').disabled=false;$('save-confirm').textContent='保存工程文件';}}
  };
}
function exportDialog(){
  if(!project.clips.length){toast('请先导入视频，建立研究时间轴。',true);return;}
  modal('导出研究时间表','横轴是时间分段，纵轴是研究轨道。同格多条标记会全部保留，并附精确时间。',`<div class="rule-header"><span>从什么时候开始（时:分:秒）</span><span>每格时长（秒）</span><span></span></div><div id="rule-list"></div><button id="add-rule" class="link-button">＋ 增加一个时间分段</button><div id="export-error" class="error-text"></div><div id="export-preview" class="export-preview"></div><p class="muted small" style="margin-top:13px">导出含「时间轴标注」「标记明细」「导出说明」三个工作表。</p>`,'<button id="export-cancel">取消</button><button id="export-confirm" class="primary">下载 .xlsx</button>');
  const ruleList=$('rule-list');
  function row(rule,i){return `<div class="rule-row"><input data-start value="${timecode(rule.start,rule.start%1!==0)}" aria-label="第 ${i+1} 段起点" ${i===0?'readonly':''}><input data-step type="number" min="0.001" step="any" value="${rule.step}" aria-label="第 ${i+1} 段粒度"><button data-remove-rule ${i===0?'disabled':''} aria-label="删除时间分段">×</button></div>`;}
  ruleList.innerHTML=project.rules.map(row).join('');
  const getRules=()=>[...ruleList.children].map(el=>({start:parseTime(el.querySelector('[data-start]').value),step:Number(el.querySelector('[data-step]').value)}));
  function preview(){try{const {bins,matrix}=exportRows(project,getRules());$('export-error').textContent='';$('export-confirm').disabled=false;$('export-preview').innerHTML=`<p>${bins.length} 个时间格 · ${project.tracks.length} 条轨道 · ${project.markers.length} 条标记</p><div style="overflow:auto"><table class="mini-table">${matrix.slice(0,4).map((r,i)=>`<tr>${r.slice(0,5).map(c=>`<${i?'td':'th'}>${escape(c||'—')}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</table></div>`;}catch(e){$('export-error').textContent=e.message;$('export-confirm').disabled=true;$('export-preview').innerHTML='';}}
  ruleList.oninput=preview;ruleList.onclick=e=>{if(e.target.closest('[data-remove-rule]')){e.target.closest('.rule-row').remove();preview();}};
  $('add-rule').onclick=()=>{const rules=getRules(),last=rules.at(-1);ruleList.insertAdjacentHTML('beforeend',row({start:(Number.isFinite(last.start)?last.start:0)+Math.max(last.step||60,60),step:(last.step||60)*2},rules.length));preview();};
  $('export-cancel').onclick=closeModal;
  $('export-confirm').onclick=()=>{try{const rules=getRules(),blob=buildWorkbook(project,rules);if(JSON.stringify(rules)!==JSON.stringify(project.rules))mutate(()=>project.rules=rules);download(blob,safeName()+'.xlsx');closeModal();toast('Excel 已导出：时间轴标注、标记明细与导出说明。');}catch(e){report(e);}};preview();
}

for(const id of ['import-video','import-small','import-hero'])$(id).onclick=()=>$('video-input').click();
for(const id of ['relink','relink-preview'])$(id).onclick=()=>$('relink-input').click();
$('video-input').onchange=e=>importVideos([...e.target.files]);$('relink-input').onchange=e=>relinkVideos([...e.target.files]);
$('project-name').onchange=()=>{const name=$('project-name').value.trim()||'未命名研究';mutate(()=>project.name=name);};
$('open-project').onclick=()=>$('project-input').click();$('save-project').onclick=saveDialog;$('export').onclick=exportDialog;
$('project-input').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(!confirmReplace())return;const data=await unpackProject(file);loadProject(data.project,data.files,data.view);toast(data.files.size?'完整工程已恢复，可以继续工作。':'工程已恢复。请选择原视频重新关联画面。');}catch(e){report(e);}finally{$('project-input').value='';}};
$('new-project').onclick=()=>{if(confirmReplace())loadProject(newProject());};
$('play').onclick=()=>playing?pause():resume();$('prev-frame').onclick=()=>frame(-1);$('next-frame').onclick=()=>frame(1);
$('playback-rate').onchange=()=>video.playbackRate=Number($('playback-rate').value);$('mute').onclick=()=>{video.muted=!video.muted;$('mute').textContent=video.muted?'声音 关':'声音 开';};
$('seek-time').onchange=()=>{const t=parseTime($('seek-time').value);if(Number.isFinite(t))seek(t);else{toast('时间格式示例：00:01:23.500 或 83.5。',true);syncTime();}};
$('mark-current').onclick=()=>startMarker();$('save-marker').onclick=()=>saveMarker();$('cancel-edit').onclick=resetEditor;$('marker-track').onchange=()=>{selectedTrack=$('marker-track').value;if(editing)saveMarker(true);else renderTimeline();};$('search-markers').oninput=renderMarkers;
for(const id of ['marker-text','marker-at']){
  $(id).addEventListener('input',()=>{clearTimeout(markerSaveTimer);if(editing&&!composingMarker){$('marker-save-hint').textContent='等待自动保存…';markerSaveTimer=setTimeout(()=>saveMarker(true),600);}});
  $(id).addEventListener('blur',()=>{if(!composingMarker)saveMarker(true);});
}
$('marker-text').addEventListener('compositionstart',()=>{composingMarker=true;clearTimeout(markerSaveTimer);});
$('marker-text').addEventListener('compositionend',()=>{composingMarker=false;clearTimeout(markerSaveTimer);if(editing)markerSaveTimer=setTimeout(()=>saveMarker(true),600);});
document.addEventListener('pointerdown',()=>{pointerActive=true;if(editing&&$('marker-editor').contains(document.activeElement)&&!composingMarker)saveMarker(true);},true);
for(const event of ['pointerup','pointercancel'])document.addEventListener(event,()=>{pointerActive=false;setTimeout(()=>{if(pendingEditorRender){pendingEditorRender=false;render();}},0);},true);
$('fit-timeline').onclick=fit;$('zoom').oninput=e=>zoomTo(e.target.value);$('zoom-out').onclick=()=>zoomTo(Math.max(0,Number($('zoom').value)-8));$('zoom-in').onclick=()=>zoomTo(Math.min(100,Number($('zoom').value)+8));
$('undo').onclick=()=>undo();$('redo').onclick=()=>undo(true);
$('clip-list').onclick=e=>{const card=e.target.closest('[data-clip]');if(!card)return;const id=card.dataset.clip;if(e.target.closest('[data-delete-clip]'))removeClip(id);else if(e.target.closest('[data-move]'))moveClip(id,project.clips.findIndex(c=>c.id===id)+Number(e.target.closest('[data-move]').dataset.move));else if(!e.target.closest('input'))seek(timeline(project).find(c=>c.id===id).start);};
$('clip-list').onchange=e=>{if(!e.target.matches('[data-fps]'))return;const id=e.target.closest('[data-clip]').dataset.clip,n=Number(e.target.value);if(n>=1&&n<=240)mutate(()=>project.clips.find(c=>c.id===id).fps=n);else{toast('FPS 必须在 1–240 之间。',true);renderClips();}};
$('delete-editing-marker').onclick=()=>deleteMarker(editing);
$('marker-list').onclick=e=>{const el=e.target.closest('[data-marker]');if(!el)return;const id=el.dataset.marker,m=project.markers.find(m=>m.id===id);if(e.target.closest('[data-delete-marker]'))deleteMarker(id);else if(e.target.closest('[data-seek-marker]'))seek(markerTime(project,m));else if(e.target.closest('[data-edit-marker]'))editMarker(id);};
for(const area of [$('clip-list'),$('timeline-grid')]){
  area.addEventListener('dragstart',e=>{const clip=e.target.closest('[data-clip]');if(!clip)return;dragId=clip.dataset.clip;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);});
  area.addEventListener('dragover',e=>{if(dragId){e.preventDefault();e.dataTransfer.dropEffect='move';}});
  area.addEventListener('drop',e=>{if(!dragId)return;e.preventDefault();e.stopPropagation();const target=e.target.closest('[data-clip]');if(target)moveClip(dragId,project.clips.findIndex(c=>c.id===target.dataset.clip));else if(e.target.closest('.video-row')||area===$('clip-list'))moveClip(dragId,project.clips.length-1);dragId=null;});
  area.addEventListener('dragend',()=>dragId=null);
}
const grid=$('timeline-grid');let scrubbing=false;
const timeFromPointer=e=>clamp((e.clientX-grid.getBoundingClientRect().left-labelWidth())/scale,0,duration(project));
grid.onpointerdown=e=>{
  if(e.button!==0||e.target.closest('button,[data-clip],.timeline-label')||(!e.target.closest('.timeline-content')&&!e.target.closest('.playhead-handle')))return;
  const track=e.target.closest('[data-track]');if(track){selectedTrack=track.dataset.track;if(!editing)$('marker-track').value=selectedTrack;}
  scrubbing=true;grid.setPointerCapture(e.pointerId);seek(timeFromPointer(e));
};
grid.onpointermove=e=>{if(scrubbing)seek(timeFromPointer(e));};grid.onpointerup=e=>{scrubbing=false;if(grid.hasPointerCapture(e.pointerId))grid.releasePointerCapture(e.pointerId);};grid.onpointercancel=()=>scrubbing=false;
grid.onclick=e=>{if(e.target.closest('#add-track')){trackDialog();return;}const m=e.target.closest('[data-marker]');if(m){editMarker(m.dataset.marker);return;}const t=e.target.closest('[data-track]');if(t&&e.target.closest('[data-edit-track]'))trackDialog(t.dataset.track);else if(t&&e.target.closest('.timeline-label')){selectedTrack=t.dataset.track;if(!editing)$('marker-track').value=selectedTrack;renderTimeline();}else{const clip=e.target.closest('[data-clip]');if(clip)seek(timeFromPointer(e));}};
grid.ondblclick=e=>{const t=e.target.closest('[data-track]');if(t&&!e.target.closest('button,.timeline-label')){seek(timeFromPointer(e));startMarker(t.dataset.track);}};
let dragDepth=0;
document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;document.body.classList.add('dragging-over');}});
document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)document.body.classList.remove('dragging-over');});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',e=>{document.body.classList.remove('dragging-over');dragDepth=0;if(e.dataTransfer.files.length){e.preventDefault();importVideos([...e.dataTransfer.files]);}});
document.addEventListener('keydown',e=>{
  const typing=e.target.matches('input,textarea,select,[contenteditable]'),mod=e.ctrlKey||e.metaKey;
  if($('modal').open)return;
  if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();saveDialog();return;}
  if(mod&&e.key==='Enter'&&e.target===$('marker-text')){e.preventDefault();saveMarker();return;}
  if(typing)return;
  if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return;}
  if(e.code==='Space'){e.preventDefault();playing?pause():resume();}
  else if(e.key==='ArrowLeft'){e.preventDefault();e.shiftKey?seek(current-5):frame(-1);}
  else if(e.key==='ArrowRight'){e.preventDefault();e.shiftKey?seek(current+5):frame(1);}
  else if(e.key.toLowerCase()==='m'){e.preventDefault();startMarker();}
});
window.addEventListener('beforeunload',e=>{if(editing&&!composingMarker)saveMarker(true);if(project.clips.length||project.markers.length)persistDraft();if(dirty()){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(editing&&!composingMarker)saveMarker(true);if(project.clips.length||project.markers.length)persistDraft();}});
window.addEventListener('resize',()=>renderTimeline());
$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const b=$('modal').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeModal();}});
try{const cached=localStorage.getItem(DRAFT);if(cached){const draft=JSON.parse(cached);validateProject(draft.project);if(draft.project.clips.length||draft.project.markers.length){$('draft-banner').hidden=false;$('restore-draft').onclick=()=>{if(confirmReplace())loadProject(validateProject(draft.project),new Map(),draft);};}}}catch{toast('上次自动备份无法读取，请打开已保存的工程文件。',true);}
$('dismiss-draft').onclick=()=>$('draft-banner').hidden=true;
render();fit();requestAnimationFrame(playbackLoop);
