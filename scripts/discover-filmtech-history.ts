// Read-only, resumable historical discovery. Parsed materials stay private until an explicit import.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { guardedFetch, BROWSER_UA } from "@aihot/backend/lib/http-fetch";
import { stripTags } from "@aihot/backend/lib/text";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchWebList } from "@aihot/backend/sources/web-list";
import { identityKeyForUrl } from "@aihot/backend/lib/url";
import type { SourceRow, Candidate } from "@aihot/backend/sources/types";

const [startArg, endArg] = process.argv.slice(2);
const refresh=process.argv.includes("--refresh");
const start = new Date(startArg ?? ""), end = new Date(endArg ?? "");
if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) throw Error("Usage: discover-filmtech-history.ts START_ISO END_ISO");
const directory = path.join(config.dataDir, "all-source-history-20260930");
await mkdir(directory, { recursive: true, mode: 0o700 });
const sources = await sql<SourceRow[]>`SELECT * FROM sources WHERE participation_mode='editorial' ORDER BY id`;
const log = (data: unknown) => console.log(JSON.stringify({at:new Date().toISOString(),data}));
async function c21Page(page:number):Promise<Candidate[]> {
 const u=new URL("https://www.c21media.net/wp-json/wp/v2/posts");
 u.searchParams.set('per_page','100');u.searchParams.set('page',String(page));u.searchParams.set('_fields','id,link,title,date_gmt,excerpt');
 u.searchParams.set('after',new Date(+start-86400000).toISOString());u.searchParams.set('before',new Date(+end+86400000).toISOString());
 const response=await guardedFetch(u.toString(),{headers:{'user-agent':BROWSER_UA},timeoutMs:25000});
 if(response.status!==200)throw Error(`Public archive HTTP ${response.status}`);
 const rows=JSON.parse(response.text());if(!Array.isArray(rows))throw Error('Invalid public archive');
 return rows.map(row=>({url:new URL(row.link,'https://www.c21media.net/').toString(),title:stripTags(row.title?.rendered??''),publishedAt:new Date(row.date_gmt+'Z'),excerpt:stripTags(row.excerpt?.rendered??'').slice(0,2000)||null,bodyStatus:'unconfirmed',raw:{id:row.id}}));
}
try {
 for (let offset=0; offset<sources.length; offset+=4) await Promise.all(sources.slice(offset,offset+4).map(async source => {
  const file=path.join(directory,source.id+".json");
  try { const prior=JSON.parse(await readFile(file,"utf8")); if(prior.start===startArg && prior.end===endArg && (prior.status==='covered'&&!refresh || refresh && source.id==='cinemontage' && String(prior.reason).includes('HTTP 403'))){log({id:source.id,status:'cached',count:prior.items.length});return;} } catch {}
  if(source.id==='redshark') {
   const menu=await guardedFetch('https://www.redsharknews.com/',{headers:{'user-agent':BROWSER_UA},timeoutMs:25000});
   const $=cheerio.load(menu.text());const tags=[...new Set($('.header--wrapper a[href*="/tag/"]').map((i,e)=>$(e).attr('href')!).get())];
   const merged=new Map<string,Candidate>();const pages=[];let complete=true;
   for(let i=0;i<tags.length;i+=4) await Promise.all(tags.slice(i,i+4).map(async tag=>{
    try {const url=new URL(tag+'/rss.xml','https://www.redsharknews.com/').toString();const found=(await fetchRss({...source,cursor:null,config:{...source.config,feedUrl:url}},{force:true})).candidates;
     const dates=found.map(c=>c.publishedAt).filter((d):d is Date=>!!d);const crosses=dates.length===found.length && (!found.length||dates.at(-1)!<start);if(!crosses)complete=false;
     pages.push({url,found:found.length,oldest:dates.at(-1)?.toISOString(),crosses});for(const c of found)if(c.publishedAt&&c.publishedAt>=start&&c.publishedAt<end)merged.set(identityKeyForUrl(c.url)??c.url,c);
    } catch(error){complete=false;pages.push({tag,error:String(error)});}
   }));
   // The general feed also covers recent untagged posts.
   for(const c of (await fetchRss({...source,cursor:null},{force:true})).candidates)if(c.publishedAt&&c.publishedAt>=start&&c.publishedAt<end)merged.set(identityKeyForUrl(c.url)??c.url,c);
   const status=complete?'covered':'incomplete';const reason=complete?'all public navigation tag feeds cross start':'tag feed requires deeper archive';
   await writeFile(file,JSON.stringify({id:source.id,start:startArg,end:endArg,status,reason,pages,items:[...merged.values()]}),{mode:0o600});log({id:source.id,status,reason,count:merged.size,pages:pages.length});return;
  }
  const seen=new Set<string>();const items:Candidate[]=[];const pages:Array<Record<string,unknown>>=[];let status='incomplete';let reason='page limit';let oldestOffset:number|null=null;
  for(let page=1;page<=250;page++) {
   const temporary={...source.config};
   if(source.kind==='rss'){const url=new URL(temporary.feedUrl);if(page>1){if(source.id==='production-expert' && oldestOffset)url.searchParams.set('offset',String(oldestOffset-1));else url.searchParams.set('paged',String(page));}temporary.feedUrl=url.toString();}
   else if(source.id==='cgchannel'){temporary.itemSelector='.archive-featured article.boxout, .archive-grid article.boxout';if(page>1)temporary.url=temporary.url.replace(/\/$/,'')+'/page/'+page+'/';}
   else {reason='historical adapter required';break;}
   let found:Candidate[]=[];let failure:unknown;
   for(let attempt=0;attempt<2;attempt++) try {found=source.id==='c21media'?await c21Page(page):source.kind==='rss'?(await fetchRss({...source,config:temporary,cursor:null},{force:true})).candidates:await fetchWebList({...source,config:temporary});failure=null;break;}catch(error){failure=error;if(String(error).includes('403')||String(error).includes('404'))break;}
   if(failure){reason=String(failure);pages.push({page,error:reason});break;}
   const valid=found.filter(c=>c.publishedAt && Number.isFinite(+c.publishedAt));
   const dates=valid.map(c=>+c.publishedAt!);oldestOffset=dates.length?Math.min(...dates):null;let novel=0;
   for(const c of found){const key=identityKeyForUrl(c.url)??c.url;if(seen.has(key))continue;seen.add(key);novel++;if(c.publishedAt && c.publishedAt>=start && c.publishedAt<end)items.push(c);}
   pages.push({page,found:found.length,novel,inWindow:valid.filter(c=>c.publishedAt!>=start&&c.publishedAt!<end).length,oldest:dates.length?new Date(Math.min(...dates)).toISOString():null,newest:dates.length?new Date(Math.max(...dates)).toISOString():null});
   if(found.length===0){status='covered';reason='archive exhausted';}
   else if(source.id==='c21media' && found.length<100){status='covered';reason='public REST archive exhausted';}
   else if(!novel){reason='pagination repeats';}
   else if(source.kind==='rss' && valid.length===found.length && dates.at(-1)!<+start){status='covered';reason='chronological feed crosses start';}
   else if(source.kind==='web_list' && page>1 && valid.length===found.length && !valid.some(c=>c.publishedAt!>=start)){status='covered';reason='archive crosses start';}
   await writeFile(file,JSON.stringify({id:source.id,start:startArg,end:endArg,status,reason,pages,items}),{mode:0o600});
   if(status==='covered'||!novel||!found.length)break;
  }
  await writeFile(file,JSON.stringify({id:source.id,start:startArg,end:endArg,status,reason,pages,items}),{mode:0o600});
  log({id:source.id,status,reason,pages:pages.length,count:items.length});
 }));
} finally {await closeDb();}
