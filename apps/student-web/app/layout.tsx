import type { Metadata } from "next"; import "./globals.css";
export const metadata: Metadata = { title:"Pikas Student", description:"Portal estudiantil de demostración Pikas" };
export default function Layout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}
