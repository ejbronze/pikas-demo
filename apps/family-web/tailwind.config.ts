import type { Config } from "tailwindcss";
export default { content:["./app/**/*.{ts,tsx}","../../packages/ui/src/**/*.{ts,tsx}"],theme:{extend:{colors:{pikas:"#2457e6",ink:"#14213d"},boxShadow:{card:"0 12px 35px rgba(20,33,61,.08)"}}},plugins:[]} satisfies Config;
