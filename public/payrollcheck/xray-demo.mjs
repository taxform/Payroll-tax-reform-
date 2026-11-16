// Fictional demonstration only. No network, user input, storage, or real payroll data.
const demo=Object.freeze([
 {client:'Example Retail LLC',findings:[{label:'Gross payroll increased 30%',priority:'Review'},{label:'Reported work states changed',priority:'Review'},{label:'Employee count changed',priority:'Info'}]},
 {client:'Sample Services Co.',findings:[{label:'Gross payroll increased 28%',priority:'Review'},{label:'Employee count changed',priority:'Info'}]},
 {client:'Demo Workshop Inc.',findings:[{label:'Reported work states changed',priority:'Review'}]}
]);
const container=document.querySelector('[data-xray-demo]');
if(container){
 const isFirm=container.dataset.xrayDemo==='accounting';
 const heading=document.createElement('h2');heading.textContent=isFirm?'Payroll X-Ray™ sample client queue':'Payroll X-Ray™ sample findings';container.append(heading);
 const intro=document.createElement('p');intro.textContent='Fabricated demonstration data only. These are change indicators, not confirmed payroll errors or compliance findings.';container.append(intro);
 const list=document.createElement('ul');
 for(const client of (isFirm?demo:[demo[0]])){
  const item=document.createElement('li');
  const label=document.createElement('strong');label.textContent=client.client+': ';
  item.append(label,document.createTextNode(client.findings.map(f=>f.label+' ('+f.priority+')').join('; ')));
  list.append(item);
 }
 container.append(list);
}
