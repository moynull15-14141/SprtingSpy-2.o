'use client';
import { useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import type { Article, Role } from '../../../types';
import { canReviewArticles, REVIEW_LABELS, type ReviewStatus } from '../../../lib/editorialWorkflow';
import { Button } from '../../ui/Button';

interface Reviewer { id: string; name: string; role: Role; status?: string }
interface Workflow { reviewStatus: ReviewStatus; reviewerId: string | null; reviewer: Reviewer | null; reviewComment: string | null; reviewVersion: number; reviewDecidedAt?: string | null; history: {id:string;action:string;userName:string;timestamp:string;details:string}[] }
const field='w-full rounded border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-900';

export function ArticleReviewPanel({ article, saveDraft, onWorkflowChange }: {article?: Article; saveDraft:()=>Promise<string|null>; /** PHASE AUTOSAVE: the article version changed (refresh the editor's base version). */ onWorkflowChange?:()=>void}) {
  const {currentUser,apiCall,refreshData}=useApp();
  const [reviewers,setReviewers]=useState<Reviewer[]>([]);
  const [workflow,setWorkflow]=useState<Workflow|null>(null);
  const [selected,setSelected]=useState('');
  const [reason,setReason]=useState('');
  const [requestOpen,setRequestOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true; setLoading(true); setError('');
    (async()=>{
      const users=await apiCall<Reviewer[]>('/api/articles/reviewers');
      const review=article ? await apiCall<Workflow>(`/api/articles/${article.id}/workflow`) : null;
      if(!active) return;
      if(users.data) setReviewers(users.data); else setError(users.error||'Reviewers could not be loaded.');
      if(review?.data){setWorkflow(review.data);setSelected(review.data.reviewerId||'');} else if(article) setError(review?.error||'Review details could not be loaded.');
      else {setWorkflow(null);setSelected('');}
      setLoading(false);
    })();
    return ()=>{active=false;};
  },[article?.id,article?.reviewVersion]);
  const isAuthor=currentUser.role==='Author';
  const state=workflow?.reviewStatus ?? article?.reviewStatus ?? (isAuthor?'draft':'not_required');
  const privateArticle=!article || ['draft','preview'].includes(article.status);
  const canDecide=canReviewArticles(currentUser.role) && state==='in_review' && (currentUser.role==='Admin'||workflow?.reviewerId===currentUser.id);
  const latestDecision=workflow?.history.find(event=>['Requested Article Changes','Approved Article'].includes(event.action));
  async function submit(){
    if(busy) return; setBusy(true);setError('');setNotice('');
    try {
      if(!selected){setError('Select an eligible reviewer before submitting.');return;}
      const id=await saveDraft(); if(!id){setError('Save the draft successfully before submitting. Your text is retained.');return;}
      const fresh=await apiCall<Workflow>(`/api/articles/${id}/workflow`);
      if(!fresh.data){setError(fresh.error||'Could not confirm the saved review version.');return;}
      const result=await apiCall<Article>(`/api/articles/${id}/submit-review`,{method:'POST',body:{reviewerId:selected,version:fresh.data.reviewVersion}});
      if(!result.data){setError(result.error||'Submission failed.');return;}
      await refreshData();onWorkflowChange?.();setNotice('Submitted for review. Publication remains controlled by Admin/Editor.');
    } finally {setBusy(false);}
  }
  async function decide(decision:'approve'|'request_changes'){
    if(busy||!article||!workflow) return;setBusy(true);setError('');setNotice('');
    try {
      const result=await apiCall<Article>(`/api/articles/${article.id}/review-decision`,{method:'POST',body:{decision,reason,version:workflow.reviewVersion}});
      if(!result.data){setError(result.error||'The review decision was not saved.');return;}
      await refreshData();onWorkflowChange?.();setRequestOpen(false);setReason('');setNotice(decision==='approve'?'Approved. This article is still private until published or scheduled.':'Changes requested. The Author can edit and resubmit.');
    } finally {setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 text-xs dark:border-stone-800 dark:bg-stone-950" aria-labelledby="editorial-review-heading">
    <h4 id="editorial-review-heading" className="font-bold uppercase tracking-wide">Editorial review</h4>
    <p className="font-semibold">{loading?'Loading review details…':REVIEW_LABELS[state]}</p>
    {error&&<p role="alert" className="text-rose-700 dark:text-rose-300">{error}</p>}
    {notice&&<p role="status" className="text-emerald-700 dark:text-emerald-300">{notice}</p>}
    {workflow?.reviewer&&<p>Reviewer: <strong>{workflow.reviewer.name}</strong> ({workflow.reviewer.role}{workflow.reviewer.status==='inactive'?', inactive':''})</p>}
    {workflow?.reviewComment&&<div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40"><p className="font-semibold">Latest review comment{latestDecision ? ` · ${latestDecision.userName}` : ''}</p><p className="whitespace-pre-wrap break-words">{workflow.reviewComment}</p>{workflow.reviewDecidedAt&&<p>{new Date(workflow.reviewDecidedAt).toLocaleString()}</p>}</div>}
    {isAuthor&&state==='in_review'&&<p>Awaiting the reviewer’s decision. Editing resumes if changes are requested.</p>}
    {isAuthor&&privateArticle&&state!=='in_review'&&<>
      <label htmlFor="article-reviewer" className="block font-semibold">Select reviewer *</label>
      <select id="article-reviewer" className={field} value={selected} disabled={busy||loading} onChange={e=>setSelected(e.target.value)}><option value="">Choose an eligible reviewer</option>{reviewers.map(r=><option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}</select>
      {!loading&&!reviewers.length&&<p role="status">No eligible active reviewers are available. Ask an Admin to assign an active Admin or Editor account.</p>}
      <Button type="button" size="sm" className="w-full" disabled={busy||loading||!reviewers.length||!selected} onClick={()=>void submit()}>{state==='changes_requested'?'Resubmit for review':'Submit for review'}</Button>
    </>}
    {!isAuthor&&state==='not_required'&&<p>You can publish or schedule this article directly using the existing controls.</p>}
    {canDecide&&<div className="space-y-3"><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy||loading} onClick={()=>void decide('approve')}>Approve article</Button><Button type="button" size="sm" variant="outline" disabled={busy||loading} aria-expanded={requestOpen} aria-controls="request-changes-fields" onClick={()=>setRequestOpen(open=>!open)}>Request changes</Button></div>
      {requestOpen&&<div id="request-changes-fields" className="space-y-2"><label htmlFor="article-review-reason" className="block font-semibold">Requested changes reason *</label><textarea id="article-review-reason" autoFocus className={field} rows={4} minLength={5} maxLength={5000} value={reason} onChange={e=>setReason(e.target.value)} aria-describedby="review-reason-help"/><p id="review-reason-help">Describe the correction needed (5–5000 characters). The Author will see this comment.</p><Button type="button" size="sm" disabled={busy||reason.trim().length<5} onClick={()=>void decide('request_changes')}>Confirm request changes</Button></div>}
    </div>}
    {workflow?.history.length ? <details><summary className="cursor-pointer font-semibold focus-visible:ring-2 focus-visible:ring-amber-500">Review history</summary><ol className="mt-2 space-y-2">{workflow.history.map(h=><li key={h.id} className="break-words border-t border-stone-200 pt-2 dark:border-stone-800"><p className="font-semibold">{h.action} · {h.userName}</p><p>{new Date(h.timestamp).toLocaleString()}</p><p className="whitespace-pre-wrap">{h.details}</p></li>)}</ol></details>:null}
  </section>;
}
