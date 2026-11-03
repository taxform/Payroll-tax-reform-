const pages={home:'Home',updates:'Latest Updates',payroll:'Payroll Taxes',states:'State Taxes',resources:'Resources',advertise:'Advertise With Us',about:'About',privacy:'Privacy Policy',contact:'Contact',partners:'Partners'};
const file=location.pathname.split('/').pop()||'index.html';
const current=file==='index.html'?'home':file.replace('.html','');

function link(p){return p==='home'?'index.html':p+'.html';}

function header(){
  return `
    <div class="top">
      <div class="wrap">
        <span>Independent tax & payroll information • United States</span>
        <span>Information only • Not tax or legal advice</span>
      </div>
    </div>
    <header class="site-header">
      <div class="wrap nav">
        <a class="brand" href="index.html">PayrollTaxReform.com</a>
        <nav class="mainnav" aria-label="Main navigation">
          ${Object.entries(pages).filter(([key])=>['home','updates','payroll','states','resources','about','contact','privacy'].includes(key)).map(([key,label])=>`<a href="${link(key)}" class="${current===key?'active':''}">${label}</a>`).join('')}
        </nav>
      </div>
    </header>
  `;
}

function footer(){
  return `
    <footer class="site-footer">
      <div class="wrap footer-grid">
        <div>
          <h3>PayrollTaxReform.com</h3>
          <p>Independent payroll tax and tax reform information for businesses and professionals.</p>
        </div>
        <div>
          <h4>Explore</h4>
          <ul>
            <li><a href="index.html">Home</a></li>
            <li><a href="updates.html">Latest Updates</a></li>
            <li><a href="payroll.html">Payroll Taxes</a></li>
            <li><a href="resources.html">Resources</a></li>
          </ul>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            <li><a href="about.html">About</a></li>
            <li><a href="contact.html">Contact</a></li>
            <li><a href="privacy.html">Privacy Policy</a></li>
            <li><a href="advertise.html">Advertise</a></li>
          </ul>
        </div>
      </div>
      <div class="wrap footer-bottom">
        <span>© ${new Date().getFullYear()} PayrollTaxReform.com</span>
        <span>Disclosure: We may earn a commission through affiliate links.</span>
      </div>
    </footer>
  `;
}

function affiliateSection(title='Recommended payroll and tax tools', intro='Disclosure: We may earn a commission if you click through and make a purchase, at no extra cost to you.') {
  const items=[
    {name:'Gusto', text:'Payroll, benefits, and HR for small businesses.', url:'https://www.gusto.com/'},
    {name:'QuickBooks Online', text:'Accounting and bookkeeping tools built for growing companies.', url:'https://quickbooks.intuit.com/'},
    {name:'Patriot Software', text:'Affordable payroll and accounting software for small businesses.', url:'https://www.patriotsoftware.com/'},
    {name:'TaxJar', text:'Sales tax automation and compliance workflows for online sellers.', url:'https://www.taxjar.com/'},
    {name:'Sparta Labs', text:'Browse the Sparta Labs online store through our partner link.', url:'https://spartalabs.net/us/store?aff=SL7M9RJN'}
  ];

  return `
    <section class="section">
      <div class="wrap">
        <div class="affiliate-box">
          <div class="eyebrow">Affiliate recommendations</div>
          <h2>${title}</h2>
          <p class="affiliate-disclosure">${intro}</p>
          <div class="affiliate-grid">
            ${items.map(item=>`
              <article class="affiliate-card">
                <div class="affiliate-tag">Recommended</div>
                <h3>${item.name}</h3>
                <p>${item.text}</p>
                <a href="${item.url}" target="_blank" rel="nofollow sponsored noopener">Visit ${item.name} →</a>
              </article>
            `).join('')}
          </div>
        </div>
      </div>
    </section>
  `;
}

function head(title,desc){
  return `<div class="pagehead"><div class="wrap"><div class="eyebrow">PayrollTaxReform.com</div><h1>${title}</h1><p>${desc}</p></div></div>`;
}

