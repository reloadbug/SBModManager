'use strict';
async function gql(q){
  const r=await fetch('https://api.nexusmods.com/v2/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
  const j=await r.json(); if(j.errors) throw new Error(JSON.stringify(j.errors).slice(0,500)); return j.data;
}
async function main(){
  // 1) Mod 类型上有没有 requirements 相关字段
  const t=await gql(`{ __type(name:"Mod"){ fields{ name } } }`);
  const names=t.__type.fields.map(f=>f.name);
  console.log('Mod 字段里与 requires/依赖 有关的:', names.filter(n=>/req|depend|relation|replic/i.test(n)));
  console.log('Mod 全部字段:', names.join(', '));
}
main().catch(e=>console.log('FATAL',e.message));
