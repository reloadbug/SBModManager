'use strict';
async function gql(q){
  const r=await fetch('https://api.nexusmods.com/v2/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
  const j=await r.json(); if(j.errors) throw new Error(JSON.stringify(j.errors).slice(0,600)); return j.data;
}
async function main(){
  const t=await gql(`{ __type(name:"ModRequirements"){ fields{ name type{ name kind ofType{ name } } } } }`);
  for(const f of t.__type.fields) console.log('  '+f.name+' : '+JSON.stringify(f.type));
}
main().catch(e=>console.log('FATAL',e.message));