const views={
  home:()=>`
    <section class="hero">
      <div class="wrap">
        <div class="eyebrow">Payroll • Tax reform • Regulatory intelligence</div>
        <h1>Stay informed.<br>Stay ahead of tax changes.</h1>
        <p>Clear, practical tax and payroll guidance for employers, founders, and finance teams.</p>
        <div class="cta-row">
          <a class="button primary" href="updates.html">Read the latest updates</a>
          <a class="button secondary" href="resources.html">Browse resources</a>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="wrap three-up">
        <article class="card"><span class="tag">Payroll</span><h3>Employer payroll tax center</h3><p>Review federal payroll tax rules, withholding updates, and filing essentials.</p><a class="more" href="payroll.html">Explore →</a></article>
        <article class="card"><span class="tag">News</span><h3>Latest tax updates</h3><p>Track official IRS developments and new federal guidance as they happen.</p><a class="more" href="updates.html">Explore →</a></article>
        <article class="card"><span class="tag">State</span><h3>State tax resources</h3><p>Find state-specific payroll and employment guidance across the U.S.</p><a class="more" href="states.html">Explore →</a></article>
      </div>
    </section>
    ${affiliateSection()}
  `,

  updates:()=>`${head('Latest tax updates','A central hub for federal tax developments, payroll changes, and regulatory announcements.')}
    <section class="section">
      <div class="wrap layout">
        <main class="maincol">
          <div id="official-feed" class="sidebox">
            <h2>Latest IRS news releases</h2>
            <p>Loading official IRS updates...</p>
          </div>
        </main>
        <aside class="sidecol">
          <div class="sidebox">
            <h3>Featured resources</h3>
            <ul class="listlinks">
              <li><a href="payroll.html">Payroll tax center</a></li>
              <li><a href="resources.html">Resource center</a></li>
              <li><a href="states.html">State tax resources</a></li>
            </ul>
          </div>
          ${affiliateSection('Recommended payroll software','Disclosure: We may earn a commission if you buy through our links, at no extra cost to you.')}
        </aside>
      </div>
    </section>`,

  payroll:()=>`${head('Payroll tax center','Explore federal employer payroll tax topics and authoritative guidance.')}
    <section class="section">
      <div class="wrap layout">
        <main class="maincol">
          <div class="content-card">
            <h2>Employer payroll tax basics</h2>
            <p>Payroll taxes affect everything from withholding and reporting to employer obligations and filing deadlines. This section is meant to help you find the right starting points and official guidance.</p>
            <ul class="listlinks">
              <li><a href="https://www.irs.gov/businesses/small-businesses-self-employed/employer-tax-guide" target="_blank" rel="noopener">IRS Employer Tax Guide</a></li>
              <li><a href="https://www.irs.gov/payments" target="_blank" rel="noopener">IRS payment and filing information</a></li>
              <li><a href="https://www.irs.gov/forms-pubs" target="_blank" rel="noopener">IRS forms and publications</a></li>
            </ul>
          </div>
        </main>
        <aside class="sidecol">
          ${affiliateSection('Recommended payroll tools','Disclosure: We may earn a commission if you purchase through our links at no additional cost to you.')}
        </aside>
      </div>
    </section>`,

  states:()=>`${head('State tax resources','Start with official state agencies for payroll withholding, employer obligations, and tax changes.')}
    <section class="section"><div class="wrap"><div class="cardgrid">${['California','New York','Texas','Florida','Illinois','Georgia'].map(state=>`<article class="card"><span class="tag">State</span><h3>${state}</h3><p>State-specific employer payroll and tax guidance.</p><a class="more" href="resources.html">Browse resources →</a></article>`).join('')}</div></div></section>`,

  resources:()=>`${head('Resource center','Reliable starting points for tax forms, payroll guidance, and legislative research.')}
    <section class="section"><div class="wrap"><div class="cardgrid">${['IRS guidance','State agencies','Business resources','Tax forms'].map(item=>`<article class="card"><span class="tag">Guide</span><h3>${item}</h3><p>Helpful starting points for payroll, tax, and compliance questions.</p><a class="more" href="about.html">Explore →</a></article>`).join('')}</div></div></section>
    ${affiliateSection('Recommended business software','Disclosure: We may earn a commission if you buy through our links, at no extra cost to you.')}`,

  advertise:()=>`${head('Advertise with us','Put your brand in front of readers interested in payroll, taxes, accounting, and business services.')}
    <section class="section">
      <div class="wrap layout">
        <main class="maincol">
          <div class="content-card">
            <h2>Why advertise here?</h2>
            <p>PayrollTaxReform.com helps businesses and professionals find tax and payroll information in a trusted, research-based format.</p>
            <ul class="listlinks">
              <li>Audience focused on payroll, tax, finance, and compliance</li>
              <li>Useful for software, financing, accounting, and services</li>
              <li>Direct sponsorship or custom placements available</li>
            </ul>
          </div>
        </main>
        <aside class="sidecol"><div class="sidebox"><h3>Get in touch</h3><p>Email us to discuss sponsorship and display opportunities.</p><a href="mailto:payrolltaxreform@gmail.com">payrolltaxreform@gmail.com</a></div></aside>
      </div>
    </section>`,

  about:()=>`${head('About PayrollTaxReform.com','An independent information platform focused on tax changes and payroll clarity.')}
    <section class="section"><div class="wrap layout"><main class="maincol"><div class="content-card"><h2>Our mission</h2><p>We aim to deliver clear, practical guidance for payroll and tax decisions, with links to official sources and useful business context.</p><p>We are not a substitute for tax or legal advice.</p></div></main><aside class="sidecol"><div class="sidebox"><h3>Need help?</h3><p>Visit our resource center or contact us.</p><a href="contact.html">Contact us</a></div></aside></div></section>`,

  privacy:()=>`${head('Privacy policy','How we handle information on PayrollTaxReform.com.')}
    <section class="section"><div class="wrap"><div class="content-card"><p>We may collect email signups and website analytics for operational purposes. We do not sell personal information. We may use third-party tools for analytics, advertising, and affiliate tracking.</p><p>Affiliate links may earn a commission at no extra cost to you. We disclose this where applicable.</p><p>For questions, contact us at <a href="mailto:payrolltaxreform@gmail.com">payrolltaxreform@gmail.com</a>.</p></div></div></section>`,

  partners:()=>`${head('Partners','Third-party partner links shared by PayrollTaxReform.com.')}
    <section class="section"><div class="wrap"><div class="affiliate-box"><div class="eyebrow">Partner link</div><p class="affiliate-disclosure">Disclosure: We may earn a commission if you buy through this link, at no extra cost to you. We do not review, test, or endorse these products, and nothing here is medical advice.</p><div class="affiliate-grid"><article class="affiliate-card"><div class="affiliate-tag">Partner</div><h3>Sparta Labs</h3><p>Online store for research peptides.</p><a href="https://spartalabs.net/us/store?aff=SL7M9RJN" target="_blank" rel="nofollow sponsored noopener">Visit Sparta Labs →</a></article></div></div></div></section>`,

  contact:()=>`${head('Contact us','Send a message about advertising, partnerships, or site feedback.')}
    <section class="section"><div class="wrap layout"><main class="maincol"><div class="content-card"><form class="form" action="mailto:payrolltaxreform@gmail.com" method="post" enctype="text/plain"><label>Name<input type="text" name="name" placeholder="Your name" /></label><label>Email<input type="email" name="email" placeholder="Your email" /></label><label>Message<textarea name="message" rows="6" placeholder="How can we help?"></textarea></label><button type="submit" class="button primary">Send message</button></form></div></main><aside class="sidecol"><div class="sidebox"><h3>Contact details</h3><p>Email: <a href="mailto:payrolltaxreform@gmail.com">payrolltaxreform@gmail.com</a></p><p>Website: <a href="index.html">PayrollTaxReform.com</a></p></div></aside></div></section>`
};

