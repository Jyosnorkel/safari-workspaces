import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {UsageError} from './usage-guard.mjs';

export function validClientOrigin(origin) {
  if(typeof origin!=='string') return false;
  if(/^safari-web-extension:\/\/[a-z0-9-]+$/i.test(origin)) return true;
  try {const u=new URL(origin);return u.origin===origin&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password;} catch {return false;}
}
const safeEqual=(actual,expected)=>typeof actual==='string'&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
async function bodyJson(request,maximum) {
  return new Promise((resolve,reject)=>{
    let size=0,done=false;const chunks=[];
    const fail=error=>{if(done)return;done=true;chunks.length=0;reject(error);};
    request.on('data',chunk=>{
      if(done)return;
      size+=chunk.length;
      if(size>maximum)return fail(new UsageError('body_limit','Request body is too large.'));
      chunks.push(chunk);
    });
    request.on('error',()=>fail(new UsageError('invalid_input','Request body could not be read.')));
    request.on('aborted',()=>fail(new UsageError('invalid_input','Request was interrupted.')));
    request.on('end',()=>{
      if(done)return;done=true;
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new UsageError('invalid_input','Request body must be JSON.'));}
    });
  });
}
export function createLoopbackServer({service,token,allowedOrigin,port=8788,maxBodyBytes=20000}) {
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)) throw new UsageError('invalid_config','A private 256-bit local token is required.');
  if(!validClientOrigin(allowedOrigin)) throw new UsageError('invalid_config','Set one exact allowed extension origin before starting the local service.');
  if(!Number.isSafeInteger(port)||port<0||port>65535) throw new UsageError('invalid_config','Invalid loopback port.');
  const server=http.createServer(async(request,response)=>{
    const reply=(status,data)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(data));};
    const host=`127.0.0.1:${server.address()?.port}`;
    if(request.headers.host!==host||!['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return reply(403,{ok:false,error:{code:'origin_denied',message:'The request must use the local service address on this Mac.'}});
    if(request.headers.origin!==allowedOrigin) return reply(403,{ok:false,error:{code:'origin_denied',message:request.headers.origin===undefined
      ? 'Safari did not send an Origin header. Update the extension and local service to v0.3.1 or newer; status checks now use POST.'
      : request.headers.origin==='null' ? 'Safari sent an opaque Origin. This connection was rejected; do not change the paired origin to null.'
      : 'The request origin differs from the paired dashboard origin. Check the exact dashboard origin and restart only the local AI service after re-pairing.'}});
    response.setHeader('Access-Control-Allow-Origin',allowedOrigin);response.setHeader('Vary','Origin');
    if(request.method==='OPTIONS') {
      if(!['GET','POST'].includes(request.headers['access-control-request-method'])||String(request.headers['access-control-request-headers']||'').split(',').some(h=>!['authorization','content-type'].includes(h.trim().toLowerCase()))) return reply(403,{ok:false,error:{code:'preflight_denied',message:'Unsupported local request.'}});
      response.setHeader('Access-Control-Allow-Methods','GET, POST');response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      response.writeHead(204);return response.end();
    }
    if(!safeEqual(request.headers.authorization,`Bearer ${token}`)) return reply(401,{ok:false,error:{code:'unauthorized',message:'Enter the local service token to connect.'}});
    try {
      if(['GET','POST'].includes(request.method)&&request.url==='/v1/status') {
        if(request.method==='POST') {
          if(request.headers['content-type']!=='application/json') return reply(415,{ok:false,error:{code:'content_type',message:'Use application/json.'}});
          const input=await bodyJson(request,128);
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length) throw new UsageError('invalid_input','Status requests must contain an empty JSON object.');
        }
        return reply(200,{ok:true,usage:await service.status()});
      }
      if(request.method!=='POST'||request.url!=='/v1/suggestions') return reply(404,{ok:false,error:{code:'not_found',message:'Local endpoint not found.'}});
      if(request.headers['content-type']!=='application/json') return reply(415,{ok:false,error:{code:'content_type',message:'Use application/json.'}});
      const input=await bodyJson(request,maxBodyBytes);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['tabs','consent'].includes(k))) throw new UsageError('invalid_input','Unsupported request fields.');
      const result=await service.suggest(input.tabs,{consent:input.consent});
      reply(200,{ok:true,result,usage:await service.status()});
    } catch(error) {
      let usage;try{usage=await service.status();}catch{}
      const known=error instanceof UsageError;
      const code=known?error.code:'service_error';
      const status=['minute_limit','daily_limit','concurrency_limit'].includes(code)?429:code==='not_configured'?503:code==='provider_error'?502:code==='timeout'?504:code==='body_limit'?413:known?400:500;
      reply(status,{ok:false,error:{code,message:known?error.message:'The local service failed. No automatic retry was made.',retryAt:known?error.retryAt:null},...(usage?{usage}:{})});
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  return {server,async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});return server.address();}};
}
