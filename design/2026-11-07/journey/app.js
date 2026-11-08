'use strict';

const beats = [
  {id:'ask',label:'Ask',owner:'Phone · Ask for help',description:'Two people need drinking water near Hoblitzelle.'},
  {id:'wait',label:'Wait',owner:'Phone · My request',description:'The request stays on the phone while receipt is unconfirmed.'},
  {id:'understand',label:'Local processing',owner:'ECSW · Local agent',description:'The local agent validates the original fields and prepares a structured case automatically.'},
  {id:'regional',label:'Automatic coordination',owner:'ECSW · Supervisor connection',description:'Policy-allowed case fields are queued and shared automatically, without a per-case approval gate.'},
  {id:'coordinate',label:'Regional allocation',owner:'Supervisor · Regional agent',description:'Eligible simulated resources are allocated automatically; people handle exceptions.'},
  {id:'confirm',label:'Outcome',owner:'ECSW · Coordination update',description:'ECSW receives the accepted-resource update. The phone retains only its actual receipt evidence.'}
];
const categoryLabels = {1:'Medical',2:'Fire',3:'Rescue',4:'Safety',5:'Supplies'};
const severityLabels = {1:'Urgent',2:'Serious',3:'Assistance'};
const draft = Object.freeze({category:5,severity:3,people:2,note:'Need drinking water. Near Hoblitzelle entrance.'});
let request = {...draft};
let current = Math.max(0,beats.findIndex(beat=>beat.id===location.hash.slice(1)));
let saved = false;
let receiptConfirmed = false;
let reviewed = false;
let regionalQueued = false;
let processed = false;
let automationPaused = false;
let accepted = false;
let dispatchAcknowledged = false;
let shortage = false;
let alternate = false;
let phoneConfirmation = false;
let pendingException = false;
let locationOverride = '';
let caseRevision = 1;
let locationUpdatePending = false;
let lastSharedCase = null;
let catalogConsulted = false;
let offerRecorded = false;
const $ = id=>document.getElementById(id);
const escape = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byteLength = text=>new TextEncoder().encode(text).length;
const button = (text,action,kind='link')=>`<button type="button" class="${kind}" data-action="${action}">${text}</button>`;
const details = (title,content)=>`<details><summary>${title}</summary>${content}</details>`;
const offerTown = ()=>alternate?'Garland':'Plano';
const requiredKits = 2;
const seededStock = {Plano:8,Garland:4};
const availableStock = ()=>shortage&&!alternate?1:seededStock[offerTown()];
const canAllocate = ()=>availableStock()>=requiredKits;
const remainingStock = ()=>availableStock()-(accepted?requiredKits:0);
const caseLocation = ()=>locationOverride||'Near Hoblitzelle entrance';
const hasMappedLandmark = ()=>/hoblitzelle|\bhh\b/i.test(caseLocation());
function syncStoryState(index){
  if(index>=1)saved=true;
  if(index>=2){receiptConfirmed=true;processed=true;}
  if(processed&&(index>=3||regionalQueued)&&!automationPaused){
    if(!lastSharedCase||lastSharedCase.revision!==caseRevision){
      lastSharedCase=Object.freeze({id:'REG-042',sourceId:'DEMO-042',revision:caseRevision,category:request.category,severity:request.severity,people:request.people,quantity:requiredKits,location:caseLocation(),provenance:locationOverride?'Operator-corrected':'Sender-entered'});
    }
    regionalQueued=true;
    locationUpdatePending=false;
  }
  if(index>=4&&lastSharedCase&&!automationPaused){
    catalogConsulted=true;
    offerRecorded=true;
    if(!accepted)accepted=canAllocate();
  }
  if(index>=5&&accepted&&!automationPaused)dispatchAcknowledged=true;
}

