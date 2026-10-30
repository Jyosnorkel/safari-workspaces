/* Local connection token only. The Meta API key stays in the local service environment. */
(() => {
  const baseURL='http://127.0.0.1:8788';
  const clientOrigin=globalThis.location?.origin&&globalThis.location.origin!=='null'
    ? globalThis.location.origin : globalThis.location ? `${globalThis.location.protocol}//${globalThis.location.host}` : '';
  async function call(path,{token,tabs,consent}={}) {
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token.trim())) {
      const error=new Error('Enter the local service token from your private connection file, not the Meta API key.');error.code='local_token_required';throw error;
    }
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),35000);
    try {
      const response=await fetch(`${baseURL}${path}`,{
        // Privileged extension GET requests can omit Origin when CORS is bypassed.
        // POST uses Fetch's non-GET Origin path while retaining strict server checks.
        method:'POST',headers:{Authorization:`Bearer ${token.trim()}`,'Content-Type':'application/json'},
        body:JSON.stringify(path==='/v1/status'?{}:{tabs,consent}),signal:controller.signal,mode:'cors',
        credentials:'omit',cache:'no-store',redirect:'error'
      });
      const data=await response.json();
      if(!response.ok||data.ok!==true) {
        const error=new Error(typeof data.error?.message==='string'?data.error.message:'The local AI service rejected this request.');
        error.code=data.error?.code||'local_service_error';error.retryAt=data.error?.retryAt??null;error.usage=data.usage;throw error;
      }
      return data;
    }catch(error){
      if(error.code)throw error;
      const failed=new Error('Cannot reach the local AI service. Check that it is running, paired to this extension origin, and allowed by Safari. No automatic retry was made.');
      failed.code='local_service_unavailable';throw failed;
    }finally{clearTimeout(timer);}
  }
  globalThis.WorkspaceAI=Object.freeze({baseURL,clientOrigin,status:options=>call('/v1/status',options),suggest:options=>call('/v1/suggestions',options)});
})();
