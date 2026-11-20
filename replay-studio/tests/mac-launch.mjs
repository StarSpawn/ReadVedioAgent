import assert from 'node:assert/strict';
import {mock} from 'node:test';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform');
const originalFetch=globalThis.fetch;
const calls=[];
try {
  Object.defineProperty(process,'platform',{value:'darwin'});
  globalThis.fetch=async()=>({ok:true,text:async()=>'<title>帧迹 · 游戏录屏研究台</title>'});
  mock.method(childProcess,'spawn',(command,args)=>{
    calls.push({command,args});const child=new EventEmitter();child.stderr=new EventEmitter();
    queueMicrotask(()=>child.emit('close',0));return child;
  });
  syncBuiltinESMExports();
  await import('../launch.mjs');
  assert.deepEqual(calls,[{command:'/usr/bin/open',args:['http://127.0.0.1:4173']}]);
  console.log('PASS: simulated macOS dispatch uses system open with the local app URL.');
} finally {
  Object.defineProperty(process,'platform',originalPlatform);globalThis.fetch=originalFetch;
  mock.restoreAll();syncBuiltinESMExports();
}
