import { createHash } from 'node:crypto';
import { TOWN_IDS, RESOURCES } from './schema.mjs';
export class SimulatedDispatchAdapter {
  async send(allocation, item) {
    if(!allocation?.simulation||!TOWN_IDS.includes(allocation.townId)||!RESOURCES.includes(allocation.resource)||!item?.caseId)throw new Error('Simulation-only dispatch policy rejected');
    return { dispatchId:allocation.dispatchId,acknowledgment:'sim-'+createHash('sha256').update(allocation.dispatchId).digest('hex').slice(0,16),status:'simulated-dispatched',service:allocation.service,townId:allocation.townId,resource:allocation.resource,quantity:allocation.quantity,simulation:true,acceptedAt:Date.now(),realServicesContacted:false };
  }
}
