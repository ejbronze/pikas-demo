import type { Metadata } from "next";
import "./globals.css";
import { DemoProvider } from "@/components/demo-provider";
export const metadata:Metadata={title:{default:"PIKAS | Tu día escolar, más simple",template:"%s | PIKAS"},description:"Wallet escolar, controles familiares y preórdenes en una experiencia compartida."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="es" data-scroll-behavior="smooth"><body><DemoProvider>{children}</DemoProvider></body></html>}
