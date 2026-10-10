'use client';
import { useDemo } from './demo-provider';
import { CatalogEditorContext } from './cafeteria-editor-context';
import { CafeteriaProductsEditor } from './cafeteria-products-editor';
export function CafeteriaProducts() {
 const workspace = useDemo();
 return <CatalogEditorContext.Provider value={{...workspace,scope:{organizationId:'cafeteria-demo',locationId:'principal'}}}><CafeteriaProductsEditor /></CatalogEditorContext.Provider>;
}
