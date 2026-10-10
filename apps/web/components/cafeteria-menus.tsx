'use client';
import { useDemo } from './demo-provider';
import { CatalogEditorContext } from './cafeteria-editor-context';
import { CafeteriaMenusEditor } from './cafeteria-menus-editor';
export function CafeteriaMenus({ shifts = false }: { shifts?: boolean }) {
 const workspace = useDemo();
 return <CatalogEditorContext.Provider value={{...workspace,scope:{organizationId:'cafeteria-demo',locationId:'principal'}}}><CafeteriaMenusEditor shifts={shifts} /></CatalogEditorContext.Provider>;
}
