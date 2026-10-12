import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
(globalThis as {React?: typeof React}).React = React;
import { AdminDialog, AdminStatus } from './admin-interactions';
import { StudentCreateWorkflow } from './student-create-workflow';
import type { SchoolRead } from '../lib/school/contracts';
const id='4d700000-0000-4000-8000-000000000001';
const data:SchoolRead={scope:{actor_id:id,membership_id:id,role:'school_admin',account_id:id,school_id:id,account_name:'Cuenta',school_name:'Escuela',tenant_kind:'customer'},locations:[]};
describe('focused administration interactions',()=>{
 it('dialog has a named title and semantic close control',()=>{const html=renderToStaticMarkup(<AdminDialog title="Perfil de Luna" onClose={()=>{}}><p>Matrícula</p></AdminDialog>);expect(html).toMatch(/<dialog[^>]+aria-labelledby=/);expect(html).toContain('Perfil de Luna');expect(html).toMatch(/<button[^>]+type="button"[^>]*>Cerrar/);});
 it('status communicates its meaning in text',()=>{expect(renderToStaticMarkup(<AdminStatus label="Suspendido"/>)).toContain('Suspendido');});
 it('creation offers only supported steps and fields without an embedded bulk or financial operation',()=>{const html=renderToStaticMarkup(<StudentCreateWorkflow data={data} actorId={id} onClose={()=>{}} onCreated={()=>{}}/>);for(const label of ['Información del estudiante','Matrícula escolar','Revisar y crear','Código estudiantil','Fecha efectiva','Cancelar'])expect(html).toContain(label);for(const unsupported of ['Fecha de nacimiento','Género','Recargar','Acceso/servicios','Importar'])expect(html).not.toContain(unsupported);expect(html).not.toContain('type="submit"');});
});
