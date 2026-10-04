import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthContext, type AuthLookup } from './auth';
import { ARTICLE_REVIEW_ROLES, canReviewArticles } from '../src/lib/editorialWorkflow';
import type { Prisma, Article } from './generated/prisma/client';

export class WorkflowError extends Error { constructor(public status: number, message: string) { super(message); this.name = 'WorkflowError'; } }
const fail = (status: number, message: string): never => { throw new WorkflowError(status, message); };
const writeFields = new Set(['title','subtitle','slug','sportSlug','eventSlug','editionYear','articleType','excerpt','content','body','featuredImage','featuredMediaId','authorId','publishedAt','readingTimeMinutes','featured','tables','references','seo','status','scheduledFor','faqSchemaEnabled']);
const protectedFields = new Set(['reviewStatus','reviewerId','reviewComment','reviewSubmittedAt','reviewDecidedAt','reviewVersion']);
export function checkArticlePayload(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Article payload must be an object.');
  for (const key of Object.keys(body)) {
    if (protectedFields.has(key)) fail(403, 'Review state can only be changed through the authorized review actions.');
    if (!writeFields.has(key)) fail(400, `Unsupported article field: ${key}.`);
  }
  const values = body as Record<string,unknown>;
  if ('authorId' in values && (typeof values.authorId !== 'string' || values.authorId.length > 120)) fail(400, 'authorId must be an Author profile ID.');
}
export const articleReadWhere = (ctx: Pick<AuthContext,'role'|'userId'>): Prisma.ArticleWhereInput => ctx.role === 'Author' ? { author: { userId: ctx.userId } } : {};

/** Author identity and private-state checks are independent of the UI. */
export async function authorWriteGuard(ctx: AuthContext, body: Record<string, any>, existing?: Article) {
  checkArticlePayload(body);
  if (ctx.role !== 'Author') {
    const nextStatus = body.status ?? existing?.status ?? 'draft';
    if (existing && ['published','scheduled'].includes(nextStatus) && existing.reviewStatus !== 'not_required' && existing.reviewStatus !== 'approved') fail(409, 'This Author submission must be approved before publishing or scheduling.');
    return body.authorId;
  }
  const profile = await prisma.author.findUnique({ where: { userId: ctx.userId }, select: { id: true } });
  if (!profile) fail(403, 'Ask an Admin to link your Author profile before writing articles.');
  if (existing && existing.authorId !== profile.id) fail(403, 'Authors can only manage their own articles.');
  if ('authorId' in body && body.authorId !== profile.id) fail(403, 'Your article byline must use your own Author profile.');
  const status = body.status ?? existing?.status ?? 'draft';
  if (!['draft','preview'].includes(status) || body.scheduledFor != null || 'publishedAt' in body) fail(403, 'Authors cannot publish, schedule, approve or archive articles. Submit your draft for review.');
  if (existing && ['published','scheduled','archived'].includes(existing.status)) fail(409, 'Ask an Admin or Editor to return this article to draft before editing.');
  if (existing?.reviewStatus === 'in_review') fail(409, 'This article is awaiting review. It can be edited after changes are requested.');
  return profile.id;
}

