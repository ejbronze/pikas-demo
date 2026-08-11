import type { Metadata } from "next"; import "./globals.css";
export const metadata: Metadata = { title:"Pikas Familias", description:"Portal familiar de demostración Pikas" };
export default function Layout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}
