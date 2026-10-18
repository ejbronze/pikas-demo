import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { moneyText, moneyTone } from './money-semantics';
import { MoneyValue } from '../components/money-value';
(globalThis as {React?:typeof React}).React=React;

describe('shared financial-value semantics',()=>{
 it.each([
  ['2500','movement','+RD$ 25.00','positive'],
  ['-2500','movement','−RD$ 25.00','negative'],
  ['2500','balance','RD$ 25.00','neutral'],
  ['-2500','balance','−RD$ 25.00','negative'],
  ['0','balance','RD$ 0.00','neutral'],
  ['0','movement','RD$ 0.00','neutral'],
  ['2500','amount','RD$ 25.00','neutral'],
 ] as const)('%s as %s → %s (%s)',(minor,intent,text,tone)=>{
  expect(moneyText(minor,intent)).toBe(text);expect(moneyTone(minor,intent)).toBe(tone);
 });
 it('a positive current balance is neutral; meaning never depends on color alone',()=>{
  const balance=renderToStaticMarkup(<MoneyValue minor="2500" intent="balance"/>);
  expect(balance).toContain('data-money-tone="neutral"');expect(balance).not.toContain('text-emerald');expect(balance).not.toContain('class=');
  const credit=renderToStaticMarkup(<MoneyValue minor="2500" intent="movement"/>);
  expect(credit).toContain('text-emerald-700');expect(credit).toContain('+RD$ 25.00');
  const debit=renderToStaticMarkup(<MoneyValue minor="-2500" intent="movement" className="font-bold"/>);
  expect(debit).toContain('class="text-red-700 font-bold"');expect(debit).toContain('−RD$ 25.00');
  expect(renderToStaticMarkup(<MoneyValue minor="-2500" intent="balance"/>)).toContain('−RD$ 25.00');
 });
 it('preserves integer minor units beyond Number precision',()=>{
  expect(moneyText('-900719925474099312','balance')).toBe(`−RD$ ${(9007199254740993n).toLocaleString('es-DO')}.12`);
 });
});
