import { expect, it } from 'vitest';
import { hasDemoFinancialJournal } from './demo-departure';
it('does not bypass a saved POS request from the Demo workspace or an admin shell', () => {
 expect(hasDemoFinancialJournal({getItem:()=>null})).toBe(false);
 for (const key of ['pikas:connected-pos:pending:v1','pikas:connected-pos:register:v1']) expect(hasDemoFinancialJournal({getItem:k=>k===key?'retained evidence':null})).toBe(true);
 expect(hasDemoFinancialJournal({getItem:()=>{throw Error('storage unavailable');}})).toBe(true);
});
