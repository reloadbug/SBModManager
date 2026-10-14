'use strict';
const fs=require('fs');
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
async function main(){
  const cookie=fs.readFileSync(process.argv[2],'utf8').trim();
  const fileId=process.argv[3]||'12834';
  const hdr={
    Cookie:cookie, 'User-Agent':UA,
    Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':'en-US,en;q=0.9,zh-CN;q=0.8',
    'sec-ch-ua':'"Chromium";v="141", "Not?A_Brand";v="24"',
    'sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"',
    'Sec-Fetch-Dest':'iframe','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'same-origin',
    Referer:'https://www.nexusmods.com/stellarblade/mods/1662?tab=files',
    'Upgrade-Insecure-Requests':'1'
  };
  const u=`https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=${fileId}&game_id=7804&nmm=1`;
  const r=await fetch(u,{headers:hdr,redirect:'follow'});
  const t=await r.text();
  console.log('HTTP',r.status,'len',t.length);
  const m=/nxm:////[^/s"'<>]+/.exec(t);
  if(m) console.log('NXM:',m[0].replace(/key=[^&]+/,'key=***'));
  else console.log('无 nxm；标题:',(/<title>([^<]*)<\/title>/.exec(t)||[])[1]);
}
main().catch(e=>console.log('FATAL',e.message));
