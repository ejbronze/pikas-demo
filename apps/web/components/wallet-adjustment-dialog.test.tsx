import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
(globalThis as {React?:typeof React}).React=React;
import { WalletAdjustmentDialog, signed, signedTone } from './wallet-adjustment-dialog';
const id='5c300000-0000-4000-8000-000000000001';
describe('administrative adjustment dialog',()=>{
 it('starts by distinguishing refund, reversal and exceptional adjustment',()=>{
  const html=renderToStaticMarkup(<WalletAdjustmentDialog scope={{kind:'school',schoolId:id}} studentId={id} studentName="Sol" actorId={id} balanceMinor="-500" onClose={()=>{}} onDone={()=>{}}/>);
  expect(html).toContain('¿Qué necesitas corregir?');expect(html).toContain('Una compra');expect(html).toContain('Una recarga incorrecta');expect(html).toContain('Otra corrección excepcional de saldo');
  expect(html).toContain('text-red-700');
 });
 it('uses explicit signs with semantic tones',()=>{
  expect(signed('2500')).toBe('+RD$ 25.00');expect(signed('-2500')).toBe('−RD$ 25.00');expect(signedTone('2500')).toBe('text-emerald-700');expect(signedTone('-1')).toBe('text-red-700');
 });
});
