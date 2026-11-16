// Payroll X-Ray™: aggregate period comparison only. Not a tax/compliance calculation.
import {normalizePayrollSummary} from './universal-connect.mjs';
const toCents=s=>{const [whole,fraction='']=s.split('.');return BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2))};
export function comparePayrollPeriods(previous,current,{increaseThresholdPercent=25}={}){
 const p=normalizePayrollSummary(previous),c=normalizePayrollSummary(current);
 if(p.status!=='normalized_unverified'||c.status!=='normalized_unverified')return {status:'unable_to_review',reason:'Invalid or incomplete payroll summaries',findings:[]};
 if(p.data.companyId!==c.data.companyId)return {status:'unable_to_review',reason:'Payroll summaries belong to different companies',findings:[]};
 if(p.data.periodEnd>=c.data.periodStart)return {status:'unable_to_review',reason:'Payroll periods overlap or are out of order',findings:[]};
 if(!Number.isInteger(increaseThresholdPercent)||increaseThresholdPercent<1||increaseThresholdPercent>500)return {status:'unable_to_review',reason:'Invalid review threshold',findings:[]};
 const old=toCents(p.data.grossPay),now=toCents(c.data.grossPay),findings=[];
 if(old===0n){if(now>0n)findings.push({code:'NO_BASELINE',severity:'info',message:'Previous gross payroll was zero; percentage comparison is unavailable'})}
 else if(now*100n>old*BigInt(100+increaseThresholdPercent))findings.push({code:'GROSS_PAY_INCREASE',severity:'review',message:'Gross payroll increased beyond the configured review threshold'});
 const missing=p.data.jurisdictions.filter(s=>!c.data.jurisdictions.includes(s));
 const added=c.data.jurisdictions.filter(s=>!p.data.jurisdictions.includes(s));
 if(missing.length||added.length)findings.push({code:'JURISDICTION_CHANGE',severity:'review',message:'Reported work-state list changed; confirm actual applicability',added,missing});
 if(p.data.employeeCount!==c.data.employeeCount)findings.push({code:'EMPLOYEE_COUNT_CHANGE',severity:'info',message:'Employee count changed between payroll periods'});
 return {status:'review_available',verification:'self_reported_aggregate_only',findings,disclaimer:'Anomaly detection is not evidence of payroll software error or legal noncompliance'};
}
