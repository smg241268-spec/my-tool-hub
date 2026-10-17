import { checkConfig,HttpError,equal,session,guard,requireSession,notion,schema,categories,sourcePath,queryAll,owned,validateTool,props,item } from '../lib/core.js';
import { metadata } from '../lib/metadata.js';
const attempts=new Map();
function response(data,status=200,headers={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});}
async function body(req){const raw=await req.text();if(raw.length>20000)throw new HttpError(413,'入力が大きすぎます。');try{return JSON.parse(raw||'{}');}catch{throw new HttpError(400,'入力形式が不正です。');}}
export async function handle(req){try{
 checkConfig();guard(req);const u=new URL(req.url),action=u.searchParams.get('action')||'list',method=req.method;
 if(action==='login'&&method==='POST'){
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'local';const now=Date.now();if(attempts.size>1000)for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);
  let a=attempts.get(ip);if(a&&a.until>now&&a.count>=5)throw new HttpError(429,'試行回数が多すぎます。15分後に再試行してください。');if(!a||a.until<now)a={count:0,until:now+15*60e3};const b=await body(req);
  if(!equal(b.password||'',process.env.APP_PASSWORD)){a.count++;attempts.set(ip,a);await new Promise(r=>setTimeout(r,700));throw new HttpError(401,'パスワードが違います。');}attempts.delete(ip);
  return response({ok:true},200,{'Set-Cookie':`hub_session=${session()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
 }
 requireSession(req);
 if(action==='session'&&method==='GET')return response({ok:true});
 if(action==='logout'&&method==='POST')return response({ok:true},200,{'Set-Cookie':'hub_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
 if(action==='list'&&method==='GET'){const s=await schema();const rows=await queryAll();return response({tools:rows.map(item),categories:categories(s)});}
 if(action==='metadata'&&method==='POST')return response(await metadata((await body(req)).url));
 if(action==='tool'&&['POST','PATCH','DELETE'].includes(method)){
  const b=await body(req);if(method!=='POST')await owned(b.id);
  if(method==='DELETE'){await notion('/pages/'+b.id,'PATCH',{in_trash:true});return response({ok:true});}
  const s=await schema(),t=validateTool(b,categories(s));const duplicate=await queryAll({property:'リンク先',url:{equals:t.url}});if(duplicate.some(p=>p.id!==b.id))throw new HttpError(409,'同じURLが登録されています。既存のカードを編集してください。');
  const saved=method==='POST'?await notion('/pages','POST',{parent:{type:'data_source_id',data_source_id:process.env.NOTION_DATA_SOURCE_ID},properties:props(t)}):await notion('/pages/'+b.id,'PATCH',{properties:props(t)});return response({tool:item(saved)});
 }
 if(action==='category'&&['POST','PATCH','DELETE'].includes(method)){
  const b=await body(req),s=await schema();let opts=categories(s).map(c=>({id:c.id,name:c.name,color:c.color}));const name=String(b.name||'').trim();
  if(method!=='DELETE'&&(!name||name.length>60))throw new HttpError(400,'カテゴリ名は1〜60文字にしてください。');
  const current=opts.find(c=>c.id===b.id);
  if(method!=='POST'&&!current)throw new HttpError(404,'カテゴリが見つかりません。');
  if(current?.name==='未分類')throw new HttpError(400,'「未分類」は変更・削除できません。');
  if(method!=='DELETE'&&opts.some(c=>c.name===name&&c.id!==b.id))throw new HttpError(409,'同名のカテゴリがあります。');
  if(method==='DELETE'){const used=await queryAll({property:'カテゴリ',select:{equals:current.name}});if(used.length)throw new HttpError(409,'使用中のカテゴリです。カードを別のカテゴリへ移してから削除してください。');opts=opts.filter(c=>c.id!==b.id);}
  else if(method==='POST')opts.push({name,color:'default'});else current.name=name;
  await notion(sourcePath(),'PATCH',{properties:{'カテゴリ':{select:{options:opts}}}});return response({ok:true});
 }
 throw new HttpError(405,'対応していない操作です。');
 }catch(e){return response({error:e instanceof HttpError?e.message:'処理に失敗しました。保存状態を再読み込みして確認してください。'},e instanceof HttpError?e.status:500);}}
export default {fetch:handle};
