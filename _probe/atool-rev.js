'use strict';
async function gql(q){
  const r=await fetch('https://api.nexusmods.com/v2/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
  const j=await r.json(); if(j.errors) throw new Error(JSON.stringify(j.errors).slice(0,600)); return j.data;
}
async function main(){
  const t=await gql(`{ __type(name:"ModRequiringPage"){ fields{ name type{ name kind ofType{ name } } } } }`);
  console.log('ModRequiringPage:', t.__type.fields.map(f=>f.name+':'+(f.type.name||(f.type.ofType&&f.type.ofType.name))).join(', '));
  const t2=await gql(`{ __type(name:"ModRequirement"){ fields{ name type{ name kind ofType{ name } } } } }`);
  console.log('ModRequirement :', t2.__type.fields.map(f=>f.name+':'+(f.type.name||(f.type.ofType&&f.type.ofType.name))).join(', '));
}
main().catch(e=>console.log('FATAL',e.message));
