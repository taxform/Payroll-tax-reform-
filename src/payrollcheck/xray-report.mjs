// Report model for Payroll X-Ray™. Safe structured data, not HTML.
import {comparePayrollPeriods} from './payroll-xray.mjs';
const LABELS=Object.freeze({GROSS_PAY_INCREASE:'Gross payroll increase',JURISDICTION_CHANGE:'Reported work-state change',EMPLOYEE_COUNT_CHANGE:'Employee count change',NO_BASELINE:'No prior gross-pay baseline'});
export function buildXrayReport(previous,current,options={}){
 const result=comparePayrollPeriods(previous,current,options);
 if(result.status!=='review_available')return {status:'unable_to_review',title:'Payroll review unavailable',reason:result.reason,items:[],canPublish:false};
 const items=result.findings.map((f,i)=>({id:'XR-'+String(i+1).padStart(3,'0'),code:f.code,title:LABELS[f.code]??'Payroll change',priority:f.severity==='review'?'needs_review':'informational',detail:f.message, ...(f.code==='JURISDICTION_CHANGE'?{addedStates:f.added,removedStates:f.missing}:{})}));
 return {status:'preview_only',title:'Payroll X-Ray™ review preview',periodStart:current.periodStart,periodEnd:current.periodEnd,companyId:current.companyId,summary:{needsReview:items.filter(x=>x.priority==='needs_review').length,informational:items.filter(x=>x.priority==='informational').length},items,canPublish:false,verification:'self_reported_aggregate_only',notice:'Unverified aggregate comparison. Not a payroll audit, tax calculation, or compliance certification. Do not use as sole basis for paying employees or filing taxes.'};
}
export function buildAccountingReviewQueue(clientReports){
 if(!Array.isArray(clientReports)||clientReports.length>100)return {status:'invalid',reason:'Expected up to 100 reports',clients:[]};
 const seen=new Set(),clients=[];
 for(const entry of clientReports){
  if(!entry||typeof entry!=='object'||typeof entry.clientKey!=='string'||!entry.clientKey.trim()||seen.has(entry.clientKey)||!entry.report||entry.report.status!=='preview_only'||entry.report.canPublish!==false)return {status:'invalid',reason:'Invalid or duplicate client report',clients:[]};
  seen.add(entry.clientKey);
  clients.push({clientKey:entry.clientKey,needsReview:entry.report.summary.needsReview,informational:entry.report.summary.informational});
 }
 return {status:'preview_only',clients,notice:'Demonstration queue only; no authorization, tenant isolation or real client access'};
}
