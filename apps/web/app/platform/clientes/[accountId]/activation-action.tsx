"use client";
import { useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { sessionFetch } from "../../../../lib/auth/session-fetch";
import type { CustomerActivationStatus } from "../../../../lib/platform/customer-activation";
import { ConfirmAction } from "../../../../components/confirm-action";
export function CustomerActivationAction({intentId,status}:{intentId:string;status:CustomerActivationStatus|null}){
 const router=useRouter(),inFlight=useRef(false);
 const [busy,setBusy]=useState(false),[link,setLink]=useState(""),[message,setMessage]=useState("");
 const [copyFeedback,setCopyFeedback]=useState<{link:string;message:string}|null>(null);
 const ready=status?.identity_state==="ready",unavailable=!status||status.identity_state==="unavailable";
 const replacement=!!link||status?.link_state==="active";
 async function issue(){
  if(inFlight.current)return;
  // Replacement is confirmed in the app (ConfirmAction) before this runs.
  inFlight.current=true;setBusy(true);setLink("");setMessage("");setCopyFeedback(null);
  try{
   const response=await sessionFetch("/api/platform/customer-admins/activation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({intentId})});
   const result=await response.json();
   if(!response.ok){setMessage(result.error==="identity_unavailable"?"No se puede activar esta identidad con este acceso preparado. Si ya tiene una cuenta confirmada, usa su acceso existente y verifica su estado; no se modificó su contraseña.":"No se pudo confirmar el enlace. Recupera el acceso y recarga el estado antes de reemplazarlo para la misma solicitud.");router.refresh();return;}
   if(result.status==="identity_ready"){setMessage("Identidad lista. Completa el acceso del mismo administrador preparado; no se creó un enlace ni se cambió su contraseña.");router.refresh();return;}
   if(result.delivery!=="link_only"||typeof result.link!=="string")throw Error("invalid");
   const url=new URL(result.link);
   if(url.origin!==window.location.origin||url.pathname!=="/activar"||!/^#token=[0-9a-f]{64}$/.test(url.hash))throw Error("invalid");
   setLink(result.link);setMessage("Enlace creado. No se envió correo. Entrégalo solo a la persona destinataria por un canal privado confiable. Vence en una hora o al vencer la solicitud, lo que ocurra primero. Reemplazarlo invalida el anterior. Cuando termine de guardar su contraseña, recarga esta pantalla y completa el mismo acceso preparado.");router.refresh();
  }catch{setMessage("No se pudo confirmar la creación del enlace. Recarga el estado; puedes reemplazar el enlace para el mismo acceso preparado, sin crear otra solicitud de administrador.");router.refresh();}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <div className="mt-3 min-w-0 space-y-3">
 <p className="text-sm">{ready?"Identidad lista para completar acceso. La activación por sí sola no concede permisos.":unavailable?"No se pudo establecer una identidad elegible. La solicitud vencida, una identidad ajena o una activación de otra solicitud no se reasocian automáticamente.":status?.identity_state==="missing"?"La persona necesita activar su identidad y crear su contraseña antes de completar acceso.":"Activación pendiente: la persona debe guardar su contraseña antes de completar acceso."}</p>
 {!ready&&!unavailable&&<><p className="text-sm">{status?.link_state==="active"?"Existe un enlace activo. Su contenido no se guarda y no puede recuperarse desde esta pantalla.":status?.link_state==="expired"?"El enlace anterior venció. Puedes generar otro para esta misma solicitud vigente.":"Genera un enlace privado para esta solicitud de administrador."}</p><ConfirmAction className={replacement?"btn-destructive":"btn"} disabled={busy} ask={replacement} question="¿Reemplazar el enlace de activación? El enlace anterior dejará de funcionar." label={busy?"Preparando…":replacement?"Reemplazar enlace de activación":"Generar enlace de activación"} onConfirm={()=>void issue()}/></>}
 <button className="btn-secondary" type="button" disabled={busy} onClick={()=>router.refresh()}>Actualizar estado de activación</button>
 {message&&<p role="status" className="break-words text-sm">{message}</p>}
 {link&&!ready&&!unavailable&&<div className="min-w-0 space-y-3"><label className="block">Enlace privado de activación<input className="field mt-1 w-full" readOnly value={link} onFocus={e=>e.currentTarget.select()}/></label><button className="btn-secondary" type="button" onClick={async()=>{const current=link;try{await navigator.clipboard.writeText(current);setCopyFeedback({link:current,message:"Enlace copiado"});}catch{setCopyFeedback({link:current,message:"No se pudo copiar. Selecciona el enlace y cópialo manualmente."});}}}>Copiar enlace</button>{copyFeedback?.link===link&&<p role="status">{copyFeedback.message}</p>}</div>}
 </div>;
}
