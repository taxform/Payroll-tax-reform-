// Fictional demo fixture is checked against the actual X-Ray engine in CI.
// Static same-origin GET only. No uploads, account data, or external providers.
const container=document.querySelector('[data-xray-demo]');
if(container){
 const title=document.createElement('h2');
 title.textContent=container.dataset.xrayDemo==='accounting'?'Payroll X-Ray™ sample client queue':'Payroll X-Ray™ sample findings';
 container.append(title);
 const notice=document.createElement('p');notice.textContent='Synthetic examples only. Flags are not confirmed payroll errors or compliance findings.';container.append(notice);
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Loading sample data…';container.append(status);
 try{
  const response=await fetch('../xray-fixtures.json',{credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new Error('Demo fixture unavailable');
  const fixture=await response.json();
  const labels={GROSS_PAY_INCREASE:'Gross payroll increase',JURISDICTION_CHANGE:'Reported work-state change',EMPLOYEE_COUNT_CHANGE:'Employee count change',NO_BASELINE:'No prior gross-pay baseline'};
  if(!Array.isArray(fixture.clients)||fixture.clients.length!==3||fixture.clients.some(c=>typeof c.name!=='string'||!Array.isArray(c.expectedCodes)||c.expectedCodes.some(code=>!Object.hasOwn(labels,code))))throw new Error('Invalid demo fixture');
  const list=document.createElement('ul');
  const clients=container.dataset.xrayDemo==='accounting'?fixture.clients:fixture.clients.slice(0,1);
  for(const client of clients){
   const li=document.createElement('li');const name=document.createElement('strong');name.textContent=client.name+': ';
   li.append(name,document.createTextNode(client.expectedCodes.map(code=>labels[code]??'Unknown change').join('; ')||'No sample findings'));
   list.append(li);
  }
  container.append(list);status.textContent='Sample data loaded; no live payroll connections.';
 }catch{status.textContent='Sample findings are temporarily unavailable. No payroll data was accessed.'}
}
