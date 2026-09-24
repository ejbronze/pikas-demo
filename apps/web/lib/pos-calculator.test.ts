import {describe,it,expect} from 'vitest';
import {calculatorInput,initialCalculator} from './pos-calculator';
const enter=(keys:string[])=>keys.reduce(calculatorInput,initialCalculator);
describe('independent POS calculator',()=>{
  it.each([['25+50=','75'],['9-12=','-3'],['7*8=','56'],['9/4=','2.25'],['0.1+0.2=','0.3'],['2+3*4=','20'],['8/0=','Error'],['1..5+2=','3.5']])('%s gives %s',(keys,result)=>expect(enter([...keys]).display).toBe(result));
  it('deletes digits, clears pending arithmetic and recovers from errors',()=>{
    expect(enter(['1','2','3','Backspace']).display).toBe('12');
    expect(enter(['9','+','C'])).toEqual(initialCalculator);
    expect(enter(['8','/','0','=','2']).display).toBe('2');
    expect(enter(['1','+','2','=','4']).display).toBe('4');
  });
});
