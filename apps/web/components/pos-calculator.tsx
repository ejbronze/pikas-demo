"use client";

import {useEffect,useReducer,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react';
import {Calculator as CalculatorIcon,Delete,GripHorizontal,X} from 'lucide-react';
import {calculatorInput,initialCalculator} from '@/lib/pos-calculator';

const keys=[['C','Limpiar'],['Backspace','Borrar último dígito'],['/','Dividir'],['*','Multiplicar'],['7','7'],['8','8'],['9','9'],['-','Restar'],['4','4'],['5','5'],['6','6'],['+','Sumar'],['1','1'],['2','2'],['3','3'],['=','Igual'],['0','0'],['.','Decimal']] as const;
const symbols:Record<string,string>={'/':'÷','*':'×','-':'−'};

// A session-local utility: no access to cart, payment fields, storage or mutations.
export function PosCalculator(){
  const [state,input]=useReducer(calculatorInput,initialCalculator);
  const [position,setPosition]=useState({x:8,y:8});
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),display=useRef<HTMLOutputElement>(null);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null);
  const constrain=(x:number,y:number)=>{
    const box=dialog.current!.getBoundingClientRect();
    return {x:Math.max(8,Math.min(x,window.innerWidth-box.width-8)),y:Math.max(8,Math.min(y,window.innerHeight-box.height-8))};
  };
  const open=()=>{
    dialog.current!.showModal();
    const box=dialog.current!.getBoundingClientRect();
    setPosition(constrain(window.innerWidth<640?(window.innerWidth-box.width)/2:window.innerWidth-box.width-24,window.innerWidth<640?(window.innerHeight-box.height)/2:96));
    display.current?.focus();
  };
  const close=()=>{drag.current=null;dialog.current?.close();trigger.current?.focus({preventScroll:true})};
  useEffect(()=>{
    const resize=()=>{if(dialog.current?.open)setPosition(p=>{
      const box=dialog.current!.getBoundingClientRect();
      return {x:Math.max(8,Math.min(p.x,window.innerWidth-box.width-8)),y:Math.max(8,Math.min(p.y,window.innerHeight-box.height-8))};
    })};
    window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[]);
  const keyboard=(event:KeyboardEvent<HTMLDialogElement>)=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return}
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const key=event.key==='Enter'?'=':event.key==='Delete'?'C':event.key;
    // Enter on a focused button activates that button, as expected for keyboard navigation.
    if(event.key==='Enter'&&event.target instanceof HTMLButtonElement)return;
    if(/^[0-9.+*/=\-]$/.test(key)||key==='Backspace'||key==='C'){
      event.preventDefault();event.stopPropagation();input(key);display.current?.focus({preventScroll:true});
    }
  };
  const startDrag=(event:PointerEvent<HTMLButtonElement>)=>{
    if(event.button!==0||window.innerWidth<640)return;
    const box=dialog.current!.getBoundingClientRect();
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return <>
    <button ref={trigger} className="pos-calculator-launcher" aria-label="Calculadora" title="Calculadora" aria-haspopup="dialog" onClick={open}><CalculatorIcon size={22} aria-hidden="true"/></button>
    <dialog ref={dialog} className="pos-calculator" aria-labelledby="pos-calculator-title" style={{left:position.x,top:position.y}} onKeyDown={keyboard} onCancel={event=>{event.preventDefault();close()}}>
      <div className="pos-calculator-titlebar">
        <button className="pos-calculator-drag" aria-label="Mover calculadora" onPointerDown={startDrag} onPointerMove={event=>{const start=drag.current;if(start&&start.id===event.pointerId)setPosition(constrain(start.left+event.clientX-start.x,start.top+event.clientY-start.y))}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onLostPointerCapture={()=>{drag.current=null}} onKeyDown={event=>{
          const moves:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};
          if(moves[event.key]){event.preventDefault();const [x,y]=moves[event.key];setPosition(p=>constrain(p.x+x,p.y+y))}
        }}><CalculatorIcon size={18} aria-hidden="true"/><span id="pos-calculator-title">Calculadora</span><GripHorizontal size={18} aria-hidden="true" className="ml-auto"/></button>
        <button className="pos-calculator-close" aria-label="Cerrar calculadora" onClick={close}><X size={20} aria-hidden="true"/></button>
      </div>
      <div className="pos-calculator-body">
        <div className="pos-calculator-screen">
          <span className="pos-calculator-expression" aria-hidden="true">{state.operator?`${state.accumulator} ${symbols[state.operator]??state.operator}`:'\u00a0'}</span>
          <output ref={display} tabIndex={0} aria-label="Resultado de calculadora" aria-live="polite">{state.display==='Error'?'No definido':state.display}</output>
        </div>
        <div className="pos-calculator-keys">{keys.map(([key,label])=><button key={key} aria-label={label} className={`pos-calculator-key ${key==='='?'pos-calculator-equals':key==='0'?'pos-calculator-zero':!/[0-9.]/.test(key)?'pos-calculator-operation':''}`} onClick={()=>{input(key);display.current?.focus({preventScroll:true})}}>{key==='Backspace'?<Delete size={22} aria-hidden="true"/>:symbols[key]??key}</button>)}</div>
      </div>
    </dialog>
  </>;
}
