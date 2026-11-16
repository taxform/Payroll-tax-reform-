// Local-only prototype parser for aggregate payroll CSVs. Never upload raw payroll data.
import {normalizePayrollSummary} from './universal-connect.mjs';
export const REQUIRED_COLUMNS=Object.freeze(['companyId','periodStart','periodEnd','grossPay','employeeCount','jurisdictions']);
const MAX_BYTES=64*1024;
function parseRows(csv){
 if(typeof csv!=='string'||new TextEncoder().encode(csv).length>MAX_BYTES)throw new Error('CSV must be text under 64 KiB');
 const rows=[];let row=[],field='',state='start';
 for(let i=0;i<csv.length;i++){
  const c=csv[i];
  if(state==='quoted'){
   if(c==='"'&&csv[i+1]==='"'){field+='"';i++}
   else if(c==='"')state='closed';
   else if(c==='\n'||c==='\r')throw new Error('Multiline CSV fields are not supported');
   else field+=c;
  }else if(state==='closed'){
   if(c===','){row.push(field);field='';state='start'}
   else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';state='start'}
   else if(c==='\r'&&csv[i+1]==='\n'){row.push(field);rows.push(row);row=[];field='';state='start';i++}
   else throw new Error('Unexpected character after quoted field');
  }else if(c==='"'){
   if(state!=='start')throw new Error('Unexpected quote');
   state='quoted';
  }else if(c===','){row.push(field);field='';state='start'}
  else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';state='start'}
  else if(c==='\r'&&csv[i+1]==='\n'){row.push(field);rows.push(row);row=[];field='';state='start';i++}
  else if(c==='\r')throw new Error('Unexpected carriage return');
  else{field+=c;state='plain'}
 }
 if(state==='quoted')throw new Error('Unclosed quote');
 if(field!==''||row.length){row.push(field);rows.push(row)}
 return rows;
}
export function parseAggregatePayrollCsv(csv){
 try{
  const rows=parseRows(csv);
  if(rows.length!==2)return {status:'invalid',errors:['Exactly one aggregate payroll row is required'],data:null};
  const header=rows[0].map(x=>x.trim().replace(/^\uFEFF/,''));
  if(new Set(header).size!==header.length||header.length!==REQUIRED_COLUMNS.length||REQUIRED_COLUMNS.some(x=>!header.includes(x)))return {status:'invalid',errors:['Unexpected, missing or duplicate columns'],data:null};
  if(rows[1].length!==header.length)return {status:'invalid',errors:['Incorrect column count'],data:null};
  const obj=Object.fromEntries(header.map((h,i)=>[h,rows[1][i].trim()]));
  if(!/^\d+$/.test(obj.employeeCount))return {status:'invalid',errors:['Invalid employee count'],data:null};
  obj.employeeCount=Number(obj.employeeCount);
  obj.jurisdictions=obj.jurisdictions.split(';').map(s=>s.trim());
  return normalizePayrollSummary(obj);
 }catch(e){return {status:'invalid',errors:[e.message],data:null}}
}
