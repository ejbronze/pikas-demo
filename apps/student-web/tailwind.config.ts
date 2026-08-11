import type { Config } from "tailwindcss";
export default { content:["./app/**/*.{ts,tsx}","../../packages/ui/src/**/*.{ts,tsx}"],theme:{extend:{colors:{pikas:"#5b3df5",ink:"#1a2340"},boxShadow:{card:"0 12px 35px rgba(26,35,64,.09)"}}},plugins:[]} satisfies Config;
