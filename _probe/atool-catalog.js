'use strict';
/* 生成 ATOOL 相关动画 mod 目录（反向依赖查询 + 各自主文件） */
const fs=require('fs');
async function gql(q){
  const r=await fetch('https://api.nexusmods.com/v2/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
  const j=await r.json(); if(j.errors) throw new Error(JSON.stringify(j.errors).slice(0,500)); return j.data;
}
async function main(){
  const d=await gql(`{ mod(modId:1662, gameId:7804){ name version modRequirements{
    modsRequiringThisMod(count:300){ totalCount nodes{ modId modName } } } } }`);
  const reqs=d.mod.modRequirements.modsRequiringThisMod.nodes;
  console.log('需要 ATOOL 的 mod:', reqs.length);
  const out=[];
  for(const r of reqs){
    try{
      const m=await gql(`{ mod(modId:${r.modId}, gameId:7804){ modId name version summary author endorsements downloads adultContent }
        modFiles(modId:${r.modId}, gameId:7804){ fileId name version size category primary } }`);
      const mm=m.mod, files=m.modFiles||[];
      const main=files.find(f=>f.primary)||files.find(f=>String(f.category).toUpperCase()==='MAIN')||null;
      out.push({modId:mm.modId,name:mm.name,version:mm.version,summary:(mm.summary||'').replace(/\s+/g,' ').slice(0,140),
        author:mm.author,endorsements:mm.endorsements,downloads:mm.downloads,adult:!!mm.adultContent,
        mainFile: main? {fileId:main.fileId,name:main.name,size:main.size}:null});
      process.stdout.write('.');
    }catch(e){ console.log('\n  #'+r.modId+' 查询失败',e.message); }
  }
  out.sort((a,b)=>b.endorsements-a.endorsements);
  fs.writeFileSync('_probe/atool-catalog.json', JSON.stringify({tool:{modId:1662,name:d.mod.name,version:d.mod.version}, total:out.length, mods:out},null,2));
  console.log('\n已写出 _probe/atool-catalog.json，共', out.length, '条');
  for(const m of out.slice(0,12)) console.log('  #'+m.modId+' '+m.name+'  👍'+m.endorsements+' 主文件='+(m.mainFile?m.mainFile.fileId:'-'));
}
main().catch(e=>console.log('FATAL',e.message));
