import type { Metadata } from "next";
import "./globals.css";
import { RouteDemoProvider } from "@/components/route-demo-provider";
import { SessionSecurityBoundary } from "@/components/auth/session-security-boundary";
import { isDemoMode } from "@/lib/env";
export const metadata:Metadata={title:{default:"PIKAS | Tu día escolar, más simple",template:"%s | PIKAS"},description:"Wallet escolar, controles familiares y preórdenes en una experiencia compartida.",icons:{icon:"/brand/favicon-32x32.png",apple:"/brand/apple-touch-icon.png"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="es" data-scroll-behavior="smooth"><body><RouteDemoProvider><SessionSecurityBoundary enabled={!isDemoMode()}>{children}</SessionSecurityBoundary></RouteDemoProvider></body></html>}
