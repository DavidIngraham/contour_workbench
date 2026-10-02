import type {Settings} from './types';

const lineClasses=new Set(['trail','road','stream','ski_lift']);

export interface FitProfile {
 depthMm:number;
 extrusionWidthMm:number;
 minimumTopWidthMm:number;
 footReliefMm:number;
 footHeightMm:number;
 draftBottomInsetMm:number;
 draftHeightMm:number;
 draftAngleDeg:number;
 maximumInsetMm:number;
}
export function extrusionWidthMm(nozzleDiameterMm:number){return nozzleDiameterMm*1.125;}
export function recommendedInsertWidthMm(nozzleDiameterMm:number){return extrusionWidthMm(nozzleDiameterMm)*2;}
export function minimumTerrainIslandWidthMm(settings:Pick<Settings,'nozzle_diameter_mm'|'minimum_terrain_island_width_mm'>){return settings.minimum_terrain_island_width_mm??extrusionWidthMm(settings.nozzle_diameter_mm)*3;}
export function fitProfile(settings:Settings,className:string,depthMm:number,reliefOverride?:number):FitProfile{
 const depth=Math.max(.05,depthMm),extrusion=extrusionWidthMm(settings.nozzle_diameter_mm);
 const lineMaximum=lineClasses.has(className)?Math.max(0,(settings.path_width_mm-extrusion)/2):Infinity;
 const footRelief=Math.min(Math.max(0,reliefOverride??settings.insert_elephant_foot_relief_mm),lineMaximum);
 const seatingBand=Math.min(Math.max(.25,settings.nozzle_diameter_mm*.75),depth*.4);
 const draftHeight=Math.max(0,depth-seatingBand);
 const requestedDraft=Math.tan(settings.insert_draft_angle_deg*Math.PI/180)*draftHeight;
 const draftBottomInset=Math.min(requestedDraft,Math.max(0,lineMaximum-footRelief));
 return {depthMm:depth,extrusionWidthMm:extrusion,minimumTopWidthMm:extrusion*2,footReliefMm:footRelief,footHeightMm:Math.min(settings.insert_elephant_foot_height_mm,Math.max(.05,depth-seatingBand)),draftBottomInsetMm:draftBottomInset,draftHeightMm:draftHeight,draftAngleDeg:settings.insert_draft_angle_deg,maximumInsetMm:footRelief+draftBottomInset};
}
export function insetAtHeight(profile:FitProfile,heightMm:number){
 const foot=profile.footHeightMm>0?profile.footReliefMm*Math.max(0,1-heightMm/profile.footHeightMm):0;
 const draft=profile.draftHeightMm>0?profile.draftBottomInsetMm*Math.max(0,1-heightMm/profile.draftHeightMm):0;
 return Math.min(profile.maximumInsetMm,foot+draft);
}
export function calibrationClearances(settings:Settings){return [-.05,0,.05,.1].map(offset=>Math.max(.05,Math.round((settings.insert_fit_clearance_per_side_mm+offset)*100)/100));}
