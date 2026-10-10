'use client';
import { createContext, useContext } from 'react';
import type { useDemo } from './demo-provider';
type Demo = ReturnType<typeof useDemo>;
export type CatalogWorkspace = Pick<Demo,'connection'|'adminAddMenu'|'adminUpdateMenu'|'adminSaveCafeteriaMenu'|'adminSaveServiceShift'|'adminSetServiceScheduling'> & {
 connected?: boolean;
 timeZone?: string;
 categories?: string[];
 scope: { organizationId:string; locationId:string };
 state: Pick<Demo['state'],'menuItems'|'cafeteriaOperations'>;
};
export const CatalogEditorContext = createContext<CatalogWorkspace|null>(null);
export function useCatalogEditor() {
 const workspace = useContext(CatalogEditorContext);
 if (!workspace) throw new Error('Catalog workspace missing');
 return workspace;
}
