import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
export const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class OperatorAuth {
  constructor(store,{operatorToken,username='operator',now=()=>Date.now()}={}){this.store=store;this.operatorToken=operatorToken;this.username=username;this.now=now;this.attempts=[];}
  async initialize(){
    await this.store.transact(state=>{
      let user=state.users.find(u=>u.username===this.username);
      if(!user){const salt=randomBytes(16).toString('hex');user={id:'operator',username:this.username,role:'operator',salt,passwordHash:scryptSync(this.operatorToken,salt,32).toString('hex'),credentialHash:digest(this.operatorToken),createdAt:this.now()};state.users.push(user);}
      else if(user.credentialHash!==digest(this.operatorToken)){const salt=randomBytes(16).toString('hex');user.salt=salt;user.passwordHash=scryptSync(this.operatorToken,salt,32).toString('hex');user.credentialHash=digest(this.operatorToken);state.sessions=[];}
    });
  }
  async login(body){
    const now=this.now();this.attempts=this.attempts.filter(t=>t>now-60000);if(this.attempts.length>=10)throw Object.assign(new Error('Wait one minute before trying again'),{status:429});this.attempts.push(now);
    const password=body?.password??body?.token,username=body?.username??this.username;
    if(typeof password!=='string'||password.length>256||typeof username!=='string')throw Object.assign(new Error('Sign-in failed'),{status:401});
    const user=this.store.state.users.find(u=>u.username===username);
    const computed=scryptSync(password,user?.salt||'no-such-user',32).toString('hex');
    if(!user||!equal(computed,user.passwordHash))throw Object.assign(new Error('Sign-in failed'),{status:401});
    const id=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');
    const seconds=body.remember===false?28800:31536000;
    await this.store.transact(state=>{state.sessions=state.sessions.filter(s=>s.expires>now);if(state.sessions.length>=64)state.sessions.shift();state.sessions.push({idHash:digest(id),csrf,userId:user.id,expires:now+seconds*1000,createdAt:now});});
    return {id,csrf,seconds,user:{username:user.username,role:user.role}};
  }
  session(cookie){
    const raw=/(?:^|;\s*)rm_supervisor=([A-Za-z0-9_-]{43})(?:;|$)/.exec(cookie||'')?.[1];if(!raw)return null;
    const session=this.store.state.sessions.find(s=>s.idHash===digest(raw)&&s.expires>this.now());return session?{...session}:null;
  }
  async revoke(session){await this.store.transact(state=>{state.sessions=state.sessions.filter(s=>s.idHash!==session.idHash);});}
  csrf(a,b){return equal(a,b);}
}
