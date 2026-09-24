// Simple sequential desktop-calculator arithmetic, independent of financial math.
type Operator='+'|'-'|'*'|'/';
type CalculatorState={display:string;accumulator:number|null;operator:Operator|null;replace:boolean};
export const initialCalculator:CalculatorState={display:'0',accumulator:null,operator:null,replace:false};
function calculate(left:number,right:number,operator:Operator){
  const result=operator==='+'?left+right:operator==='-'?left-right:operator==='*'?left*right:right===0?NaN:left/right;
  return Number.isFinite(result)?String(Number(result.toPrecision(12))):'Error';
}
export function calculatorInput(state:CalculatorState,key:string):CalculatorState{
  if(key==='C')return initialCalculator;
  if(/^[0-9.]$/.test(key)){
    const base=state.replace||state.display==='Error'?'0':state.display;
    if(key==='.'&&base.includes('.')||base.replace(/[^0-9]/g,'').length>=15)return state;
    return {...(state.display==='Error'?initialCalculator:state),display:key==='.'?base+'.':base==='0'?key:base+key,replace:false};
  }
  if(key==='Backspace')return state.replace?state:{...state,display:state.display==='Error'||state.display.length<=1?'0':state.display.slice(0,-1)};
  if(state.display==='Error')return state;
  if(key==='='){
    if(state.operator===null||state.accumulator===null||state.replace)return state;
    return {display:calculate(state.accumulator,Number(state.display),state.operator),accumulator:null,operator:null,replace:true};
  }
  if(['+','-','*','/'].includes(key)){
    const display=state.operator&&state.accumulator!==null&&!state.replace?calculate(state.accumulator,Number(state.display),state.operator):state.display;
    return display==='Error'?{...initialCalculator,display,replace:true}:{display,accumulator:Number(display),operator:key as Operator,replace:true};
  }
  return state;
}