document.getElementById('app').innerHTML=header()+(views[current]||views.home)()+footer();

document.querySelectorAll('form[data-netlify]').forEach(form=>{
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const status=form.querySelector('.success'),btn=form.querySelector('button[type=submit]');
    btn.disabled=true;
    fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(form)).toString()})
      .then(r=>{if(!r.ok)throw Error(r.status);form.reset();status.textContent=form.dataset.success})
      .catch(()=>{status.textContent='Sorry, something went wrong. Please try again in a moment.'})
      .finally(()=>{status.style.display='block';btn.disabled=false});
  });
});

if(current==='updates'){
  const box=document.getElementById('official-feed');
  const fallback=msg=>{const p=document.createElement('p');p.textContent=msg;box.replaceChildren(box.querySelector('h2'),p)};
  fetch('/api/official-updates').then(r=>{if(!r.ok)throw Error('Unavailable');return r.json()}).then(data=>{
    if(!Array.isArray(data.items)||!data.items.length)return fallback('No releases are available right now. Please check the official IRS Newsroom below.');
    const heading=document.createElement('h2');heading.textContent='Latest IRS news releases';
    const note=document.createElement('p');note.textContent='Official headlines only, not interpreted tax advice. Last checked: '+(data.checkedAt?new Date(data.checkedAt).toLocaleString():'unknown');
    const list=document.createElement('div');list.className='listlinks';
    data.items.forEach(item=>{try{const u=new URL(item.url);if(u.protocol!=='https:'||u.hostname!=='irs.gov'&&u.hostname!=='www.irs.gov')return;const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener';a.textContent=item.title||u.href;list.appendChild(a)}catch{}});
    box.replaceChildren(heading,note,list);
  }).catch(()=>fallback('The release feed is temporarily unavailable. Please check the official IRS Newsroom below.'));
}

const style=document.createElement('style');
style.textContent=`
  :root{--navy:#101d33;--deep:#0a1425;--gold:#d5ab56;--paper:#f5f7fb;--ink:#16243a;--muted:#607089;--line:#dce3ed;--white:#fff;--shadow:0 16px 35px rgba(16,35,61,.08)}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--paper);color:var(--ink)}
  a{color:var(--navy);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1180px;margin:0 auto;padding:0 20px}
  .top{background:#0d1d35;color:#fff;font-size:12px}.top .wrap{display:flex;justify-content:space-between;gap:15px;padding:8px 20px}
  .site-header{background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}.nav{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;gap:16px}.brand{font-weight:800;font-size:1.1rem;color:var(--navy)}.mainnav{display:flex;flex-wrap:wrap;gap:12px}.mainnav a{color:var(--muted);font-size:.95rem;border-bottom:2px solid transparent;padding-bottom:4px}.mainnav a.active,.mainnav a:hover{color:var(--navy);border-color:var(--gold);text-decoration:none}
  .hero,.pagehead{background:linear-gradient(135deg,#fff,#eef4ff)}.hero .wrap,.pagehead .wrap{padding:72px 20px 60px}.hero h1,.pagehead h1{margin:0 0 12px;font-size:clamp(2.2rem,5vw,4rem);line-height:1.1;max-width:700px}.hero p,.pagehead p{margin:0;color:var(--muted);max-width:700px}.eyebrow{display:inline-block;margin-bottom:12px;text-transform:uppercase;letter-spacing:.08em;font-size:.72rem;font-weight:700;color:var(--gold)}
  .section{padding:24px 0 10px}.three-up,.cardgrid,.affiliate-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}.card,.content-card,.sidebox,.affiliate-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:var(--shadow)}
  .tag,.affiliate-tag{display:inline-block;padding:6px 10px;border-radius:999px;background:#f2f4fa;color:var(--navy);font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
  .card h3,.content-card h2,.sidebox h3,.affiliate-card h3{margin:12px 0 8px;font-size:1.25rem}.card p,.content-card p,.sidebox p,.affiliate-card p{margin:0 0 14px;color:var(--muted)}
  .more{font-weight:700;color:var(--navy)}.button{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:12px 18px;font-weight:700;border:1px solid var(--line);transition:.2s ease}.button:hover{text-decoration:none}.button.primary{background:var(--navy);color:#fff}.button.secondary{background:#fff;color:var(--navy)}.cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}
  .layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:28px;align-items:start}.maincol,.sidecol{min-width:0}
  .content-card ul,.sidebox ul,.site-footer ul{margin:0;padding-left:18px}.listlinks{display:grid;gap:10px;padding:0;list-style:none}.listlinks li{padding-left:0}.listlinks a{color:var(--navy);font-weight:600}
  .affiliate-box{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:var(--shadow)}.affiliate-box h2{margin:0 0 10px;font-size:clamp(1.7rem,3vw,2.3rem)}.affiliate-disclosure{margin:0 0 18px;color:var(--muted)}.affiliate-card{display:flex;flex-direction:column;justify-content:space-between}.affiliate-card a{margin-top:auto;font-weight:700;color:var(--navy)}
  .site-footer{margin-top:44px;background:#0d1d35;color:#e9eefc;padding:36px 0 18px}.footer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:32px}.site-footer h3,.site-footer h4{margin:0 0 12px;color:#fff}.site-footer p,.site-footer li,.site-footer a,.footer-bottom{color:#dfe7ff}.site-footer ul{list-style:none;padding:0}.site-footer li{margin-bottom:8px}.footer-bottom{display:flex;justify-content:space-between;gap:12px;padding-top:20px;border-top:1px solid rgba(255,255,255,.12);margin-top:18px;font-size:.9rem;flex-wrap:wrap}
  label{display:block;margin:0 0 14px;font-weight:600;color:var(--navy)}input,textarea{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:10px;font:inherit;margin-top:6px;background:#fff}textarea{resize:vertical;min-height:120px}.form .button{border:none;cursor:pointer}
  @media (max-width: 760px){.top .wrap,.nav,.footer-bottom{display:block}.mainnav{margin-top:12px}.layout{grid-template-columns:1fr}.site-header{position:static}.hero .wrap,.pagehead .wrap{padding-top:48px}.}
`;
document.head.appendChild(style);
