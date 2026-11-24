// Universal Payroll Connect: provider-neutral, offline prototype. No network or credentials.
export const PROVIDERS=Object.freeze([
 {id:'quickbooks',name:'QuickBooks Payroll',mode:'partner_approval_required'},
 {id:'gusto',name:'Gusto',mode:'partner_approval_required'},
 {id:'adp',name:'ADP',mode:'access_unverified'},
 {id:'paychex',name:'Paychex',mode:'access_unverified'},
 {id:'file_import',name:'Secure file import',mode:'prototype_only'}
]);
export const FIELDS=Object.freeze(['companyId','periodStart','periodEnd','grossPay','employeeCount','jurisdictions']);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function normalizePayrollSummary(input){
 const errors=[];
 if(!input||typeof input!=='object'||Array.isArray(input))return {status:'invalid',errors:['Expected payroll summary object'],data:null};
 const {companyId,periodStart,periodEnd,grossPay,employeeCount,jurisdictions}=input;
 if(typeof companyId!=='string'||!companyId.trim())errors.push('Missing company ID');
 if(!date(periodStart)||!date(periodEnd)||periodEnd<periodStart)errors.push('Invalid payroll period');
 // Monetary inputs are strings to avoid silently rounding binary floats.
 if(typeof grossPay!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(grossPay))errors.push('Gross pay must be a nonnegative decimal string');
 if(!Number.isSafeInteger(employeeCount)||employeeCount<0)errors.push('Invalid employee count');
 if(!Array.isArray(jurisdictions)||!jurisdictions.length||jurisdictions.some(x=>typeof x!=='string'||!/^[A-Z]{2}$/.test(x)))errors.push('Missing or invalid jurisdictions');
 if(errors.length)return {status:'invalid',errors,data:null};
 return {status:'normalized_unverified',errors:[],data:{companyId,periodStart,periodEnd,grossPay,employeeCount,jurisdictions:[...new Set(jurisdictions)]}};
}
export function describeConnection(providerId,capabilities={}){
 const provider=PROVIDERS.find(p=>p.id===providerId);
 if(!provider)return {status:'unsupported',reason:'Unknown provider'};
 const keys=['payrollSummary','taxLiabilities','employees','webhooks'];
 const available=keys.filter(k=>capabilities[k]===true);
 return {status:'not_connected',provider:provider.name,access:provider.mode,available,missing:keys.filter(k=>!available.includes(k)),message:'No live connection or compliance verification'};
}
