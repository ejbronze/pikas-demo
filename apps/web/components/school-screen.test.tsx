import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));
const mocks=vi.hoisted(()=>({rpc:vi.fn(),access:vi.fn()}));
vi.mock("../lib/supabase/server",()=>({createSupabaseServerClient:async()=>({rpc:mocks.rpc})}));
vi.mock("../lib/auth/school-access",()=>({resolveSchoolAccess:mocks.access}));
vi.mock("./connected-school-shell",()=>({ConnectedSchoolShell:()=>null}));
vi.mock("./connected-school-pages",()=>({ConnectedSchoolPages:()=>null}));
(globalThis as {React?:typeof React}).React=React;
import {SchoolScreen} from "./school-screen";
const id="4d700000-0000-4000-8000-000000000001";
beforeEach(()=>{mocks.rpc.mockReset();mocks.access.mockResolvedValue({status:"authorized",context:{person_id:id,schools:[{school_id:id}]}});mocks.rpc.mockResolvedValue({data:null,error:null});});
describe('authoritative roster filters',()=>{
 it('forwards campus/exact grade alongside search status cursor and limit',async()=>{await SchoolScreen({section:'students',searchParams:Promise.resolve({school:id,location:id,grade:'4 A',q:'Luna',status:'active',after:id})});expect(mocks.rpc).toHaveBeenCalledWith('school_student_roster',{p_school_id:id,p_location_id:id,p_grade:'4 A',p_query:'Luna',p_status:'active',p_after:id,p_limit:50});});
 it('passes null optional filters',async()=>{await SchoolScreen({section:'students',searchParams:Promise.resolve({school:id})});expect(mocks.rpc).toHaveBeenCalledWith('school_student_roster',expect.objectContaining({p_location_id:null,p_grade:null}));});
 it('rejects malformed filters before RPC',async()=>{await SchoolScreen({section:'students',searchParams:Promise.resolve({location:'other'})});expect(mocks.rpc).not.toHaveBeenCalled();});
 it('preserves existing non-student read',async()=>{await SchoolScreen({section:'summary',searchParams:Promise.resolve({school:id})});expect(mocks.rpc).toHaveBeenCalledWith('school_admin_read',expect.objectContaining({p_section:'summary'}));});
});
