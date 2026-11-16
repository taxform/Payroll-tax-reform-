// Server-side development configuration guard; does not connect to Supabase.
// Public project URL is not a secret. Never log or expose service-role keys.
const deny=reason=>Object.freeze({ok:false,reason});
export function validateSupabaseDevelopmentConfig({projectUrl,environment,allowProduction=false}={}){
 if(environment!=='development'||allowProduction!==false)return deny('non_development_environment');
 if(typeof projectUrl!=='string'||projectUrl.length>255)return deny('invalid_project_url');
 let url;
 try{url=new URL(projectUrl)}catch{return deny('invalid_project_url')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
  url.pathname!=='/'||!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)||
  url.hostname.startsWith('-')||url.hostname.includes('--')||url.hostname.split('.')[0].endsWith('-'))
  return deny('invalid_project_url');
 return Object.freeze({ok:true,issuer:url.origin+'/auth/v1',projectOrigin:url.origin,productionEnabled:false});
}
