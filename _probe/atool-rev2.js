'use strict';
async function gql(q){
  const r=await fetch('https://api.nexusmods.com/v2/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
  const j=await r.json(); if(j.errors) throw new Error(JSON.stringify(j.errors).slice(0,600)); return j.data;
}
async function main(){
  for(const id of [1662,1496]){
    const d=await gql(`{ mod(modId:${id}, gameId:7804){ name modRequirements{
      modsRequiringThisMod(count:200){ totalCount nodesCount nodes{ modId modName url notes gameId } }
      nexusRequirements(count:50){ nodes{ modId modName url } }
    } } }`);
    const r=d.mod.modRequirements;
    console.log('\n### 需要 #'+id+' ('+d.mod.name+') 的 mod 共 '+r.modsRequiringThisMod.totalCount+' 个');
    for(const n of (r.modsRequiringThisMod.nodes||[])) console.log('   #'+n.modId+'  '+n.modName);
  }
}
main().catch(e=>console.log('FATAL',e.message));
