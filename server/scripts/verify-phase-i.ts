/** Phase I: forged HTTP requests, real editorial browser flows and exact fixture cleanup. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';
import { prisma } from '../db';
import { hashPassword } from '../password';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { articlePath } from '../../src/lib/paths';
assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe,'Phase I requires a local development database.');
assert.equal(await prisma.article.count({where:{status:'scheduled',scheduledFor:{lte:new Date(Date.now()+15*60_000)}}}),0,'Existing scheduled content is due soon; use an isolated copy.');
assert.equal(await prisma.siteExperience.count({where:{scheduledFor:{lte:new Date(Date.now()+15*60_000)}}}),0,'Existing site schedules are due soon; use an isolated copy.');
const prefix=`phasei-${crypto.randomUUID()}`, password=`Test-${crypto.randomUUID()}`;
const actors={admin:`${prefix}-admin`,editor:`${prefix}-editor`,otherEditor:`${prefix}-other-editor`,author:`${prefix}-author`,otherAuthor:`${prefix}-other-author`,unlinked:`${prefix}-unlinked`,inactive:`${prefix}-inactive`};
const bylines={admin:`${prefix}-admin-byline`,editor:`${prefix}-editor-byline`,author:`${prefix}-author-byline`,otherAuthor:`${prefix}-other-author-byline`};
const articleIds=new Set<string>();
const tables=['sport','sportEvent','eventEdition','article','articleMedia','author','user','session','comment','mediaItem','adSlotConfig','adCreative','redirectRule','siteSetting','siteExperience','seoRule','seoScanRun','seoIntegrationLog','auditLog','faqEntry','contactMessage'] as const;
async function snapshot(){return Object.fromEntries(await Promise.all(tables.map(async table=>{const rows=await (prisma[table] as any).findMany();rows.sort((a:unknown,b:unknown)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return [table,crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')];})));}
const before=await snapshot();
let base=process.env.PHASE_I_BASE_URL||'',server:ReturnType<typeof spawn>|undefined,browser:Browser|undefined,output='',checks=0;
const pass=(name:string)=>{checks++;console.log(`PASS ${name}`);};
async function until<T>(read:()=>Promise<T>,valid:(v:T)=>boolean,label:string,timeout=40_000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(valid(value))return value;await new Promise(resolve=>setTimeout(resolve,200));}throw Error(`Timed out: ${label}`);}
class Client{
  cookies=new Map<string,string>();
  async request(route:string,method='GET',body?:unknown){const response=await fetch(base+route,{method,headers:{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(body!==undefined?{'Content-Type':'application/json','x-csrf-token':this.cookies.get('csrf_token')||''}:{})},body:body===undefined?undefined:JSON.stringify(body)});for(const raw of response.headers.getSetCookie()){const part=raw.split(';')[0],i=part.indexOf('=');this.cookies.set(part.slice(0,i),part.slice(i+1));}const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{}return {status:response.status,data,text,headers:response.headers};}
  async login(actor:keyof typeof actors){await this.request('/api/auth/me');return this.request('/api/auth/login','POST',{email:`${actors[actor]}@example.test`,password});}
}
async function expect(c:Client,path:string,status:number,method='GET',body?:unknown){const r=await c.request(path,method,body);assert.equal(r.status,status,`${method} ${path}: ${r.text.slice(0,400)}`);return r;}
async function workflow(c:Client,id:string){return (await expect(c,`/api/articles/${id}/workflow`,200)).data;}
async function submit(c:Client,id:string,reviewerId:string,status=200){return expect(c,`/api/articles/${id}/submit-review`,status,'POST',{reviewerId,version:(await workflow(c,id)).reviewVersion});}
async function decide(c:Client,id:string,decision:string,reason?:string,status=200){return expect(c,`/api/articles/${id}/review-decision`,status,'POST',{decision,reason,version:(await workflow(c,id)).reviewVersion});}
async function loginPage(actor:keyof typeof actors){const context=await browser!.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();await page.goto(base+'/admin/',{waitUntil:'networkidle'});await page.getByPlaceholder('Email').fill(`${actors[actor]}@example.test`);await page.getByPlaceholder('Password').fill(password);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('heading',{name:'Content Management System'}).waitFor();await page.getByRole('button',{name:/^Articles/}).click();return page;}
async function openArticle(page:Page,title:string){await page.getByRole('row').filter({hasText:title}).getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('heading',{name:'Edit Article Dossier'}).waitFor();await page.getByRole('heading',{name:'Editorial review',exact:true}).waitFor();}
async function verifyQueue(page:Page,label:string,queryKey:string|undefined,queryValue:string|undefined,includes:string[],excludes:string[]=[]){
  const response=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.pathname==='/api/cms/articles/search' && response.request().method()==='GET' &&
      (queryKey ? url.searchParams.get(queryKey)===queryValue : !url.searchParams.has('reviewStatus')&&!url.searchParams.has('myDrafts'));
  });
  const queue=page.getByRole('navigation',{name:'Article review queues'});
  await queue.getByRole('button',{name:label,exact:true}).click();
  const result=await (await response).json();
  if(queryKey==='reviewStatus')assert(result.items.every((item:{reviewStatus:string})=>item.reviewStatus===queryValue),`${label} returned a different review state`);
  if(queryKey==='myDrafts')assert(result.items.every((item:{status:string})=>['draft','preview'].includes(item.status)),`${label} returned a non-draft`);
  const ids=new Set(result.items.map((item:{id:string})=>item.id));
  for(const id of includes)assert(ids.has(id),`${label} omitted ${id}`);
  for(const id of excludes)assert(!ids.has(id),`${label} included ${id}`);
  assert.equal(await queue.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');
  await until(async()=>page.locator('tbody tr').allTextContents(),rows=>includes.every(id=>result.items.some((item:{id:string,title:string})=>item.id===id&&rows.some(row=>row.includes(item.title))))&&excludes.every(id=>!result.items.some((item:{id:string,title:string})=>item.id===id&&rows.some(row=>row.includes(item.title)))),`${label} rendered results`);
}
try{
  for(const [name,id] of Object.entries(actors)){await prisma.user.create({data:{id,name:`Phase I ${name}`,email:`${id}@example.test`,role:name==='admin'||name==='inactive'?'Admin':name==='editor'||name==='otherEditor'?'Editor':'Author',status:name==='inactive'?'inactive':'active',avatar:'',joinedAt:new Date(),passwordHash:hashPassword(password)}});}
  for(const [name,id] of Object.entries(bylines))await prisma.author.create({data:{id,slug:id,name:`Phase I ${name} byline`,roleTitle:'Test sports correspondent',bio:'Disposable Phase I fixture.',avatar:'',userId:actors[name as keyof typeof actors]}});
  if(!base){assert(fs.existsSync('.next/BUILD_ID'),'Build first.');const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));base=`http://127.0.0.1:${port}`;server=spawn(process.execPath,['--import','tsx','server/start-production.ts'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ALLOWED_ORIGIN:base,NODE_ENV:'production',APP_ENV:'production',AUTH_MODE:'production',DEV_LOGIN_BYPASS:'false',INDEXNOW_ENDPOINT:'',GEMINI_API_KEY:'',SHADOW_DATABASE_URL:'',ALLOW_DESTRUCTIVE_DB_OPS:'false',SHOW_AD_PLACEHOLDERS:'false'},stdio:['ignore','pipe','pipe']});server.stdout?.on('data',chunk=>output+=chunk);server.stderr?.on('data',chunk=>output+=chunk);await until(async()=>{if(server!.exitCode!==null)throw Error(output);try{return (await fetch(base+'/api/health')).status;}catch{return 0;}},s=>s===200,'production startup');}
  assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local browser target only.');
  const anon=new Client(),admin=new Client(),editor=new Client(),otherEditor=new Client(),author=new Client(),otherAuthor=new Client(),unlinked=new Client();
  for(const [name,client] of [['admin',admin],['editor',editor],['otherEditor',otherEditor],['author',author],['otherAuthor',otherAuthor],['unlinked',unlinked]] as const)assert.equal((await client.login(name)).status,200);
  await expect(anon,'/api/articles/reviewers',401);
  const sport=await prisma.sport.findFirstOrThrow({where:{isVisible:true}});
  const payload=(name:string)=>({title:`${prefix} ${name}`,slug:`${prefix}-${name}`,sportSlug:sport.slug,articleType:'News',content:'Sports editorial fixture body with verified match coverage.',excerpt:'Disposable sports editorial test.',status:'draft',seo:{}});
  async function create(c:Client,name:string,extra:Record<string,unknown>={}){const r=await expect(c,'/api/articles',201,'POST',{...payload(name),...extra});articleIds.add(r.data.id);return r.data;}
  for(const extra of [{authorId:bylines.otherAuthor},{status:'published'},{status:'scheduled',scheduledFor:new Date(Date.now()+60_000).toISOString()},{status:'archived'},{status:'approved'},{reviewStatus:'approved'},{reviewerId:actors.admin},{publishedAt:new Date().toISOString()},{scheduledFor:new Date(Date.now()+60_000).toISOString()}])await expect(author,'/api/articles',403,'POST',{...payload('forged'),...extra});
  await expect(unlinked,'/api/articles',403,'POST',payload('unlinked'));
  const own=await create(author,'author-api'),foreign=await create(otherAuthor,'foreign-api');assert.equal(own.authorId,bylines.author);assert.equal(own.reviewStatus,'draft');
  await expect(author,`/api/articles/${own.id}`,200,'PUT',{content:'Corrected private sports draft.'});
  await expect(author,`/api/articles/${own.id}/review`,200,'POST',{reviewStatus:'approved',status:'published'});
  const freshnessOnly=await prisma.article.findUniqueOrThrow({where:{id:own.id}});assert.equal(freshnessOnly.reviewStatus,'draft');assert.equal(freshnessOnly.status,'draft');
  for(const extra of [{authorId:bylines.otherAuthor},{status:'published'},{status:'scheduled',scheduledFor:new Date(Date.now()+60_000).toISOString()},{status:'archived'},{status:'approved'},{reviewStatus:'approved'},{reviewerId:actors.admin},{author:{connect:{id:bylines.otherAuthor}}},{id:foreign.id}])await expect(author,`/api/articles/${own.id}`,extra.author||extra.id||extra.reviewStatus||extra.reviewerId?400:403,'PUT',extra);
  await expect(author,`/api/articles/${foreign.id}`,403,'PUT',{title:'Forged edit'});await expect(author,`/api/articles/${foreign.id}`,403,'DELETE');await expect(author,`/api/articles/${foreign.id}/workflow`,404);await expect(author,`/admin/preview/${foreign.id}/`,404);
  const list=(await expect(author,'/api/articles',200)).data,cms=(await expect(author,'/api/cms/data',200)).data;
  assert(list.every((a:any)=>a.authorId===bylines.author));assert(cms.articles.every((a:any)=>a.authorId===bylines.author));
  assert(Object.values(cms.mediaUsage).flat().every((usage:any)=>usage.kind!=='article'||usage.id!==foreign.id));
  for(const q of ['',`?q=${foreign.id}`,`?author=${bylines.otherAuthor}`, '?reviewStatus=in_review','?myDrafts=true']){const search=(await expect(author,'/api/cms/articles/search'+q,200)).data;assert(search.items.every((a:any)=>a.authorId===bylines.author));assert(!search.items.some((a:any)=>a.id===foreign.id));}
  pass('Author byline derived server-side; forged status/nested/ownership requests blocked; list/CMS/search/preview scoped');
  const eligible=(await expect(author,'/api/articles/reviewers',200)).data;assert(eligible.some((r:any)=>r.id===actors.admin));assert(eligible.some((r:any)=>r.id===actors.editor));assert(!eligible.some((r:any)=>[actors.author,actors.inactive,actors.otherAuthor].includes(r.id)));assert(eligible.every((r:any)=>Object.keys(r).sort().join(',')==='id,name,role'));
  await expect(author,`/api/articles/${own.id}/submit-review`,400,'POST',{});
  await submit(author,own.id,actors.author,403);await submit(author,own.id,actors.otherAuthor,400);await submit(author,own.id,actors.inactive,400);await submit(author,own.id,'missing-user',400);
  await submit(author,own.id,actors.editor);await expect(author,`/api/articles/${own.id}`,409,'PUT',{content:'Cannot change submitted content.'});await expect(author,`/api/articles/${own.id}/review-decision`,403,'POST',{decision:'approve',version:0});
  await decide(otherEditor,own.id,'approve',undefined,403);await decide(editor,own.id,'request_changes',' ',400);
  await decide(editor,own.id,'request_changes','Confirm the sporting schedule against the official event source.');
  let review=await workflow(author,own.id);assert.equal(review.reviewStatus,'changes_requested');assert.match(review.reviewComment,/official event source/);assert(review.history.some((h:any)=>h.action==='Requested Article Changes'));
  await expect(author,`/api/articles/${own.id}`,200,'PUT',{content:'Schedule corrected with the official event source.'});await submit(author,own.id,actors.editor);
  const stale=(await workflow(editor,own.id)).reviewVersion;await decide(editor,own.id,'approve');await expect(editor,`/api/articles/${own.id}/review-decision`,409,'POST',{decision:'request_changes',reason:'Stale parallel decision.',version:stale});
  for(const status of ['published','scheduled'])await expect(author,`/api/articles/${own.id}`,403,'PUT',{status,scheduledFor:new Date(Date.now()+60_000).toISOString()});
  await expect(author,`/api/articles/${own.id}`,200,'PUT',{content:'Author changed approved text; it needs review again.'});assert.equal((await workflow(author,own.id)).reviewStatus,'draft');await expect(admin,`/api/articles/${own.id}`,409,'PUT',{status:'published'});
  await submit(author,own.id,actors.editor);await decide(admin,own.id,'approve');await expect(editor,`/api/articles/${own.id}`,200,'PUT',{status:'published'});await expect(author,`/api/articles/${own.id}`,409,'PUT',{status:'draft'});await expect(author,`/api/articles/${own.id}`,403,'PUT',{content:'Cannot edit live content.'});
  pass('Assigned Editor/Admin review, required reason, resubmission, stale-decision rejection and approval invalidation; Author never publishes');
  const publicArticle=await prisma.article.findUniqueOrThrow({where:{id:own.id}});const publicResult=await expect(anon,articlePath(publicArticle),200);assert(publicResult.text.includes('rel="canonical"'));assert(publicResult.text.includes('NewsArticle'));assert(!publicResult.text.includes('reviewComment'));assert(!publicResult.text.includes('Confirm the sporting schedule'));
  const sitemapIndex=(await expect(anon,'/sitemap.xml',200)).text;
  const articleSitemaps=[...sitemapIndex.matchAll(/<loc>([^<]*\/sitemaps\/articles-\d+\.xml)<\/loc>/g)].map(match=>match[1]);
  const sitemapContent=(await Promise.all(articleSitemaps.map(async url=>(await expect(anon,new URL(url).pathname,200)).text))).join('');
  assert(sitemapContent.includes(articlePath(publicArticle)));assert(!sitemapContent.includes(articlePath(foreign)));
  await expect(anon,articlePath(foreign),404);const publicSearch=(await expect(author,'/api/cms/articles/search?publicOnly=true',200)).data;assert(publicSearch.items.every((a:any)=>a.status==='published'&&!('reviewStatus'in a)));
  await expect(admin,`/api/articles/${own.id}`,200,'PUT',{status:'archived'});await expect(anon,articlePath(publicArticle),404);
  await expect(admin,`/api/articles/${own.id}`,200,'PUT',{status:'scheduled',scheduledFor:new Date(Date.now()+60*60_000).toISOString()});await expect(anon,articlePath(publicArticle),404);await expect(admin,`/api/articles/${own.id}`,200,'PUT',{status:'draft'});
  const adminDirect=await create(admin,'admin-direct',{authorId:bylines.admin,status:'published'});assert.equal(adminDirect.reviewStatus,'not_required');await expect(anon,articlePath(adminDirect),200);await expect(admin,`/api/articles/${adminDirect.id}`,200,'PUT',{status:'draft',authorId:bylines.editor});
  const staffDrafts=(await expect(admin,'/api/cms/articles/search?myDrafts=true',200)).data;
  for(const id of [own.id,foreign.id,adminDirect.id])assert(staffDrafts.items.some((item:{id:string})=>item.id===id),'Admin Drafts must include private articles across bylines');
  assert(staffDrafts.items.every((item:{status:string})=>['draft','preview'].includes(item.status)));
  const editorDrafts=(await expect(editor,'/api/cms/articles/search?myDrafts=true',200)).data;
  assert(editorDrafts.items.some((item:{id:string})=>item.id===foreign.id),'Editor Drafts must include another byline');
  const authorDrafts=(await expect(author,'/api/cms/articles/search?myDrafts=true',200)).data;
  assert(authorDrafts.items.every((item:{authorId:string})=>item.authorId===bylines.author),'Author My Drafts must remain ownership-scoped');
  pass('Admin direct publication/byline and archive preserved; public canonical/schema/sitemap/search exclude private workflow data');
  const executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';browser=await chromium.launch({executablePath,headless:true});
  const authorPage=await loginPage('author');const pageErrors:string[]=[];authorPage.on('pageerror',e=>pageErrors.push(e.message));
  await verifyQueue(authorPage,'My Drafts','myDrafts','true',[own.id],[foreign.id]);
  await verifyQueue(authorPage,'All articles',undefined,undefined,[own.id],[foreign.id]);
  await authorPage.getByTestId('create-article-button').click();await authorPage.getByLabel('Article Title (H1) *').fill(`${prefix} browser-author`);await authorPage.locator('#article-body').fill('Cricket coverage for the editorial browser workflow.');
  assert(await authorPage.getByLabel('Byline Author',{exact:true}).isDisabled());assert.equal(await authorPage.getByRole('button',{name:'Publish',exact:true}).count(),0);assert.equal(await authorPage.getByLabel('Publish on *').count(),0);
  const createdResponse=authorPage.waitForResponse(r=>r.url().endsWith('/api/articles')&&r.request().method()==='POST');await authorPage.getByRole('button',{name:'Save draft',exact:true}).click();const browserArticle=await (await createdResponse).json();articleIds.add(browserArticle.id);
  await authorPage.getByLabel('Select reviewer *').selectOption(actors.editor);await authorPage.getByRole('button',{name:'Submit for review',exact:true}).click();await authorPage.getByText('Awaiting the reviewer’s decision. Editing resumes if changes are requested.').waitFor();assert(await authorPage.getByRole('button',{name:'Save draft',exact:true}).isDisabled());
  const editorPage=await loginPage('editor');await verifyQueue(editorPage,'Needs Review','reviewStatus','in_review',[browserArticle.id],[own.id]);await openArticle(editorPage,browserArticle.title);await editorPage.getByRole('button',{name:'Request changes',exact:true}).click();await editorPage.getByLabel('Requested changes reason *').fill('Add the verified cricket match date and official source.');await editorPage.getByRole('button',{name:'Confirm request changes',exact:true}).click();await editorPage.getByText('Changes requested. The Author can edit and resubmit.').waitFor();
  await editorPage.getByRole('button',{name:/Back to articles/}).click();await verifyQueue(editorPage,'Changes Requested','reviewStatus','changes_requested',[browserArticle.id],[own.id]);
  await authorPage.reload({waitUntil:'networkidle'});await authorPage.getByRole('button',{name:/^Articles/}).click();await openArticle(authorPage,browserArticle.title);await authorPage.getByText('Add the verified cricket match date and official source.',{exact:true}).waitFor();await authorPage.locator('#article-body').fill('Verified cricket match date and official event source corrected.');await authorPage.getByRole('button',{name:'Resubmit for review',exact:true}).click();await authorPage.getByText('Awaiting the reviewer’s decision. Editing resumes if changes are requested.').waitFor();
  await editorPage.reload({waitUntil:'networkidle'});await editorPage.getByRole('button',{name:/^Articles/}).click();await verifyQueue(editorPage,'Needs Review','reviewStatus','in_review',[browserArticle.id],[own.id]);await openArticle(editorPage,browserArticle.title);await editorPage.getByRole('button',{name:'Approve article',exact:true}).click();await editorPage.getByText('Approved. This article is still private until published or scheduled.').waitFor();
  await editorPage.getByRole('button',{name:/Back to articles/}).click();await verifyQueue(editorPage,'Approved','reviewStatus','approved',[browserArticle.id,own.id],[foreign.id]);await openArticle(editorPage,browserArticle.title);await editorPage.getByRole('button',{name:'Publish',exact:true}).click();await until(()=>prisma.article.findUniqueOrThrow({where:{id:browserArticle.id}}),a=>a.status==='published','Editor browser publication');
  pass('All five Articles queue buttons return and render the expected scoped rows across review transitions');
  pass('Real Author and Editor browser: create, locked byline, save, select, submit, request reason, edit, resubmit, approve and publish');
  const adminPage=await loginPage('admin');await verifyQueue(adminPage,'Drafts','myDrafts','true',[own.id,foreign.id,adminDirect.id],[browserArticle.id]);await adminPage.getByTestId('create-article-button').click();await adminPage.getByTestId('create-article-manual').click();await adminPage.getByLabel('Article Title (H1) *').fill(`${prefix} browser-admin`);await adminPage.getByLabel('Byline Author',{exact:true}).selectOption(bylines.admin);await adminPage.locator('#article-body').fill('Admin sports article does not need author review.');
  const adminCreate=adminPage.waitForResponse(r=>r.url().endsWith('/api/articles')&&r.request().method()==='POST');await adminPage.getByRole('button',{name:'Save draft',exact:true}).click();const adminArticle=await (await adminCreate).json();articleIds.add(adminArticle.id);await adminPage.getByRole('button',{name:'Publish',exact:true}).click();await until(()=>prisma.article.findUniqueOrThrow({where:{id:adminArticle.id}}),a=>a.status==='published','Admin direct publish');
  await adminPage.getByLabel('Publishing state').selectOption('scheduled');const when=new Date(Date.now()+10_000);const pad=(n:number)=>String(n).padStart(2,'0');const local=`${when.getFullYear()}-${pad(when.getMonth()+1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;await adminPage.getByLabel('Publish on *').fill(local);await adminPage.getByRole('button',{name:'Schedule publication',exact:true}).click();
  const scheduled=await until(()=>prisma.article.findUniqueOrThrow({where:{id:adminArticle.id}}),a=>a.status==='scheduled','Admin browser schedule');assert.equal(scheduled.scheduledFor?.getTime(),Math.floor(when.getTime()/1000)*1000);await expect(anon,articlePath(scheduled),404);const released=await until(()=>prisma.article.findUniqueOrThrow({where:{id:adminArticle.id}}),a=>a.status==='published','real scheduler tick');assert.equal(released.publishedAt.getTime(),scheduled.scheduledFor!.getTime());await expect(anon,articlePath(released),200);
  pass('Real Admin browser draft/direct publish/schedule; H scheduler publishes at scheduledFor with private/public visibility');
  await submit(otherAuthor,foreign.id,actors.admin);
  await adminPage.getByRole('button',{name:/Back to articles/}).click();await adminPage.getByRole('button',{name:'Needs Review',exact:true}).click();await openArticle(adminPage,foreign.title);await adminPage.getByRole('button',{name:'Request changes',exact:true}).click();await adminPage.getByLabel('Requested changes reason *').fill('Verify the sporting venue and match time before publication.');await adminPage.getByRole('button',{name:'Confirm request changes',exact:true}).click();await adminPage.getByText('Changes requested. The Author can edit and resubmit.').waitFor();
  await expect(otherAuthor,`/api/articles/${foreign.id}`,200,'PUT',{content:'Verified sporting venue and match time corrected.'});await submit(otherAuthor,foreign.id,actors.admin);
  await adminPage.reload({waitUntil:'networkidle'});await adminPage.getByRole('button',{name:/^Articles/}).click();await openArticle(adminPage,foreign.title);await adminPage.getByRole('button',{name:'Approve article',exact:true}).click();await adminPage.getByText('Approved. This article is still private until published or scheduled.').waitFor();await adminPage.getByRole('button',{name:'Publish',exact:true}).click();await until(()=>prisma.article.findUniqueOrThrow({where:{id:foreign.id}}),a=>a.status==='published','Admin browser approval/publication');
  pass('Real Admin browser reviews an Author submission, requests changes, approves a resubmission and publishes');
  await authorPage.reload({waitUntil:'networkidle'});await authorPage.getByRole('button',{name:/^Articles/}).click();await openArticle(authorPage,browserArticle.title);assert.equal(await authorPage.getByRole('button',{name:'Publish',exact:true}).count(),0);await authorPage.setViewportSize({width:390,height:844});assert(await authorPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync('verification/phase-i',{recursive:true});await authorPage.getByRole('heading',{name:'Editorial review',exact:true}).scrollIntoViewIfNeeded();await authorPage.screenshot({path:'verification/phase-i/author-mobile.png'});assert.deepEqual(pageErrors,[]);
  const history=await prisma.auditLog.findMany({where:{entityId:browserArticle.id}});for(const action of ['Created Article','Submitted Article for Review','Requested Article Changes','Approved Article','Updated Article'])assert(history.some(h=>h.action===action));
  await authorPage.route('**/api/articles/reviewers',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));await authorPage.reload({waitUntil:'networkidle'});await authorPage.getByRole('button',{name:/^Articles/}).click();await authorPage.getByTestId('create-article-button').click();await authorPage.getByText('No eligible active reviewers are available. Ask an Admin to assign an active Admin or Editor account.').waitFor();assert(await authorPage.getByRole('button',{name:'Submit for review',exact:true}).isDisabled());
  pass('Mobile Author controls, review history and existing audit logging; no browser errors');
} finally {
  await browser?.close();if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
  await prisma.article.deleteMany({where:{OR:[{id:{in:[...articleIds]}},{slug:{startsWith:prefix}}]}});
  await prisma.auditLog.deleteMany({where:{OR:[{userId:{in:Object.values(actors)}},{entityId:{in:[...articleIds]}}]}});
  await prisma.session.deleteMany({where:{userId:{in:Object.values(actors)}}});await prisma.author.deleteMany({where:{id:{in:Object.values(bylines)}}});await prisma.user.deleteMany({where:{id:{in:Object.values(actors)}}});
  assert.deepEqual(await snapshot(),before,'Every pre-existing row must remain unchanged.');pass('Exact original database snapshot restored; disposable fixtures removed');await prisma.$disconnect();
  console.log(`PHASE I: ${checks} verification groups passed.`);
}