function phoneTop(active='Ask for help'){
  return `<header class="phone-top"><strong>RescueMesh</strong>${button('Setup','setup')}</header><div class="phone-body">`;
}
function phoneBottom(active='Ask for help'){
  return `</div><nav class="phone-tabs" aria-label="Phone sections"><button type="button" data-action="phone-ask" ${active==='Ask for help'?'aria-current="page"':''}>Ask for help</button><button type="button" data-action="phone-request" ${active==='My request'?'aria-current="page"':''}>My request</button></nav>`;
}
function askView(){
  return phoneTop()+`<p class="phone-context">UT Dallas · ECSW · Read-only example</p><h1>Ask for help</h1><form id="request-form" class="request-form"><label>Kind of help<select name="category" id="category" disabled>${Object.entries(categoryLabels).map(([value,label])=>`<option value="${value}" ${Number(value)===draft.category?'selected':''}>${label}</option>`).join('')}</select></label><div class="people-row"><span>People who need help</span><div class="stepper"><button type="button" data-action="fewer" aria-label="One fewer person" disabled>−</button><output id="people" aria-live="polite">${draft.people}</output><button type="button" data-action="more" aria-label="One more person" disabled>+</button></div></div><label>What do you need, and where?<textarea id="note" name="note" aria-describedby="note-help" readonly>${escape(draft.note)}</textarea></label><p class="fine" id="note-help">Fixed synthetic example. Landmark entered by sender; no GPS.</p>${details('Situation',`<label for="severity" class="sr-only">Sender-reported severity</label><select id="severity" name="severity" disabled>${Object.entries(severityLabels).map(([value,label])=>`<option value="${value}" ${Number(value)===draft.severity?'selected':''}>${label}</option>`).join('')}</select><p class="fine">Your reported situation, not an automated assessment.</p>`)}<p id="form-error" class="error-message" role="alert"></p><button type="submit" class="primary">Send request</button><p class="fine">Your request is saved on this phone until a hub confirms receipt.</p></form>`+phoneBottom();
}
function deliveryDetails(){
  return details('Delivery details',`<p>Phone request DEMO-042</p><ol><li>Saved on phone · 21:40:12</li><li>Submitted to radio · 21:41:03</li><li>${receiptConfirmed?'ECSW receipt confirmed · 21:42:18':'ECSW receipt not confirmed'}</li><li>${reviewed?'Operator reviewed · 21:43:07':'Operator review not confirmed'}</li></ol><p>Retry keeps the same request identity and saved payload. Regional allocation is a separate object.</p>`);
}
function waitView(final=false){
  const title=final&&reviewed?'ECSW reviewed your request':receiptConfirmed?'Received by ECSW':'Waiting for ECSW receipt';
  return phoneTop('My request')+`<section class="phone-status"><p class="phone-context">My request · DEMO-042</p><h1>${title}</h1><p>${final&&reviewed?'An operator has reviewed the request.':receiptConfirmed?'The hub confirmed receipt. Automatic processing is not a human-review receipt.':'Your request is saved. The radio has submitted it, but a hub receipt is not confirmed yet.'}</p><p class="saved-note">${escape(request.note)}</p><p class="phone-inline">${request.people} people · ${escape(categoryLabels[request.category])}<br>Landmark entered by you · No GPS</p>${deliveryDetails()}${!receiptConfirmed?`<div class="actions">${button('Retry same request','retry','primary')}</div><p id="retry-status" class="fine" role="status"></p>`:''}<p class="fine">This phone confirms receipt, not emergency-service dispatch.</p>${final?button('Back to local case','back-confirm'):''}</section>`+phoneBottom('My request');
}
function appTop(supervisor=false){
  return `<header class="app-top"><span class="brand">RescueMesh</span><span class="place">${supervisor?'Regional supervisor':'ECSW · Local hub'}</span><div class="right">${supervisor?button('History','history'):button('Inspect summary','inspect-summary')}${button(automationPaused?'Resume automation':'Pause automation','toggle-automation')}</div></header>`;
}
function campusMap(){
  const mapped=hasMappedLandmark();
  return `<section class="map-view" aria-label="Offline campus schematic"><div class="map-head"><p><strong>UT Dallas</strong> · Campus schematic</p><p>${locationOverride?'Operator correction':'Manual landmark'}</p></div><div class="map-canvas"><svg viewBox="0 0 650 450" role="img" aria-labelledby="campus-title campus-desc"><title id="campus-title">ECSW and approximate campus landmarks</title><desc id="campus-desc">Public building names on a schematic. ${mapped?'A hatched area represents an unverified Hoblitzelle landmark.':'The corrected landmark is unlocated and has no map marker.'} No GPS, measured range or radio route is shown.</desc><defs><pattern id="landmark-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 0V9" stroke="#d58ab2" stroke-width="2" opacity=".5"/></pattern></defs>
  <path d="M40 80H600M85 380H590M100 35V420M345 30V425M595 30V425" fill="none" stroke="#f4f4f1" stroke-width="17"/><path d="M40 250H610M485 35V425" fill="none" stroke="#fafaf7" stroke-width="10"/><path d="M103 140H595M170 80V380M100 315H590" fill="none" stroke="#d1d4cf" stroke-width="2"/>
  ${mapped?'<rect x="195" y="90" width="133" height="135" fill="url(#landmark-hatch)" stroke="#d58ab2" stroke-dasharray="4 5"/>':''}<rect x="215" y="112" width="83" height="62" rx="2" fill="#c9cdc7" stroke="#b3b9af"/><path d="M368 277h97v92h-32v-55h-33v55h-32z" fill="#c3c9bf" stroke="#aab2a6"/><rect x="196" y="279" width="95" height="38" fill="#d0d4ca"/><rect x="393" y="109" width="65" height="91" fill="#d0d4ca"/><rect x="508" y="146" width="61" height="55" fill="#d0d4ca"/><rect x="505" y="290" width="62" height="75" fill="#d0d4ca"/>
  ${mapped?'<circle cx="309" cy="177" r="7" fill="#E20074"/><text x="185" y="244" class="map-label selected">Reported area · unverified</text>':''}<text x="212" y="72" class="map-label strong">Hoblitzelle · HH</text><text x="376" y="398" class="map-label strong">ECSW</text><text x="374" y="416" class="map-label small">Receiving hub</text><text x="391" y="91" class="map-label">Founders</text><text x="505" y="132" class="map-label">Library</text><text x="206" y="343" class="map-label">ECSS</text></svg></div><p class="map-caption">${mapped?'The hatched area represents an approximate typed landmark, not GPS.':'The corrected landmark is not positioned on this schematic.'} No radio route or coverage boundary is shown.</p><details class="map-list"><summary>Places and unlocated reports</summary><ul><li>ECSW · Physical receiving hub</li><li>${escape(caseLocation())} · ${locationOverride?'Operator-corrected':'Sender-entered'} landmark, ${mapped?'entrance unverified':'unlocated'}</li><li>Unlocated · One other synthetic report has no usable location; it stays in the list.</li></ul></details></section>`;
}
function original(){
  return `<blockquote class="original"><p>“${escape(request.note)}”</p><cite>Original example phone request · DEMO-042</cite></blockquote><dl class="source-facts"><div><dt>People</dt><dd>${request.people}</dd></div><div><dt>Kind of help</dt><dd>${escape(categoryLabels[request.category])}</dd></div><div><dt>Reported situation</dt><dd>${escape(severityLabels[request.severity])}</dd></div></dl><p class="uncertainty">${escape(caseLocation())} · ${locationOverride?'operator-corrected landmark':'entered by the sender'}.<br>Exact position is unverified. No GPS supplied.</p>`;
}
function sourceEvidence(){
  return details('Source and receipt evidence',`<p>Category ${request.category} (${escape(categoryLabels[request.category].toLowerCase())}); severity ${request.severity} (${escape(severityLabels[request.severity].toLowerCase())}); ${request.people} people.</p><p>ECSW receipt: ${receiptConfirmed?'confirmed at 21:42:18':'not confirmed'}. Human review: ${reviewed?'explicitly recorded':'not recorded'}. Automatic agent processing does not create a human-review receipt.</p><p>This is a synthetic scenario. Current firmware tests and actual captured campus reports are separate evidence.</p>`);
}
function structuredSummary(){
  return details('Structured case summary',`<p>REG-042 · Revision ${caseRevision}<br>Need: drinking water for ${request.people} people.<br>Resource: ${requiredKits} water kits.<br>Category: supplies. Sender situation: assistance.<br>Place: ${escape(caseLocation())}. ${locationOverride?'Operator-corrected landmark':'Sender-entered landmark'}; no GPS, exact position unverified.</p><p>Original note remains unchanged. The local agent prepares this structured case and shares only policy-allowed fields automatically.</p>`);
}
function processingActivity(){
  return details('Processing activity',`<ol class="history-rows"><li><time>21:42:18</time>Saved the local report and issued the hub receipt.</li><li><time>21:42:19</time>Validated category, sender severity, people count and note.</li><li><time>21:42:20</time>Prepared structured case REG-042 from the original fields.</li>${regionalQueued?'<li><time>21:42:21</time>Automatically queued and shared policy-allowed fields with the supervisor.</li>':`<li><time>Pending</time>${automationPaused?'Automatic forwarding is paused; the case stays saved.':'Automatic forwarding is the next processing step.'}</li>`}${locationOverride?`<li><time>Revision ${caseRevision}</time>Preserved the original and applied a manual location correction to the hub case.</li>`:''}${accepted?`<li><time>21:44:03</time>Received ${offerTown()}’s simulated acceptance of 2 water kits.</li>`:''}</ol><p>Illustrative agent activity in this design concept. No model, external service or radio is called.</p>`);
}
function understandView(){
  return appTop()+`<div class="local-workspace">${campusMap()}<article class="case-panel"><div class="case-meta"><span>Example local request</span><span>DEMO-042</span></div><h1>Two people need drinking water</h1>${original()}<section class="next-action"><h2>Case prepared automatically</h2><p class="small muted">The local agent validated the source and transformed it into a structured coordination case. ${automationPaused?'Forwarding is paused; the case stays saved.':'Forwarding continues under the configured sharing policy.'}</p><div class="actions">${button('Correct location','correct-location')}</div></section>${structuredSummary()}${processingActivity()}${sourceEvidence()}</article></div>`;
}
function regionalView(){
  return appTop()+`<div class="local-workspace">${campusMap()}<article class="case-panel"><div class="case-meta"><span>Automatic coordination</span><span>REG-042</span></div><h1>${locationUpdatePending?'Location update queued locally':regionalQueued?'Shared with the supervisor':'Automatic forwarding paused'}</h1><blockquote class="original compact"><p>“${escape(request.note)}”</p><cite>Original example phone request · ${request.people} people · No GPS</cite></blockquote><div class="divider"></div><h2>Structured case</h2><dl class="pair-summary"><div><dt>Need</dt><dd>2 water kits for ${request.people} people</dd></div><div><dt>Place</dt><dd>${escape(caseLocation())}<small>${locationOverride?'Operator-corrected':'Sender-entered'} landmark · Exact position unverified</small></dd></div><div><dt>Status</dt><dd>${locationUpdatePending?'Latest correction queued locally':regionalQueued?'Queued and shared automatically':'Saved locally; waiting for automation to resume'}<small>${automationPaused?'New automated actions are paused.':'Policy-allowed fields only. No per-case approval required.'}</small></dd></div></dl><div class="actions">${button('Correct location','correct-location')}</div>${structuredSummary()}${processingActivity()}${details('Sharing scope','<p>Need, people count, original case reference, reported situation and location uncertainty are shared under the configured policy. Raw private notes and hub decryption keys stay local by default.</p>')}<p class="fine">Agent processing is separate from human review. The phone has a hub receipt; no operator-reviewed receipt is fabricated.</p></article></div>`;
}
function regionMap(){
  const to=offerTown();
  const target=alternate?{x:485,y:290}:{x:409,y:110};
  const coordinationLine=lastSharedCase&&offerRecorded?`<line x1="282" y1="228" x2="${target.x}" y2="${target.y}" stroke="#E20074" stroke-width="2" stroke-dasharray="5 5"/>`:'';
  return `<section class="map-view" aria-label="Schematic regional hub context"><div class="map-head"><p><strong>Regional context</strong></p><p>Selected handoff only</p></div><div class="map-canvas"><svg viewBox="0 0 650 450" role="img" aria-labelledby="region-title region-desc"><title id="region-title">Selected ECSW to ${to} simulated coordination</title><desc id="region-desc">Four hubs on a schematic. ECSW is a physical hub; this selected report is synthetic. Plano, Garland and Addison are simulated town hubs with no official agency affiliation. A line, when present, represents a recorded simulated HTTPS case event, not a radio path.</desc><path d="M0 145C150 110 260 185 650 90M85 450C130 320 65 145 210 0M345 450C390 300 335 180 440 0M0 340C190 380 345 295 650 330" fill="none" stroke="#f4f4f1" stroke-width="13"/><path d="M0 245C150 195 350 255 650 185M230 450C310 295 270 170 325 0" fill="none" stroke="#d0d3ce" stroke-width="3"/><path d="M650 420C550 340 570 220 650 185" fill="none" stroke="#e0e4e1" stroke-width="25"/>${coordinationLine}<circle cx="282" cy="228" r="7" fill="#E20074"/><text x="222" y="259" class="map-label strong">ECSW</text><text x="222" y="278" class="map-label small">Physical hub · example report</text><rect x="402" y="103" width="14" height="14" fill="${!alternate?'#E20074':'#abb2aa'}"/><text x="425" y="111" class="map-label strong">Plano · SIM</text><rect x="478" y="283" width="14" height="14" fill="${alternate?'#E20074':'#abb2aa'}"/><text x="502" y="294" class="map-label">Garland · SIM</text><rect x="150" y="301" width="14" height="14" fill="#abb2aa"/><text x="65" y="340" class="map-label">Addison · SIM</text><rect x="298" y="162" width="129" height="25" rx="3" fill="#f5f4f5"/><text x="308" y="179" class="map-label small">HTTPS coordination</text></svg></div><p class="map-caption">Schematic geography. One physical hub and three simulated town hubs; no official town or service affiliation. ${lastSharedCase&&offerRecorded?'The line is a recorded simulated case event, not a measured LoRa route.':'No coordination event is recorded for this offer yet.'}</p><details class="map-list"><summary>All hubs as a list</summary><ul><li>ECSW · Physical hub · example report</li><li>Plano · Simulated hub and resource stock</li><li>Garland · Simulated hub and resource stock</li><li>Addison · Simulated hub and resource stock</li></ul></details></section>`;
}
function eventHistory(remote=false){
  const events=[];
  if(processed&&(!remote||lastSharedCase))events.push('<li><time>21:42:20</time>ECSW automatically created REG-042 from the source fields.</li>');
  if(lastSharedCase)events.push(`<li><time>21:42:21</time>Policy-allowed case revision ${lastSharedCase.revision} shared with the supervisor.</li>`);
  if(lastSharedCase&&catalogConsulted)events.push('<li><time>21:44:01</time>Supervisor consulted the simulated resource catalog.</li>');
  if(lastSharedCase&&offerRecorded)events.push(`<li><time>21:44:02</time>${offerTown()} ${canAllocate()?'offered 2 simulated water kits':'has only 1 kit available; 2 are required'}.</li>`);
  if(lastSharedCase&&alternate)events.push('<li><time>Exception</time>An operator selected Garland’s alternate simulated offer.</li>');
  if(lastSharedCase&&offerRecorded&&accepted)events.push(`<li><time>21:44:03</time>Policy allocated 2 kits automatically; ${remainingStock()} of ${seededStock[offerTown()]} simulated kits remain.</li>`);
  if(lastSharedCase&&accepted&&dispatchAcknowledged)events.push('<li><time>21:44:05</time>Simulated service acknowledged dispatch. No services contacted.</li>');
  let pending='';
  if(remote&&!lastSharedCase)pending='No shared case has reached the supervisor.';
  else if(!processed)pending='Local validation and case preparation are pending.';
  else if(!lastSharedCase)pending='Automatic forwarding is pending; no case has reached the supervisor.';
  else if(!remote&&locationUpdatePending)pending=`The local correction is pending. The supervisor still has revision ${lastSharedCase.revision}.`;
  else if(!catalogConsulted)pending='Catalog consultation is pending.';
  else if(!offerRecorded)pending='A resource offer is pending.';
  else if(!accepted)pending='Allocation is pending; the stock exception remains unresolved.';
  else if(!dispatchAcknowledged)pending='The simulated dispatch acknowledgment is pending.';
  return details('Simulated event history',`${events.length?`<ol class="history-rows">${events.join('')}</ol>`:'<p>No completed coordination events yet.</p>'}${pending?`<p><strong>Pending</strong> · ${pending}${automationPaused?' Automation is paused.':''}</p>`:''}<p>Illustrative agent activity. No model, external API or service is called by this storyboard.</p>`);
}
function coordinateView(){
  const shared=lastSharedCase;
  if(!shared)return appTop(true)+`<div class="regional-workspace">${regionMap()}<article class="case-panel"><div class="case-meta"><span>Supervisor</span><span>No shared case</span></div><h1>Waiting for the local hub</h1><p class="original">No case has reached the supervisor. Local fields and corrections stay at ECSW until automatic sharing can resume.</p>${eventHistory(true)}<p class="fine">No catalog lookup, offer or allocation has completed.</p></article></div>`;
  const exception=offerRecorded&&!canAllocate();
  return appTop(true)+`<div class="regional-workspace">${regionMap()}<article class="case-panel"><div class="case-meta"><span>${shared.id} · Revision ${shared.revision}</span><span>Selected request and offer</span></div><h1>${exception?'The water request needs attention':accepted?`${offerTown()} accepted the water request`:'Allocation is paused'}</h1><dl class="pair-summary"><div><dt>Request</dt><dd>${shared.quantity} water kits for ${shared.people} people<small>ECSW · physical hub · example report</small></dd></div><div><dt>Place</dt><dd>${escape(shared.location)}<small>${shared.provenance} landmark · Exact position unverified</small></dd></div><div><dt>Offer</dt><dd>${!offerRecorded?'Not yet requested':exception?'Only 1 kit available; 2 needed':accepted?'2 water kits reserved':'2 water kits available'}<small>${catalogConsulted?`${offerTown()} · Simulated stock · ${remainingStock()} of ${seededStock[offerTown()]} kits remaining`:'Catalog consultation is pending.'}</small></dd></div></dl>${exception?`<section class="exception-text"><h2>${pendingException?'Request kept pending':'Insufficient stock'}</h2><p>Two kits are required; Plano has only one. The case stays saved. An operator can select an alternate simulated offer or keep this exception pending.</p></section><div class="actions">${button('Use Garland’s simulated offer','alternate','primary')}${button('Keep pending','pending')}</div>`:`<p class="policy-line">${automationPaused?'Automation is paused. Any accepted reservation stays recorded.':accepted?'2 kits allocated automatically under the demo policy. No per-case approval is required.':'Waiting for the resource catalog.'}</p>`}${details('Allocation policy',`<p>The shared need is drinking water for ${shared.people} people. Eligible simulated stock is automatically reserved when at least ${shared.quantity} kits are available.${catalogConsulted?` ${offerTown()} has ${availableStock()} simulated kits before this allocation; ${remainingStock()} remain.`:''}</p><p>Missing fields, insufficient stock or an unavailable hub create an exception. No real town authority or responder is represented.</p>`)}${eventHistory(true)}<p class="fine">Only shared revision ${shared.revision} is visible here. All town resources and service dispatch are simulated.</p></article></div>`;
}
function confirmView(){
  if(phoneConfirmation)return waitView(true);
  const waiting=!accepted;
  return appTop()+`<div class="local-workspace">${campusMap()}<article class="case-panel"><div class="case-meta"><span>Automatic update at ECSW</span><span>REG-042</span></div><h1>${waiting?'The regional case stays pending':`${offerTown()} accepted the request`}</h1><p class="original">${waiting?'No simulated resource has been allocated. The local source and regional case remain saved.':`2 water kits are reserved for ${request.people} people. The supervisor update returned to ECSW automatically.`}</p><dl class="pair-summary"><div><dt>Source</dt><dd>DEMO-042<small>Original local example report</small></dd></div><div><dt>Regional</dt><dd>REG-042<small>${waiting?'Pending allocation':`${offerTown()} · 2 simulated water kits accepted`}</small></dd></div><div><dt>Dispatch</dt><dd>${dispatchAcknowledged?'Simulated acknowledgment':'Not yet acknowledged'}<small>No emergency services contacted</small></dd></div></dl>${structuredSummary()}${details('What the phone can confirm',`<p>${reviewed?'A human review was explicitly recorded.':'The phone has an ECSW hub-received receipt only. Automatic agent processing does not generate an operator-reviewed receipt.'} Neither confirms regional dispatch, a responder or an arrival time.</p>`)}${processingActivity()}${eventHistory()}<div class="actions">${button('View phone evidence','phone-confirmation')}${button('Correct location','correct-location')}</div><p class="fine">Processing, accepted resources, simulated service events and phone delivery receipts remain distinct. No “help is on the way” message is sent.</p></article></div>`;
}
function render(){
  const beat=beats[current];
  $('beats').innerHTML=beats.map((item,index)=>`<button type="button" data-beat="${index}" ${current===index?'aria-current="step"':''}><b>${index+1}</b>${item.label}</button>`).join('');
  $('beat-description').textContent=beat.description;
  $('responsibility').textContent=phoneConfirmation&&current===5?'Phone · Limited receipt evidence':beat.owner;
  $('workspace').className=current<=1||(current===5&&phoneConfirmation)?'phone':'';
  $('workspace').innerHTML=current===0?askView():current===1?waitView():current===2?understandView():current===3?regionalView():current===4?coordinateView():confirmView();
  $('previous').disabled=current===0;
  $('next').disabled=current===5;
  $('story-progress').textContent=`${current+1} of 6 · ${beat.label}`;
  $('reference').href=current<=1?'../rescuemesh-phone.png':current===4?'../rescuemesh-supervisor.png':'../rescuemesh-ecsw.png';
  $('exception').textContent=shortage?'Return to available stock':'Show a resource shortage';
  $('announcement').textContent=`${beat.label}. ${beat.owner}. ${beat.description}`;
}
function go(index,focus=true){
  if(index<0||index>=beats.length)return;
  current=index;phoneConfirmation=false;syncStoryState(index);
  history.replaceState(null,'','#'+beats[index].id);
  render();if(focus)$('workspace').focus({preventScroll:true});
}
function openDisclosure(title){
  let matched=[...$('workspace').querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent===title);
  if(!matched&&title==='Source and receipt evidence'){
    const panel=$('workspace').querySelector('.case-panel');
    if(panel){panel.insertAdjacentHTML('beforeend',sourceEvidence());matched=[...panel.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent===title);}
  }
  if(matched){matched.open=!matched.open;matched.querySelector('summary').focus();}
}
$('beats').addEventListener('click',event=>{const target=event.target.closest('[data-beat]');if(target)go(Number(target.dataset.beat));});
$('previous').addEventListener('click',()=>go(current-1));
$('next').addEventListener('click',()=>go(current+1));
$('exception').addEventListener('click',()=>{shortage=!shortage;alternate=false;accepted=false;catalogConsulted=false;offerRecorded=false;dispatchAcknowledged=false;pendingException=false;go(4);});
document.addEventListener('keydown',event=>{if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();go(current+(event.key==='ArrowRight'?1:-1));}});
window.addEventListener('hashchange',()=>{const index=beats.findIndex(beat=>beat.id===location.hash.slice(1));if(index>=0)go(index,false);});
$('workspace').addEventListener('submit',event=>{
  event.preventDefault();
  if(event.target.id==='request-form'){
    if(!draft.note.trim()){$('form-error').textContent='Describe what is needed and a nearby landmark, if known.';return;}
    if(byteLength(draft.note)>120){$('form-error').textContent='Shorten the message to 120 bytes before sending.';return;}
    request={...draft};saved=true;receiptConfirmed=false;reviewed=false;regionalQueued=false;processed=false;automationPaused=false;locationOverride='';caseRevision=1;locationUpdatePending=false;lastSharedCase=null;catalogConsulted=false;offerRecorded=false;accepted=false;dispatchAcknowledged=false;shortage=false;alternate=false;pendingException=false;go(1);
  }
});
$('location-form').addEventListener('submit',event=>{
  event.preventDefault();
  const corrected=$('corrected-location').value.trim();
  if(!corrected){$('location-error').textContent='Enter a landmark, or close to keep the existing location.';return;}
  if(corrected!==caseLocation()){locationOverride=corrected;caseRevision+=1;locationUpdatePending=true;}
  syncStoryState(current);
  $('location-dialog').close();
  render();
});
$('location-dialog').addEventListener('click',event=>{if(event.target.closest('[data-close-location]'))$('location-dialog').close();});
$('workspace').addEventListener('click',event=>{
  const target=event.target.closest('button[data-action]');if(!target)return;
  const action=target.dataset.action;
  if(action==='setup')$('setup-dialog').showModal();
  if(action==='phone-ask')go(0);
  if(action==='phone-request')go(1);
  if(action==='retry'){$('retry-status').textContent='Same request DEMO-042 and saved payload submitted again. Receipt is still unconfirmed.';}
  if(action==='toggle-automation'){automationPaused=!automationPaused;syncStoryState(current);render();}
  if(action==='correct-location'){$('corrected-location').value=caseLocation();$('location-error').textContent='';$('location-dialog').showModal();$('corrected-location').focus();}
  if(action==='inspect-summary')openDisclosure('Structured case summary');
  if(action==='source-details')openDisclosure('Source and receipt evidence');
  if(action==='phone-receipt'){
    if(current===5){phoneConfirmation=true;render();}
    else openDisclosure('Source and receipt evidence');
  }
  if(action==='coordinate')go(4);
  if(action==='history')openDisclosure('Simulated event history');
  if(action==='policy')openDisclosure('Allocation policy');
  if(action==='alternate'){alternate=true;accepted=false;catalogConsulted=false;offerRecorded=false;pendingException=false;syncStoryState(current);render();}
  if(action==='pending'){pendingException=true;render();}
  if(action==='phone-confirmation'){phoneConfirmation=true;render();}
  if(action==='back-confirm'){phoneConfirmation=false;render();}
});
syncStoryState(current);
render();
