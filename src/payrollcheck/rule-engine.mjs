// PayrollCheck 360°: fail-closed jurisdiction rule selection.
// No actual tax or labor rules are supplied by this module.
export const STATES = Object.freeze('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
export const CATEGORIES = Object.freeze(['income_withholding','unemployment','wage_hour','paid_leave','local_payroll_tax']);
const dateOK = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function validateRule(r){
 const errors=[];
 if(!r||typeof r!=='object'||Array.isArray(r))return ['Rule must be an object'];
 for(const k of ['id','jurisdiction','category','sourceUrl','sourcePublished','effectiveFrom','reviewedAt','reviewer','status','applicability','exceptions','testCaseIds']){
  if(!own(r,k))errors.push('Missing '+k);
 }
 if(errors.length)return errors;
 if(typeof r.id!=='string'||!r.id.trim())errors.push('Invalid id');
 if(!STATES.includes(r.jurisdiction))errors.push('Unsupported state');
 if(!CATEGORIES.includes(r.category))errors.push('Unsupported category');
 try{const u=new URL(r.sourceUrl);if(u.protocol!=='https:'||!u.hostname.includes('.'))errors.push('Source must be HTTPS')}catch{errors.push('Invalid source URL')}
 for(const k of ['sourcePublished','effectiveFrom','reviewedAt'])if(!dateOK(r[k]))errors.push('Invalid '+k);
 if(r.effectiveTo!=null&&!dateOK(r.effectiveTo))errors.push('Invalid effectiveTo');
 if(dateOK(r.effectiveFrom)&&dateOK(r.effectiveTo)&&r.effectiveTo<r.effectiveFrom)errors.push('End before start');
 if(!['draft','review_pending','validated','retired'].includes(r.status))errors.push('Invalid status');
 if(typeof r.applicability!=='string'||!r.applicability.trim())errors.push('Missing applicability detail');
 if(typeof r.exceptions!=='string'||!r.exceptions.trim())errors.push('Missing exceptions detail');
 if(!Array.isArray(r.testCaseIds)||r.testCaseIds.length===0||r.testCaseIds.some(x=>typeof x!=='string'||!x.trim()))errors.push('Missing test cases');
 if(r.status==='validated'&&(!r.reviewer||!String(r.reviewer).trim()))errors.push('Validated rule requires reviewer');
 return errors;
}
export function selectRules({state,category,onDate,rules=[]}){
 if(!STATES.includes(state)||!CATEGORIES.includes(category)||!dateOK(onDate)||!Array.isArray(rules))
  return {status:'unable_to_determine',reason:'Invalid jurisdiction, category, date or catalog',rules:[]};
 const relevant=rules.filter(r=>r?.jurisdiction===state&&r?.category===category);
 const active=relevant.filter(r=>r.status==='validated'&&validateRule(r).length===0&&r.effectiveFrom<=onDate&&(r.effectiveTo==null||r.effectiveTo>=onDate));
 if(!active.length)return {status:'unable_to_determine',reason:'No validated effective rule available',rules:[]};
 // Multiple overlapping rules may be legitimate, but require an explicit resolution layer.
 if(active.length!==1)return {status:'unable_to_determine',reason:'Multiple overlapping rules require review',rules:[]};
 return {status:'rule_available',reason:'Validated rule metadata available; employer applicability still requires evaluation',rules:active};
}
