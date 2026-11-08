import { regionalMetrics, allocationsFor, needsFor, supplySelections, RESOURCE_LABELS, CATEGORY_LABELS, resourceUnit, timestamp } from './ops-metrics.js';
// Geography: UTD ECSW JSON-LD https://calendar.utdallas.edu/ecsw;
// city representative points: Census 2025 Texas Places Gazetteer (INTPTLAT/LONG).
export const HUB_LOCATIONS = Object.freeze({
  ecsw:{name:'ECSW',latitude:32.986102,longitude:-96.751378},
  plano:{name:'Plano',latitude:33.050769,longitude:-96.747944},
  garland:{name:'Garland',latitude:32.909826,longitude:-96.630334},
  addison:{name:'Addison',latitude:32.963744,longitude:-96.833805},
});
export const MAP_VIEW={width:800,height:500,padding:97};
export function projectHubs(locations=HUB_LOCATIONS,view=MAP_VIEW){
  const entries=Object.entries(locations),meanLat=entries.reduce((n,[,p])=>n+p.latitude,0)/entries.length;
  const cos=Math.cos(meanLat*Math.PI/180),kmPerDegree=111.195;
  const raw=entries.map(([id,p])=>({id,x:p.longitude*cos*kmPerDegree,y:-p.latitude*kmPerDegree}));
  const minX=Math.min(...raw.map(p=>p.x)),maxX=Math.max(...raw.map(p=>p.x)),minY=Math.min(...raw.map(p=>p.y)),maxY=Math.max(...raw.map(p=>p.y));
  const pixelsPerKm=Math.min((view.width-2*view.padding)/(maxX-minX||1),(view.height-2*view.padding)/(maxY-minY||1));
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  return {points:Object.fromEntries(raw.map(p=>[p.id,{x:view.width/2+(p.x-centerX)*pixelsPerKm,y:view.height/2+(p.y-centerY)*pixelsPerKm}])),pixelsPerKm};
}
export function selectedFlows(item){
  if(!item||item.archived||!HUB_LOCATIONS[item.hubId])return [];
  return allocationsFor(item).filter(a=>HUB_LOCATIONS[a.townId]&&a.townId!==item.hubId).map(a=>({source:a.townId,target:item.hubId,phase:a.acknowledgment||Number.isFinite(a.acknowledgedAt)?'recorded':'pending',quantity:a.quantity,resource:a.resource}));
}
export function selectedFlow(item,resource){const flows=selectedFlows(item);return flows.find(flow=>flow.resource===resource)||flows[0]||null;}
export function connectionGeometry(from,to,clearance=15){
  if(!from||!to)return null;const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);if(!Number.isFinite(distance)||distance<=2*clearance)return null;
  const ux=dx/distance,uy=dy/distance;return {start:{x:from.x+ux*clearance,y:from.y+uy*clearance},end:{x:to.x-ux*clearance,y:to.y-uy*clearance}};
}
export function zoomCamera(camera,factor,anchor={x:400,y:250}){const scale=Math.max(.8,Math.min(2.6,camera.scale*factor)),ratio=scale/camera.scale;return {scale,x:anchor.x-(anchor.x-camera.x)*ratio,y:anchor.y-(anchor.y-camera.y)*ratio};}

// Node imports the geography helpers without running the browser interface.
if (typeof document !== 'undefined') {
  const { startInterface } = await import('./interface.js');
  await startInterface({ HUB_LOCATIONS, selectedFlow, selectedFlows });
}