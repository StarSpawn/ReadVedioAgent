import {exportRows,timecode,duration} from './core.js';
const enc=new TextEncoder();
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes) {let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// ZIP's stored mode keeps the exporter dependency-free and compatible with Excel / WPS.
export function zip(entries) {
  const local=[],central=[];let offset=0,centralSize=0;
  for(const [name,content] of entries) {
    const n=enc.encode(name),data=typeof content==='string'?enc.encode(content):content,crc=crc32(data);
    const h=new Uint8Array(30+n.length),v=new DataView(h.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);h.set(n,30);
    local.push(h,data);
    const c=new Uint8Array(46+n.length),w=new DataView(c.buffer);
    w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,n.length,true);w.setUint32(42,offset,true);c.set(n,46);
    central.push(c);centralSize+=c.length;offset+=h.length+data.length;
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
  return new Blob([...local,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const xml=s=>String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const col=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26)) s=String.fromCharCode(65+(i-1)%26)+s;return s;};
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function sheet(rows,styleFor,detail=false) {
  const widths=detail?[22,22,18,35,22,18,70]:[25,...Array(Math.max(0,rows[0].length-1)).fill(34)];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row,r)=>`<row r="${r+1}" ht="${r?detail?65:110:36}" customHeight="1">${row.map((value,c)=>value===''?'':`<c r="${col(c)}${r+1}" s="${styleFor(r,c)}" ${typeof value==='number'?'':'t="inlineStr"'}>${typeof value==='number'?`<v>${value}</v>`:`<is><t xml:space="preserve">${xml(value)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData>${detail?`<autoFilter ref="A1:G${rows.length}"/>`:''}</worksheet>`;
}
export function buildWorkbook(p,rules=p.rules) {
  const {matrix,detail}=exportRows(p,rules);
  const fills=p.tracks.map(t=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${t.color.slice(1)}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
  const xf=(font,fill)=>`<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>`;
  const styles=`<styleSheet xmlns="${ns}"><fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FF172431"/><name val="Microsoft YaHei"/></font></fonts><fills count="${3+p.tracks.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243442"/></patternFill></fill>${fills}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${2+p.tracks.length}">${xf(0,0)}${xf(1,2)}${p.tracks.map((_,i)=>xf(2,i+3)).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const info=[['项目说明','内容'],['项目',p.name],['总时长',timecode(duration(p),true)],['时间口径','视频按时间轴顺序连续拼接；重排时标记跟随所属视频。'],['边界口径','时间格左闭右开，例如 10 秒归入 10–20 秒；总时长终点归入最后一格。'],['同格多标记','全部保留，以换行分隔，附全局精确时间。'],['逐帧说明','按片段设定的 FPS 步进；可变帧率素材按时间近似定位。'],...rules.map((r,i)=>[`时间规则 ${i+1}`,`从 ${timecode(r.start,true)} 起，每 ${r.step} 秒一格`])];
  const names=['时间轴标注','标记明细','导出说明'];
  return zip([
    ['[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${n}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml',styles],
    ['xl/worksheets/sheet1.xml',sheet(matrix,(r,c)=>r===0?1:c===0?r+1:0)],
    ['xl/worksheets/sheet2.xml',sheet(detail,r=>r===0?1:0,true)],
    ['xl/worksheets/sheet3.xml',sheet(info,r=>r===0?1:0)]
  ]);
}
