import { execFileSync } from 'node:child_process';
import { createWriteStream, openAsBlob } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { newProject, packProject, uid, unpackProject, validateProject } from '../replay-studio/dist/core.js';

const [video, input, output] = process.argv.slice(2);
if (!video || !input || !output) throw Error('Usage: node agent/export-replay.mjs VIDEO EVENTS_JSON OUTPUT.replay');
const data = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
if (data.profile !== 'mobile-hypercasual' || !data.basis?.trim() || !Array.isArray(data.events)) {
  throw Error('Expected mobile-hypercasual profile, classification basis and events array.');
}
const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=avg_frame_rate:format=duration,format_name', '-of', 'json', path.resolve(video)], {encoding:'utf8'}));
const [num, den] = info.streams[0].avg_frame_rate.split('/').map(Number);
const types = {'.mp4':'video/mp4', '.mov':'video/quicktime', '.webm':'video/webm', '.mkv':'video/x-matroska'};
const file = await openAsBlob(video, {type:types[path.extname(video).toLowerCase()] || 'application/octet-stream'});
const clip = {id:uid(), name:path.basename(video), size:file.size, type:file.type,
  duration:Number(info.format.duration), fps:num/den};
const project = newProject();
project.name = path.basename(output, '.replay');
project.clips = [clip];
project.tracks = [
  ['局内玩法','#64d6c2'], ['局外系统','#e7ad68'], ['关卡','#a99aef'],
  ['IAA','#f78897'], ['加载及教程','#7fb6f0']
].map(([name,color]) => ({id:uid(), name, color}));
project.markers = data.events.map(({time,track,text,evidence}, index) => {
  const target = project.tracks.find(t => t.name === track);
  if (!target || typeof evidence !== 'string' || !evidence.trim()) throw Error('Invalid track or missing evidence at event '+index);
  return {id:uid(), clipId:clip.id, trackId:target.id, time, text};
}).sort((a,b) => a.time-b.time);
validateProject(project);
const packed = packProject(project, new Map([[clip.id,{file}]]), true);
const directory = path.dirname(output);
await mkdir(directory,{recursive:true});
const staging = await mkdtemp(path.join(directory,'.replay-'));
const temp = path.join(staging,'project');
try {
  await pipeline(Readable.fromWeb(packed.stream()),createWriteStream(temp));
  const check = await unpackProject(await openAsBlob(temp));
  if (JSON.stringify(check.project) !== JSON.stringify(project) || check.files.get(clip.id)?.size !== file.size) {
    throw Error('Round-trip verification failed.');
  }
  await link(temp,output);
  console.log(output, project.tracks.length+' tracks, '+project.markers.length+' markers');
} finally {
  await rm(staging,{recursive:true,force:true});
}
