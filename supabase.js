/* Starwish Money Jar cloud account and per-user synchronization. */
(() => {
  'use strict';
  const URL = 'https://cjhnsmhiboqoqpbptzrk.supabase.co';
  const KEY = 'sb_publishable_SNOLypt36uYzAFx1EYM9_w_Wq5J3HtU';
  const TZ = 'Asia/Kuala_Lumpur';
  const $ = id => document.getElementById(id);
  const client = window.supabase.createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  let user = null, syncing = false, timer = 0, lastSyncError = '';
  const localKey = () => user ? `starwish_cloud_meta_${user.id}` : '';
  const readMeta = () => { try { return JSON.parse(localStorage.getItem(localKey()) || '{}'); } catch { return {}; } };
  const writeMeta = value => localStorage.setItem(localKey(), JSON.stringify(value));
  function toast(message) {
    const el = $('toast'); if (!el) return;
    el.textContent = message; el.classList.remove('hidden'); clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 4500);
  }
  function status(message, error = false) {
    const el = $('cloudStatus'); if (!el) return;
    el.textContent = message; el.classList.toggle('danger', error);
  }
  function idFor(userId, type, oldId) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(oldId)) return oldId;
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${type}:${oldId}`))
      .then(buf => { const b = [...new Uint8Array(buf)].slice(0,16); b[6]=(b[6]&15)|80; b[8]=(b[8]&63)|128; const h=b.map(x=>x.toString(16).padStart(2,'0')).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; });
  }
  const datePlus = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
  function stampToWorkday(stamp) {
    const f = new Intl.DateTimeFormat('en-CA', {timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const parts = Object.fromEntries(f.formatToParts(new Date(stamp)).map(p=>[p.type,p.value]));
    let day = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour)<7) day=datePlus(day,-1);
    return {day,time:`${parts.hour}:${parts.minute}`};
  }
  function callAt(call) {
    const time = /^\d{2}:\d{2}$/.test(call.time||'') ? call.time : '12:00';
    const [hh] = time.split(':').map(Number);
    const actualDay = hh < 7 ? datePlus(call.day,1) : call.day;
    return new Date(`${actualDay}T${time}:00+08:00`).toISOString();
  }
  function callFromRow(row) {
    const {day,time}=stampToWorkday(row.call_at);
    const minutes=Number(row.billable_minutes),rate=Number(row.rate_usd),fx=Number(row.exchange_rate);
    return {id:row.id,day,time,minutes,usd:minutes*rate,rm:minutes*rate*fx,note:row.note||'',created_at:row.created_at,updated_at:row.updated_at};
  }
  async function allRows(table, columns='*') {
    const out=[];
    for(let from=0;;from+=500){
      const {data,error}=await client.from(table).select(columns).order('created_at',{ascending:true}).range(from,from+499);
      if(error) throw error; out.push(...(data||[])); if(!data||data.length<500) break;
    }
    return out;
  }
  async function savePrefs(prefs, preferredView) {
    const row={user_id:user.id,preferred_view:preferredView||'daily',preferences:prefs,updated_at:new Date().toISOString()};
    const {error}=await client.from('starwish_jar_preferences').upsert(row,{onConflict:'user_id'});
    if(error) throw error;
  }
  async function uploadState(state, tombstones) {
    const calls=[];
    for(const c of state.data.calls){
      const id=await idFor(user.id,'call',String(c.id)); c.id=id;
      if(!tombstones.calls.includes(id)) calls.push({id,user_id:user.id,call_at:callAt(c),billable_minutes:c.minutes,rate_usd:c.usd/c.minutes,exchange_rate:c.usd?c.rm/c.usd:state.data.fx,note:c.note||'',created_at:c.created_at||callAt(c),updated_at:c.updated_at||new Date().toISOString()});
    }
    const diaries=[];
    for(const d of state.diaries){
      const id=await idFor(user.id,'diary',String(d.id)); d.id=id;
      if(!tombstones.diaries.includes(id)) diaries.push({id,user_id:user.id,entry_date:d.entryDay||state.today,category:d.kind||'🌈 其他值得开心的小事',content:d.note,created_at:new Date(Number(d.at)||Date.now()).toISOString(),updated_at:d.updated_at||new Date().toISOString()});
    }
    if(calls.length){const {error}=await client.from('starwish_calls').upsert(calls,{onConflict:'id'});if(error)throw error;}
    if(diaries.length){const {error}=await client.from('starwish_diary').upsert(diaries,{onConflict:'id'});if(error)throw error;}
    const settings={user_id:user.id,rate_usd:state.data.rate,exchange_rate:state.data.fx,timezone:TZ,workday_reset_hour:7,updated_at:state.data.updated_at||new Date().toISOString()};
    const {error:se}=await client.from('starwish_settings').upsert(settings,{onConflict:'user_id'});if(se)throw se;
    await savePrefs({...state.preferences,deleted_call_ids:tombstones.calls,deleted_diary_ids:tombstones.diaries,calendar_month:state.month},state.view);
  }
  async function syncNow(isInitial=false) {
    if(!user||syncing)return;
    syncing=true;status('正在安全同步…');
    try{
      const [callRows,diaryRows,settingsResp,prefsResp]=await Promise.all([
        allRows('starwish_calls'),allRows('starwish_diary'),
        client.from('starwish_settings').select('*').eq('user_id',user.id).maybeSingle(),
        client.from('starwish_jar_preferences').select('*').eq('user_id',user.id).maybeSingle()
      ]);
      if(settingsResp.error)throw settingsResp.error;if(prefsResp.error)throw prefsResp.error;
      const remotePrefs=prefsResp.data?.preferences||{},meta=readMeta();
      const pending=JSON.parse(localStorage.getItem('starwish_pending_deletes')||'{"calls":[],"diaries":[]}');
      const pendingCalls=await Promise.all((pending.calls||[]).map(id=>idFor(user.id,'call',String(id))));
      const pendingDiaries=await Promise.all((pending.diaries||[]).map(id=>idFor(user.id,'diary',String(id))));
      const tomb={calls:[...new Set([...(meta.deleted_call_ids||[]),...(remotePrefs.deleted_call_ids||[]),...pendingCalls])],diaries:[...new Set([...(meta.deleted_diary_ids||[]),...(remotePrefs.deleted_diary_ids||[]),...pendingDiaries])]};
      const state=window.starwishApp.getState();
      const remoteCalls=callRows.filter(r=>!tomb.calls.includes(r.id)).map(callFromRow);
      const remoteDiaries=diaryRows.filter(r=>!tomb.diaries.includes(r.id)).map(r=>({id:r.id,at:Date.parse(r.created_at)||Date.now(),entryDay:r.entry_date,kind:r.category,note:r.content,updated_at:r.updated_at}));
      const cm=new Map(remoteCalls.map(x=>[x.id,x]));
      for(const c of state.data.calls){const id=await idFor(user.id,'call',String(c.id)),remote=cm.get(id);if(!tomb.calls.includes(id)&&(!remote||Date.parse(c.updated_at||0)>Date.parse(remote.updated_at||0)))cm.set(id,{...c,id});}
      const dm=new Map(remoteDiaries.map(x=>[x.id,x]));
      for(const d of state.diaries){const id=await idFor(user.id,'diary',String(d.id)),remote=dm.get(id);if(!tomb.diaries.includes(id)&&(!remote||Date.parse(d.updated_at||0)>Date.parse(remote.updated_at||0)))dm.set(id,{...d,id});}
      const mergedCalls=[...cm.values()],mergedDiaries=[...dm.values()];
      const settings=settingsResp.data;
      const localSettingsNewer=state.data.updated_at&&settings?.updated_at&&Date.parse(state.data.updated_at)>Date.parse(settings.updated_at);
      window.starwishApp.applyCloudState({calls:mergedCalls,diaries:mergedDiaries,rate:localSettingsNewer||!settings?state.data.rate:Number(settings.rate_usd),fx:localSettingsNewer||!settings?state.data.fx:Number(settings.exchange_rate),settingsUpdatedAt:localSettingsNewer?state.data.updated_at:settings?.updated_at,preferences:remotePrefs,view:prefsResp.data?.preferred_view||state.view,month:remotePrefs.calendar_month||state.month});
      await uploadState(window.starwishApp.getState(),tomb);
      writeMeta({...tomb,migrated:true,last_sync:new Date().toISOString()});
      localStorage.removeItem('starwish_pending_deletes');
      status(`已同步到云端 · ${user.email}`); lastSyncError='';
    }catch(err){
      console.error('Starwish sync failed',err); lastSyncError=err.message||String(err);
      status(`云端保存失败：${lastSyncError}。本机副本仍保留，请检查网络后点“立即同步”。`,true);
    }finally{syncing=false;}
  }
  function queueSync(){clearTimeout(timer);timer=setTimeout(()=>syncNow(!readMeta().migrated),350);}
  async function deleteCloud(type,id){
    if(!user){const pending=JSON.parse(localStorage.getItem('starwish_pending_deletes')||'{"calls":[],"diaries":[]}');const list=type==='call'?pending.calls:pending.diaries;if(!list.includes(id))list.push(id);localStorage.setItem('starwish_pending_deletes',JSON.stringify(pending));status('删除会在下次登录后同步到云端。');return;}
    const cloudId=await idFor(user.id,type,id),key=type==='call'?'deleted_call_ids':'deleted_diary_ids',meta=readMeta(),tomb=[...new Set([...(meta[key]||[]),cloudId])];
    try{const table=type==='call'?'starwish_calls':'starwish_diary';const {error}=await client.from(table).delete().eq('id',cloudId).eq('user_id',user.id);if(error)throw error;writeMeta({...meta,[key]:tomb});await savePrefs({...window.starwishApp.getState().preferences,[key]:tomb},window.starwishApp.getState().view);status(`已同步删除 · ${user.email}`);}
    catch(err){writeMeta({...meta,[key]:tomb});status(`删除尚未同步：${err.message||err}。本机已删除，请稍后点“立即同步”。`,true);}
  }
  function setAuthState(session){
    user=session?.user||null;
    $('authControls').classList.toggle('hidden',!!user);$('signedInControls').classList.toggle('hidden',!user);
    if(user){$('signedInEmail').textContent=user.email||'已登录';status('已登录，正在载入云端数据…');syncNow(!readMeta().migrated);}
    else status('未登录：数据仅保存在本机。登录后可跨设备同步。');
  }
  $('signUp').onclick=async()=>{
    const email=$('authEmail').value.trim(),password=$('authPassword').value;
    if(!email||password.length<8)return toast('请输入有效邮箱和至少 8 位密码');
    $('signUp').disabled=true;try{const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:'https://cherrong0120.github.io/starwish-money-jar/'}});if(error)throw error;if(data.session){setAuthState(data.session);toast('注册成功，正在同步');}else toast('注册已提交。请打开邮箱里的验证链接，再回到本网站登录。');}
    catch(e){toast(`注册失败：${e.message}`);}finally{$('signUp').disabled=false;}
  };
  $('signIn').onclick=async()=>{
    const email=$('authEmail').value.trim(),password=$('authPassword').value;if(!email||!password)return toast('请填写邮箱和密码');
    $('signIn').disabled=true;try{const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;setAuthState(data.session);}
    catch(e){toast(`登录失败：${e.message}`);}finally{$('signIn').disabled=false;}
  };
  $('signOut').onclick=async()=>{const {error}=await client.auth.signOut();if(error)toast(`退出失败：${error.message}`);else setAuthState(null);};
  $('syncNow').onclick=()=>syncNow(!readMeta().migrated);
  $('exportCloud').onclick=()=>window.starwishApp.exportBackup();
  $('importCloud').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!Array.isArray(obj.calls)||obj.calls.some(c=>!window.starwishApp.validCall(c)))throw Error('备份文件格式不正确');if(!confirm('导入后会合并云端记录；相同 ID 会自动跳过。继续吗？'))return;const s=window.starwishApp.getState();s.data={calls:obj.calls,rate:Number(obj.rate)>0?Number(obj.rate):.35,fx:Number(obj.fx)>0?Number(obj.fx):4.4};s.diaries=Array.isArray(obj.diaries)?obj.diaries.filter(d=>d&&typeof d.note==='string'):s.diaries;window.starwishApp.applyLocalState(s);if(user)await syncNow(false);toast('备份已导入并合并；请检查同步状态。');}catch(err){toast(`导入失败：${err.message}`);}finally{e.target.value='';}};
  document.addEventListener('starwish:localchange',queueSync);
  document.addEventListener('starwish:deletecall',e=>deleteCloud('call',e.detail.id));
  document.addEventListener('starwish:deletediary',e=>deleteCloud('diary',e.detail.id));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&user)syncNow(false);});
  client.auth.getSession().then(({data,error})=>{if(error){status(`登录状态读取失败：${error.message}`,true);return;}setAuthState(data.session);});
  client.auth.onAuthStateChange((_event,session)=>setAuthState(session));
})();
