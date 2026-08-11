import type { Config } from "tailwindcss";
export default {content:["./app/**/*.{ts,tsx}","./components/**/*.{ts,tsx}","../../packages/ui/src/**/*.{ts,tsx}"],theme:{extend:{colors:{ink:"#14213d",pikas:{50:"#eef5ff",500:"#2563eb",700:"#1745a5",900:"#102b68"}},boxShadow:{card:"0 14px 40px rgba(20,33,61,.08)"}}},plugins:[]} satisfies Config;
