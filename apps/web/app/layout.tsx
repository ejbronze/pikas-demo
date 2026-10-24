import type { Metadata } from "next";
import "./globals.css";
import { Inter, Nunito } from "next/font/google";
import { RouteDemoProvider } from "@/components/route-demo-provider";
import { SessionSecurityBoundary } from "@/components/auth/session-security-boundary";
import { isDemoMode } from "@/lib/env";
// Experience foundation: Inter for the interface, Nunito (rounded, like the wordmark) for display.
const inter=Inter({subsets:["latin"],variable:"--font-inter",display:"swap"});
const nunito=Nunito({subsets:["latin"],weight:["800","900"],variable:"--font-display",display:"swap"});
// Brand & Public: canonical domain and the approved positioning as the default description.
export const metadata:Metadata={metadataBase:new URL("https://pikas-pikas.app"),title:{default:"PIKAS | La cafetería escolar, por fin conectada",template:"%s | PIKAS"},description:"PIKAS conecta las personas, la operación y el dinero detrás de la cafetería escolar.",applicationName:"PIKAS",icons:{icon:"/brand/favicon-32x32.png",apple:"/brand/apple-touch-icon.png"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="es" data-scroll-behavior="smooth" className={`${inter.variable} ${nunito.variable}`}><body><RouteDemoProvider><SessionSecurityBoundary enabled={!isDemoMode()}>{children}</SessionSecurityBoundary></RouteDemoProvider></body></html>}
