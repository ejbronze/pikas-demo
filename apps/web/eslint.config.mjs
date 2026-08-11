import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
const config=[{ignores:[".next/**","next-env.d.ts"]},...nextVitals,...nextTypeScript,{rules:{"react-hooks/set-state-in-effect":"off","@typescript-eslint/no-explicit-any":"off","@next/next/no-html-link-for-pages":"off"}}];
export default config;
