import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const url='http://127.0.0.1:4173';
async function ready(){try{const r=await fetch(url,{signal:AbortSignal.timeout(800)});if(!r.ok)return false;return (await r.text()).includes('<title>帧迹 · 游戏录屏研究台</title>');}catch{return false;}}
if(!await ready()){
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});child.unref();
  let started=false;
  for(let i=0;i<30;i++){if(await ready()){started=true;break;}await new Promise(r=>setTimeout(r,200));}
  if(!started){console.error('启动失败：请检查 4173 端口是否被其他程序占用。');process.exit(1);}
}
if(process.platform==='win32'||process.platform==='darwin'){
  // Use the operating system's default browser and report dispatch failures.
  try {
    await new Promise((resolve,reject)=>{
      const command=process.platform==='darwin'?'/usr/bin/open':'powershell.exe';
      const args=process.platform==='darwin'?[url]:['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${url}' -WindowStyle Normal`];
      const child=spawn(command,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
      let error='';child.stderr.on('data',chunk=>error+=chunk);
      child.once('error',reject);
      child.once('close',code=>code===0?resolve():reject(new Error(error.trim()||`退出码 ${code}`)));
    });
  } catch(error) {
    console.error(`服务已启动，但无法打开默认浏览器：${error.message}\n请打开 ${url}`);
    process.exitCode=1;
  }
}
console.log(`帧迹已启动：${url}`);
