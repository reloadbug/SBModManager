'use strict';
async function gql(q){
  const r=await fetch('https://api.nexusmods.com/v2/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
  const j=await r.json(); if(j.errors) throw new Error(JSON.stringify(j.errors).slice(0,600)); return j.data;
}
async function main(){
  const t=await gql(`{ __type(name:"ModRequirement"){ fields{ name } } }`);
  console.log('ModRequirement 字段:', (t.__type? t.__type.fields.map(f=>f.name).join(', ') : '类型不存在'));
  const ids = [2268,2215,1740,1744,1699,741,3871];
  for(const id of ids){
    const d=await gql(`{ mod(modId:${id}, gameId:7804){ modId name modRequirements{ totalCount nodes{ modId modName url externalRequirement{ name url } } } } }`);
    const m=d.mod;
    console.log('\n#'+m.modId+' '+m.name+'  → 依赖 '+m.modRequirements.totalCount+' 项');
    for(const n of (m.modRequirements.nodes||[])) console.log('    - '+(n.modName||n.modId||'')+'  '+(n.url||(n.externalRequirement&&n.externalRequirement.name)||''));
  }
}
main().catch(e=>console.log('FATAL',e.message));