const wrap = (fn: (req: Request,res: Response)=>Promise<unknown>) => (req: Request,res: Response,next: NextFunction) => fn(req,res).catch(error => error?.code === 'P2025' || error?.code === 'P2034' ? res.status(409).json({error:'The article changed. Reload it before repeating the action.'}) : next(error));
export function editorialWorkflowRouter(getLookup: () => AuthLookup) {
  const router=express.Router();
  const writers=requireRole(getLookup,['Admin','Editor','Author']);
  const reviewers=requireRole(getLookup,ARTICLE_REVIEW_ROLES);
  router.get('/api/articles/reviewers', writers, wrap(async(req,res)=>res.json(await prisma.user.findMany({where:{status:'active',role:{in:ARTICLE_REVIEW_ROLES},id:{not:req.authContext!.userId}},select:{id:true,name:true,role:true},orderBy:[{name:'asc'},{id:'asc'}]}))));
  router.get('/api/articles/:id/workflow', writers, wrap(async(req,res)=>{
    const article=await prisma.article.findFirst({where:{id:req.params.id,...articleReadWhere(req.authContext!)},select:{id:true,reviewStatus:true,reviewerId:true,reviewComment:true,reviewSubmittedAt:true,reviewDecidedAt:true,reviewVersion:true,reviewer:{select:{id:true,name:true,role:true,status:true}}}});
    if(!article) fail(404,'Article not found.');
    const history=await prisma.auditLog.findMany({where:{entityType:'Article',entityId:article.id,action:{in:['Submitted Article for Review','Requested Article Changes','Approved Article','Invalidated Article Approval']}},select:{id:true,action:true,userName:true,timestamp:true,details:true},orderBy:[{timestamp:'desc'},{id:'desc'}],take:30});
    return res.json({...article,history});
  }));
  router.post('/api/articles/:id/submit-review',writers,wrap(async(req,res)=>{
    const ctx=req.authContext!, body=req.body;
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['reviewerId','version'].includes(k)) || typeof body.reviewerId!=='string' || body.reviewerId.length>120 || !Number.isInteger(body.version)) fail(400,'Select an eligible reviewer and provide the current review version.');
    const result=await prisma.$transaction(async tx=>{
      const article=await tx.article.findFirst({where:{id:req.params.id,...articleReadWhere(ctx)},include:{author:{select:{userId:true}}}});
      if(!article) fail(404,'Article not found.');
      if(!['draft','preview'].includes(article.status) || article.reviewStatus==='in_review') fail(409,'Only an editable private draft can be submitted for review.');
      if(!article.title.trim() || !article.content.trim()) fail(400,'Add an article title and body before submitting for review.');
      if(body.reviewerId===ctx.userId || body.reviewerId===article.author.userId) fail(403,'Self-review is not permitted. Select another eligible reviewer.');
      const reviewer=await tx.user.findFirst({where:{id:body.reviewerId,status:'active',role:{in:ARTICLE_REVIEW_ROLES}},select:{id:true,name:true}});
      if(!reviewer) fail(400,'The selected reviewer is not an eligible active reviewer.');
      const saved=await tx.article.update({where:{id:article.id,reviewVersion:body.version,status:article.status,authorId:article.authorId},data:{reviewStatus:'in_review',reviewerId:reviewer.id,reviewSubmittedAt:new Date(),reviewDecidedAt:null,reviewVersion:{increment:1},scheduledFor:null}});
      await tx.auditLog.create({data:{id:`log-${crypto.randomUUID()}`,userId:ctx.userId,userName:ctx.userName,action:'Submitted Article for Review',entityType:'Article',entityId:article.id,timestamp:new Date(),details:`${ctx.userName} ${article.reviewStatus==='changes_requested'?'resubmitted':'submitted'} "${article.title}" to ${reviewer.name} (${reviewer.id}).`}});
      return saved;
    },{isolationLevel:'Serializable'});
    return res.json(result);
  }));
  router.post('/api/articles/:id/review-decision',reviewers,wrap(async(req,res)=>{
    const ctx=req.authContext!, body=req.body;
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['decision','reason','version'].includes(k)) || !['approve','request_changes'].includes(body.decision) || !Number.isInteger(body.version)) fail(400,'Choose an approval or request-changes decision and current review version.');
    const reason=typeof body.reason==='string'?body.reason.trim():'';
    if(body.reason!==undefined && typeof body.reason!=='string' || reason.length>5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason) || body.decision==='request_changes' && reason.length<5) fail(400,'Request changes needs a meaningful reason (5–5000 characters).');
    const result=await prisma.$transaction(async tx=>{
      const article=await tx.article.findUnique({where:{id:req.params.id},include:{author:{select:{userId:true}}}});
      if(!article) fail(404,'Article not found.');
      if(article.author.userId===ctx.userId) fail(403,'Self-approval or self-review is not permitted.');
      const actor=await tx.user.findFirst({where:{id:ctx.userId,status:'active',role:{in:ARTICLE_REVIEW_ROLES}}});
      if(!actor || !canReviewArticles(actor.role) || actor.role!=='Admin' && article.reviewerId!==ctx.userId) fail(403,'Only the assigned reviewer or an Admin can decide this review.');
      if(article.reviewStatus!=='in_review' || !['draft','preview'].includes(article.status)) fail(409,'This article is not awaiting an editorial decision.');
      const approved=body.decision==='approve';
      if (approved && (!article.title.trim() || !article.content.trim())) fail(400, 'An article needs its title and body before approval.');
      const saved=await tx.article.update({where:{id:article.id,reviewVersion:body.version,reviewStatus:'in_review',status:article.status},data:{reviewStatus:approved?'approved':'changes_requested',reviewComment:reason||null,reviewDecidedAt:new Date(),reviewVersion:{increment:1}}});
      await tx.auditLog.create({data:{id:`log-${crypto.randomUUID()}`,userId:ctx.userId,userName:ctx.userName,action:approved?'Approved Article':'Requested Article Changes',entityType:'Article',entityId:article.id,timestamp:new Date(),details:`${ctx.userName} ${approved?'approved':'requested changes to'} "${article.title}".${reason?` Reason: ${reason}`:''}`}});
      return saved;
    },{isolationLevel:'Serializable'});
    return res.json(result);
  }));
  return router;
}
