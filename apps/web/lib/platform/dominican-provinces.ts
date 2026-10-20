// Canonical ISO 3166-2:DO subdivisions, mirrored by pikas_private.country_subdivisions. The database
// is authoritative; this list only drives the Agregar colegio selector and request validation.
export const DOMINICAN_REPUBLIC = { code: "DO", name: "República Dominicana" } as const;
export const dominicanProvinces = [
  ["DO-01", "Distrito Nacional"], ["DO-02", "Azua"], ["DO-03", "Baoruco"], ["DO-04", "Barahona"],
  ["DO-05", "Dajabón"], ["DO-06", "Duarte"], ["DO-07", "Elías Piña"], ["DO-08", "El Seibo"],
  ["DO-09", "Espaillat"], ["DO-10", "Independencia"], ["DO-11", "La Altagracia"], ["DO-12", "La Romana"],
  ["DO-13", "La Vega"], ["DO-14", "María Trinidad Sánchez"], ["DO-15", "Monte Cristi"], ["DO-16", "Pedernales"],
  ["DO-17", "Peravia"], ["DO-18", "Puerto Plata"], ["DO-19", "Hermanas Mirabal"], ["DO-20", "Samaná"],
  ["DO-21", "San Cristóbal"], ["DO-22", "San Juan"], ["DO-23", "San Pedro de Macorís"], ["DO-24", "Sánchez Ramírez"],
  ["DO-25", "Santiago"], ["DO-26", "Santiago Rodríguez"], ["DO-27", "Valverde"], ["DO-28", "Monseñor Nouel"],
  ["DO-29", "Monte Plata"], ["DO-30", "Hato Mayor"], ["DO-31", "San José de Ocoa"], ["DO-32", "Santo Domingo"],
] as const;
export type DominicanProvinceCode = typeof dominicanProvinces[number][0];
export const provinceCodes = dominicanProvinces.map(([code]) => code) as [DominicanProvinceCode, ...DominicanProvinceCode[]];
export const countryName = (code: string | null | undefined) => code === DOMINICAN_REPUBLIC.code ? DOMINICAN_REPUBLIC.name : code ?? null;
export const provinceName = (code: string) => dominicanProvinces.find(([value]) => value === code)?.[1] ?? code;
