import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
(globalThis as {React?: typeof React}).React = React;
import { AdminDialog, AdminStatus } from './admin-interactions';
describe('focused administration interactions',()=>{
 it('dialog has a named title and semantic close control',()=>{const html=renderToStaticMarkup(<AdminDialog title="Perfil de Luna" onClose={()=>{}}><p>Matrícula</p></AdminDialog>);expect(html).toMatch(/<dialog[^>]+aria-labelledby=/);expect(html).toContain('Perfil de Luna');expect(html).toMatch(/<button[^>]+type="button"[^>]*>Cerrar/);});
 it('status communicates its meaning in text',()=>{expect(renderToStaticMarkup(<AdminStatus label="Suspendido"/>)).toContain('Suspendido');});
});
