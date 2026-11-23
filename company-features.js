/* Company filters, shared daily/monthly jar, and independent Lionbridge availability tracker. */
(() => {
  'use strict';
  const app = window.starwishApp;
  if (!app) return;
  const $ = id => document.getElementById(id);
  const PREF_KEY = 'money_jar_preferences_v1';
  const TZ = 'Asia/Kuala_Lumpur';
  const DAILY_TARGET = 192;
  const WEEKLY_TARGET = 960;
  const fmt = n => Number(n).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatDuration = value => { const n=Math.max(0,Math.round(Number(value)||0));return `${Math.floor(n/60)}小时${String(n%60).padStart(2,'0')}分钟`; };
  const ymd = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  const asUTCDate = day => new Date(`${day}T12:00:00Z`);
  const shiftDate = (day, amount) => { const d=asUTCDate(day); d.setUTCDate(d.getUTCDate()+amount); return ymd(d); };
  const weekStart = day => { const d=asUTCDate(day); d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)); return ymd(d); };
  const todayMYT = () => new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const toast = message => { const el=$('toast');if(!el)return;el.textContent=message;el.classList.remove('hidden');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.add('hidden'),3500); };
  let state = app.getState();
  let prefs = {...(state.preferences||{})};
  try { prefs = {...JSON.parse(localStorage.getItem(PREF_KEY)||'{}'),...prefs}; } catch(e) {}
  if (!Array.isArray(prefs.company_profiles) || !prefs.company_profiles.length) {
    prefs.company_profiles = [
      {id:'lionbridge',name:'Lionbridge',rateUsd:.35},
      {id:'propio',name:'Propio',rateUsd:.30}
    ];
  }
  prefs.call_companies = prefs.call_companies || {};
  prefs.availability = prefs.availability || {daily:{}};
  prefs.availability.daily = prefs.availability.daily || {};
  prefs.active_company = prefs.active_company || prefs.company_profiles[0]?.id || '';
  prefs.profile_editor_company = prefs.profile_editor_company || prefs.company_profiles[0]?.id || '';
  // Keep the call form's selection separately from cloud-driven preference refreshes.
  const CALL_COMPANY_KEY = 'starwish_call_company_selection_v1';
  let selectedCallCompanyId = (()=>{try{return localStorage.getItem(CALL_COMPANY_KEY)||prefs.active_company;}catch(e){return prefs.active_company;}})();
  function rememberCallCompany(id){selectedCallCompanyId=id;try{localStorage.setItem(CALL_COMPANY_KEY,id);}catch(e){}}
  let activeFilter = 'all';
  let availabilityMode = 'day';
  let renderedProfileSignature = '';

  function setPrefs(next, dirty=true) {
    prefs = {...next};
    if (dirty) prefs.preferences_dirty = true;
    app.setCloudPreferences(prefs);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }
    catch(e) { window.alert('本机设置保存失败，请检查浏览器存储空间。'); }
    if (dirty) document.dispatchEvent(new Event('starwish:localchange'));
  }
  app.setCloudPreferences(prefs);
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch(e) {}

  function profiles() {
    if(!Array.isArray(prefs.company_profiles)||!prefs.company_profiles.length){
      prefs.company_profiles=[{id:'lionbridge',name:'Lionbridge',rateUsd:.35},{id:'propio',name:'Propio',rateUsd:.30}];
      app.setCloudPreferences(prefs);try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs));}catch(e){}
    }
    return prefs.company_profiles.filter(p=>p&&p.id&&p.name);
  }
  function companyName(id) { return profiles().find(p=>p.id===id)?.name || (id?(prefs.archived_company_names?.[id]||'已归档公司'):'未分类旧记录'); }
  window.starwishCompanyName = companyName;
  window.starwishEscapeHtml = escapeHtml;
  window.starwishMergePreferences = (local,incoming) => {
    const a=local||{},b=incoming||{};
    const deleted=[...new Set([...(a.deleted_company_ids||[]),...(b.deleted_company_ids||[])])];
    const profs=new Map([...(a.company_profiles||[]),...(b.company_profiles||[])].filter(p=>p&&!deleted.includes(p.id)).map(p=>[p.id,p]));
    return {...a,...b,preferences_dirty:true,deleted_company_ids:deleted,company_profiles:[...profs.values()],archived_company_names:{...(a.archived_company_names||{}),...(b.archived_company_names||{})},call_companies:{...(a.call_companies||{}),...(b.call_companies||{})},availability:{...(a.availability||{}),...(b.availability||{}),daily:{...((a.availability||{}).daily||{}),...((b.availability||{}).daily||{})}}};
  };
  window.starwishRateForEstimate = () => {
    const id=$('callCompanyId')?.value||prefs.active_company;
    const p=profiles().find(x=>x.id===id);
    return Number(p?.rateUsd)||Number(app.getState().data.rate)||.35;
  };

  const styles=document.createElement('style');
  styles.textContent=`
    .company-filter{display:flex;gap:8px;overflow-x:auto;padding:10px 0 14px;scrollbar-width:thin}
    .company-filter button,.availability-tabs button{white-space:nowrap;border:1px solid #efd9e6;background:#fffafd;color:#8f6980;border-radius:999px;padding:9px 13px;font:inherit;font-size:13px;font-weight:750;cursor:pointer}
    .company-filter button.active,.availability-tabs button.active{background:#d986ac;color:white;border-color:#d986ac;box-shadow:0 4px 12px #d986ac33}
    .company-editor{padding:14px;background:#fff7fb;border:1px solid #f1dce8;border-radius:16px;margin-bottom:14px}
    .company-editor .fields{margin-top:8px}
    .availability-box{background:linear-gradient(135deg,#fff5f8,#f7f0ff);border:1px solid #efdde9;border-radius:18px;padding:16px;margin:12px 0}
    .availability-tabs{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}
    .availability-inputs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .availability-bar{height:14px;background:#f0e3ec;border-radius:99px;overflow:hidden;margin:12px 0 8px}
    .availability-bar>span{display:block;height:100%;background:linear-gradient(90deg,#ec8eb6,#ad9de8);border-radius:99px;transition:width .25s}
    .availability-summary{font-weight:800;color:#76536b;line-height:1.6}
    .availability-sub{color:#987e90;font-size:13px;line-height:1.6}
    .company-time{display:block;color:#987e90;font-size:12px;margin-top:3px}
    .wrap{width:100%;max-width:1480px;padding-left:clamp(18px,3vw,46px);padding-right:clamp(18px,3vw,46px)}
    .layout{grid-template-columns:minmax(0,1.35fr) minmax(380px,.65fr);gap:clamp(20px,2.5vw,38px)}
    .company-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:10px}
    .company-actions .btn{min-width:0;padding:11px 8px;line-height:1.3}
    .btn.company-delete{background:#fff0f3;color:#b75e76}
    .availability-panel{margin-top:18px}
    @media(max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}.wrap{padding-left:18px;padding-right:18px}}
    @media(max-width:520px){.availability-box{padding:13px}.company-filter{margin-left:-3px;margin-right:-3px}}
  `;
  document.head.appendChild(styles);

  function mountCompanyControls() {
    const panel=$('dailyJarPanel'), viewSwitch=panel?.querySelector('.view-switch');
    if(viewSwitch&&!$('companyFilter')) viewSwitch.insertAdjacentHTML('afterend','<div class="company-filter" id="companyFilter" role="group" aria-label="按公司筛选存钱罐"></div>');
    const minutesLabel=document.querySelector('label[for="minutes"]');
    if(minutesLabel&&!$('callCompanyId')) minutesLabel.insertAdjacentHTML('beforebegin','<label for="callCompanyId">这通电话所属公司</label><select id="callCompanyId" aria-label="选择这通电话所属公司"></select>');
    const fields=$('settings')?.querySelector('.fields');
    if(fields&&!$('companyProfileEditor')){
      const editor=document.createElement('div');
      editor.className='company-editor';editor.id='companyProfileEditor';
      editor.innerHTML='<strong>🏷️ 公司费率</strong><label for="profileCompanySelect">正在编辑</label><select id="profileCompanySelect"></select><label for="profileCompanyName">公司名称</label><input id="profileCompanyName" maxlength="60" placeholder="例如 Lionbridge"><div class="company-actions"><button type="button" class="btn secondary" id="addCompanyProfile">＋ 添加公司</button><button type="button" class="btn company-delete" id="deleteCompanyProfile">删除所选公司</button></div><p class="sectionnote">电话记录保留当时的公司和费率；删除只会归档公司，不会删除记录。</p>';
      fields.parentElement.insertBefore(editor,fields);
      const rateLabel=document.querySelector('label[for="rate"]');
      if(rateLabel) rateLabel.textContent='所选公司的每分钟费率（USD）';
      const saveButton=$('saveSettings');
      if(saveButton) saveButton.textContent='保存公司费率与参考汇率';
    }
    const calendarPanel=$('calendar')?.closest('.panel');
    if(calendarPanel&&!$('availabilityPanel')){
      const box=document.createElement('div');box.className='panel';box.id='availabilityPanel';
      box.classList.add('availability-panel');
      box.innerHTML='<h2>⏱️ Lionbridge 上线进度</h2><div class="sectionnote">工作日每天目标3小时12分钟，本周共16小时。超出时间抵扣后续工作日。</div><div class="availability-tabs" role="group" aria-label="上线进度查看方式"><button type="button" id="availabilityDayTab" class="active">每日</button><button type="button" id="availabilityWeekTab">本周</button></div><label for="availabilityDate">日期</label><input id="availabilityDate" type="date"><div class="availability-inputs"><div><label for="availabilityHours">小时</label><input id="availabilityHours" type="number" min="0" max="23" step="1" value="0" inputmode="numeric"></div><div><label for="availabilityMinutes">分钟</label><input id="availabilityMinutes" type="number" min="0" max="59" step="1" value="0" inputmode="numeric"></div></div><button type="button" class="btn" id="saveAvailability" style="width:100%;margin-top:12px">保存时长</button><div class="availability-box" id="availabilityResult" aria-live="polite"></div>';
      calendarPanel.insertAdjacentElement('afterend',box);
    }
    const monthlyPanel=$('monthlyPanel');
    if(monthlyPanel) monthlyPanel.classList.add('hidden');
  }

  function renderProfiles(force=false) {
    const activeIds=new Set(profiles().map(p=>p.id));
    const hasLegacy=app.getState().data.calls.some(c=>!c.companyId||!activeIds.has(c.companyId));
    const sig=JSON.stringify({profiles:profiles(),active:prefs.active_company,editor:prefs.profile_editor_company,hasLegacy});
    if(!force&&sig===renderedProfileSignature) return;
    renderedProfileSignature=sig;
    const callSelect=$('callCompanyId'),editSelect=$('profileCompanySelect');
    if(!callSelect||!editSelect) return;
    const list=profiles();
    if($('deleteCompanyProfile')) $('deleteCompanyProfile').disabled=list.length<=1;
    const options=list.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · US$ ${fmt(p.rateUsd)}/分钟</option>`).join('');
    callSelect.innerHTML=options;editSelect.innerHTML=options;
    if(!list.some(p=>p.id===selectedCallCompanyId)) selectedCallCompanyId=prefs.active_company&&list.some(p=>p.id===prefs.active_company)?prefs.active_company:(list[0]?.id||'');
    if(!list.some(p=>p.id===prefs.active_company)) prefs.active_company=selectedCallCompanyId;
    if(!list.some(p=>p.id===prefs.profile_editor_company)) prefs.profile_editor_company=list[0]?.id||'';
    // Rebuilding option elements resets a focused <select> to its first option;
    // always restore the intended value after replacing its options.
    callSelect.value=selectedCallCompanyId;
    if(document.activeElement!==editSelect) editSelect.value=prefs.profile_editor_company;
    const editorProfile=list.find(p=>p.id===editSelect.value)||list[0];
    if(editorProfile){if(document.activeElement!==$('profileCompanyName'))$('profileCompanyName').value=editorProfile.name;if(document.activeElement!==$('rate'))$('rate').value=editorProfile.rateUsd;}
    const filter=$('companyFilter');
    if(filter){
      const choices=[{id:'all',label:'全部公司'},...list.map(p=>({id:p.id,label:`${p.name} · US$${Number(p.rateUsd).toFixed(2)}`})),...(hasLegacy?[{id:'legacy',label:'未分类 / 已归档'}]:[])];
      if(!choices.some(x=>x.id===activeFilter)) activeFilter='all';
      filter.innerHTML=choices.map(x=>`<button type="button" data-company-filter="${escapeHtml(x.id)}" class="${activeFilter===x.id?'active':''}">${escapeHtml(x.label)}</button>`).join('');
    }
  }

  function getFilteredCalls(period) {
    const calls=app.getState().data.calls;
    return calls.filter(c=>{
      const periodMatch=period==='day'?c.day===app.getState().selected:c.day?.slice(0,7)===app.getState().month;
      const activeIds=new Set(profiles().map(p=>p.id));
      const companyMatch=activeFilter==='all'||(activeFilter==='legacy'?(!c.companyId||!activeIds.has(c.companyId)):c.companyId===activeFilter);
      return periodMatch&&companyMatch;
    });
  }
  function summarize(period) {
    const calls=getFilteredCalls(period);
    return {rm:calls.reduce((a,c)=>a+Number(c.rm||0),0),usd:calls.reduce((a,c)=>a+Number(c.usd||0),0),minutes:calls.reduce((a,c)=>a+Number(c.minutes||0),0),count:calls.length};
  }

  function renderJar() {
    if(!$('companyFilter')) return;
    const s=app.getState();prefs=s.preferences||prefs;
    const monthly=s.view==='monthly',sum=summarize(monthly?'month':'day');
    const hero=$('dailyJarPanel').querySelector('.hero .muted');
    if(hero) hero.textContent=monthly?'本月预估收入':'当日预估收入';
    if(monthly){
      $('dateTitle').textContent=`${s.month.slice(0,4)}年${Number(s.month.slice(5,7))}月星愿收藏`;
      $('periodLabel').textContent='整月累计 · MYT';
    }else{
      $('dateTitle').textContent=s.selected===s.today?'当前工作日收藏':'历史收藏 · '+s.selected;
      $('periodLabel').textContent='MYT 07:00 换日';
    }
    $('dayRM').textContent='RM '+fmt(sum.rm);
    $('callCount').textContent=sum.count+' 通电话';
    $('dayMinutes').textContent=formatDuration(sum.minutes)+' 通话时长';
    $('listDate').textContent=monthly?s.month:s.selected;
    $('workDay').value=s.selected;
    app.refreshJar(sum.rm);
    const label=$('jarScene')||document.querySelector('#dailyJarPanel .jar-scene');
    if(label) label.setAttribute('aria-label',monthly?'月度爱心金币存钱罐':'每日爱心金币存钱罐');
    const eyebrow=document.querySelector('#dailyJarPanel .jar-eyebrow');
    if(eyebrow) eyebrow.textContent=monthly?'MONTHLY LITTLE TREASURE':"TODAY'S LITTLE TREASURE";
    if(monthly){$('jarStatus').textContent=sum.rm>=20?'本月的爱心金币正在闪闪发光 ✨':'本月的宝藏正在等待你 ✨';$('jarHint').textContent='本月每累计 RM20，就点亮一枚爱心金币';}
    else $('jarHint').textContent='每赚 RM20，就点亮一枚爱心金币';
    const note=document.querySelector('#dailyJarPanel>.sectionnote');
    if(note) note.textContent=monthly?'✨ 每累计 RM20，点亮一枚月度爱心金币。整月沿用每日存钱罐的金币、摇晃和点亮册。':'✨ 每满 RM20，点亮一枚爱心金币。每天早上 7 点开启新罐子，旧日成果保留在日历。';
    const count=$('jarLitCount');
    if(count) count.textContent=Math.floor((sum.rm+1e-7)/20)+' 枚已点亮';
    renderProfiles();
    renderAvailability();
  }

  function weekDates(day) { const first=weekStart(day);return Array.from({length:7},(_,i)=>shiftDate(first,i)); }
  function weekday(day) { return asUTCDate(day).getUTCDay(); }
  function minutesFor(day) { return Math.max(0,Number(prefs.availability.daily[day])||0); }
  function workingWeekTotal(day) { return weekDates(day).slice(0,5).reduce((n,d)=>n+minutesFor(d),0); }
  function dailyAdjustedTarget(day) {
    const wd=weekday(day);
    if(wd===0||wd===6) return 0;
    const monday=weekStart(day), elapsed=(wd+6)%7;
    let previous=0;
    for(let i=0;i<elapsed;i++) previous+=minutesFor(shiftDate(monday,i));
    return Math.max(0,DAILY_TARGET*(elapsed+1)-previous);
  }
  function renderAvailability() {
    if(!$('availabilityResult')) return;
    const day=$('availabilityDate').value||todayMYT(),done=minutesFor(day),week=workingWeekTotal(day),target=dailyAdjustedTarget(day),weekStartDay=weekStart(day);
    $('availabilityDayTab').classList.toggle('active',availabilityMode==='day');
    $('availabilityWeekTab').classList.toggle('active',availabilityMode==='week');
    if(document.activeElement!==$('availabilityDate')) $('availabilityDate').value=day;
    if(document.activeElement!==$('availabilityHours')) $('availabilityHours').value=Math.floor(done/60);
    if(document.activeElement!==$('availabilityMinutes')) $('availabilityMinutes').value=done%60;
    const pct=availabilityMode==='week'?Math.min(100,week/WEEKLY_TARGET*100):(target?Math.min(100,done/target*100):(done?100:0));
    const startLabel=weekStartDay,endLabel=shiftDate(weekStartDay,4);
    if(availabilityMode==='week'){
      const remaining=Math.max(0,WEEKLY_TARGET-week),surplus=Math.max(0,week-WEEKLY_TARGET);
      $('availabilityResult').innerHTML=`<div class="availability-summary">本周 ${formatDuration(week)} / 16小时</div><div class="availability-bar"><span style="width:${pct.toFixed(1)}%"></span></div><div class="availability-sub">${remaining?`还差 ${formatDuration(remaining)}`:`已达标${surplus?` · 超出 ${formatDuration(surplus)}`:''}`}</div>`;
    }else if(weekday(day)===0||weekday(day)===6){
      const remaining=Math.max(0,WEEKLY_TARGET-week);
      $('availabilityResult').innerHTML=`<div class="availability-summary">周末 · 本周 ${formatDuration(week)} / 16小时</div><div class="availability-bar"><span style="width:${Math.min(100,week/WEEKLY_TARGET*100).toFixed(1)}%"></span></div><div class="availability-sub">${remaining?`还差 ${formatDuration(remaining)}`:'周目标已完成'}</div>`;
    }else{
      const remaining=Math.max(0,target-done),surplus=Math.max(0,done-target);
      $('availabilityResult').innerHTML=`<div class="availability-summary">今日 ${formatDuration(done)} / 目标 ${formatDuration(target)}</div><div class="availability-bar"><span style="width:${pct.toFixed(1)}%"></span></div><div class="availability-sub">${remaining?`还差 ${formatDuration(remaining)}`:`已完成${surplus?` · 超出 ${formatDuration(surplus)} 抵扣后续`:''}`}</div><div class="availability-sub">本周 ${formatDuration(week)} / 16小时</div>`;
    }
  }

  function saveAvailability() {
    const day=$('availabilityDate').value||todayMYT();
    const h=Number($('availabilityHours').value),m=Number($('availabilityMinutes').value);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isInteger(h)||h<0||h>23||!Number.isInteger(m)||m<0||m>59){window.alert('请填写有效的小时和分钟（小时 0–23，分钟 0–59）。');return;}
    const daily={...prefs.availability.daily,[day]:h*60+m};
    setPrefs({...prefs,availability:{...prefs.availability,daily}});
    renderAvailability();
    const target=dailyAdjustedTarget(day),done=minutesFor(day);
    toast(target&&done>=target?'上线时长已保存，今日目标完成！':'上线时长已保存');
  }

  function persistSettings() {
    const id=$('profileCompanySelect').value,profile=profiles().find(p=>p.id===id);
    const name=$('profileCompanyName').value.trim(),rate=Number($('rate').value),fx=Number($('fx').value);
    if(!profile) return window.alert('请先选择公司。');
    if(!name) return window.alert('请填写公司名称。');
    if(!(rate>0&&Number.isFinite(rate)&&fx>0&&Number.isFinite(fx))) return window.alert('每分钟费率和参考汇率必须大于零。');
    const company_profiles=profiles().map(p=>p.id===id?{...p,name,rateUsd:rate}:p);
    const active_company=$('callCompanyId').value||id;
    setPrefs({...prefs,company_profiles,active_company,profile_editor_company:id});
    const data=app.getState().data;data.rate=rate;data.fx=fx;data.settings_dirty=true;data.updated_at=new Date().toISOString();
    if(!app.persist()) return;
    renderProfiles(true);renderJar();
    $('estimate').textContent='已保存 '+name+' 的费率与参考汇率。新记录使用新费率，历史金额不变。';
  }

  function addProfile() {
    const id='company_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
    const p={id,name:`新公司 ${profiles().length+1}`,rateUsd:Number($('rate').value)||.35};
    const company_profiles=[...profiles(),p];
    rememberCallCompany(id);
    prefs={...prefs,company_profiles,active_company:id,profile_editor_company:id};
    setPrefs(prefs);renderProfiles(true);$('profileCompanyName').focus();$('profileCompanyName').select();
  }

  function deleteProfile() {
    const id=$('profileCompanySelect').value,profile=profiles().find(p=>p.id===id),list=profiles();
    if(!profile) return;
    if(list.length<=1) return toast('至少保留一个公司费率');
    if(!window.confirm(`删除“${profile.name}”的费率设置？已有电话记录会保留，并归入“未分类 / 已归档”。`)) return;
    const company_profiles=list.filter(p=>p.id!==id),archived_company_names={...(prefs.archived_company_names||{}),[id]:profile.name},deleted_company_ids=[...new Set([...(prefs.deleted_company_ids||[]),id])];
    const nextId=company_profiles[0].id;
    if(selectedCallCompanyId===id) rememberCallCompany(nextId);
    setPrefs({...prefs,company_profiles,archived_company_names,deleted_company_ids,active_company:prefs.active_company===id?nextId:prefs.active_company,profile_editor_company:id===prefs.profile_editor_company?nextId:prefs.profile_editor_company});
    renderProfiles(true);renderJar();toast(`已删除 ${profile.name} 费率，历史电话记录已保留`);
  }

  function recordCall(e) {
    e.preventDefault();e.stopImmediatePropagation();
    const s=app.getState(),data=s.data,minutes=Number($('minutes').value),day=$('workDay').value,fx=Number(data.fx)||4.4;
    const company=profiles().find(p=>p.id===$('callCompanyId').value);
    if(!company) return window.alert('请先在设置中添加并选择公司费率。');
    if(!Number.isFinite(minutes)||minutes<=0||minutes>10000||!/^\d{4}-\d{2}-\d{2}$/.test(day)) return window.alert('请填写有效的分钟数和日期。');
    const usd=minutes*Number(company.rateUsd),rm=usd*fx;
    const editingId=app.getState().editId;
    if(editingId){const c=data.calls.find(x=>x.id===editingId);if(c){c.minutes=minutes;c.day=day;c.usd=usd;c.rm=rm;c.companyId=company.id;c.time='已修改';}}
    else data.calls.push({id:String(Date.now())+'_'+Math.random().toString(36).slice(2),day,minutes,usd,rm,companyId:company.id,time:new Intl.DateTimeFormat('zh-CN',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}).format(new Date())});
    data.rate=Number(company.rateUsd);
    if(!app.persist()) return;
    app.setSelection(day);app.resetCallForm();
    toast(`已记录 ${company.name} 电话 · US$ ${fmt(usd)} ≈ RM ${fmt(rm)}`);
  }

  function install() {
    mountCompanyControls();
    renderProfiles(true);
    $('showDailyJar').onclick=()=>app.setJarMode('daily');
    $('showMonthlyJar').onclick=()=>app.setJarMode('monthly');
    $('callCompanyId').onchange=()=>{rememberCallCompany($('callCompanyId').value);prefs.active_company=selectedCallCompanyId;setPrefs(prefs);$('minutes').dispatchEvent(new Event('input'));};
    $('profileCompanySelect').onchange=()=>{
      prefs.profile_editor_company=$('profileCompanySelect').value;
      const p=profiles().find(x=>x.id===prefs.profile_editor_company);if(p){$('profileCompanyName').value=p.name;$('rate').value=p.rateUsd;}
    };
    $('addCompanyProfile').onclick=addProfile;
    $('deleteCompanyProfile').onclick=deleteProfile;
    $('saveSettings').onclick=persistSettings;
    $('callForm').addEventListener('submit',recordCall,true);
    $('minutes').addEventListener('input',()=>{
      const mins=Number($('minutes').value),p=profiles().find(x=>x.id===$('callCompanyId').value),fx=Number(app.getState().data.fx)||4.4;
      if(mins>0&&p) $('estimate').textContent=`${p.name} · US$ ${fmt(mins*p.rateUsd)} ≈ RM ${fmt(mins*p.rateUsd*fx)}（US$ ${p.rateUsd}/分钟，参考汇率 RM ${fx}/USD）`;
    });
    $('companyFilter').onclick=e=>{const b=e.target.closest('[data-company-filter]');if(!b)return;activeFilter=b.dataset.companyFilter;renderProfiles(true);window.starwishApp.render();window.starwishEnhanceRender();};
    $('prevMonth').onclick=()=>{const s=app.getState(),d=asUTCDate(s.month+'-15');d.setUTCMonth(d.getUTCMonth()-1);app.setMonth(ymd(d).slice(0,7));};
    $('nextMonth').onclick=()=>{const s=app.getState(),d=asUTCDate(s.month+'-15');d.setUTCMonth(d.getUTCMonth()+1);app.setMonth(ymd(d).slice(0,7));};
    $('availabilityDayTab').onclick=()=>{availabilityMode='day';renderAvailability();};
    $('availabilityWeekTab').onclick=()=>{availabilityMode='week';renderAvailability();};
    $('availabilityDate').value=todayMYT();
    $('availabilityDate').onchange=renderAvailability;
    $('saveAvailability').onclick=saveAvailability;
    $('records').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(!b)return;const c=app.getState().data.calls.find(x=>x.id===b.dataset.edit);if(c&&profiles().some(p=>p.id===c.companyId)){rememberCallCompany(c.companyId);$('callCompanyId').value=c.companyId;prefs.active_company=c.companyId;setPrefs(prefs);}} ,true);
    window.starwishEnhanceRender=renderJar;
    window.starwishRefreshCompanyInputs=()=>renderProfiles(true);
    app.render();renderProfiles(true);renderJar();
  }
  install();
})();
