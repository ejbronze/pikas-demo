"use client";
import Image from "next/image";
import {useState} from "react";

export function ProductImage({src,name}:{src?:string|null;name:string}){
  const [failed,setFailed]=useState(false);
  if(!src||failed)return <div role="img" aria-label={`Imagen no disponible para ${name}`} className="grid h-28 w-full place-items-center bg-gradient-to-br from-amber-100 to-orange-100 text-2xl font-black text-slate-700">{name.split(" ").map(word=>word[0]).join("").slice(0,2)}</div>;
  return <div className="relative h-28 w-full overflow-hidden bg-amber-50"><Image src={src} alt={`Producto ficticio: ${name}`} fill loading="eager" sizes="(max-width: 768px) 100vw, 320px" className="object-cover" onError={()=>setFailed(true)}/></div>;
}
