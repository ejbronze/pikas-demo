// LOCAL ONLY: real PostgREST/Supabase Auth proof for the 200-row bulk RPC boundary.
// Successful tagged fixture students/journal are retained; no reset or production target.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve('node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
const client=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
assert.equal((await client.auth.signInWithPassword({email:'browser-edwin-4d6@example.invalid',password:'Local-4D6-fictional-only-938!'})).error,null);
assert.equal((await client.rpc('pikas_session_start')).error,null);
const school='df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
try{
 assert.equal((await client.rpc('platform_enter_sandbox_pov',{p_request_id:randomUUID(),p_account_id:'03e71159-69e9-4387-9b3b-65799d49faf0',p_cafeteria_id:'b9496342-5079-46ae-83b8-05c39bcbd7fe',p_pov_code:'school_admin'})).error,null);
 const prefix='B2A-HTTP-'+randomUUID().slice(0,8),date=sql('select current_date::text');
 const rows=Array.from({length:200},(_,i)=>({source_row:i+2,first_name:'Bulk HTTP',last_name:'Local fixture',student_code:prefix+'-'+i,starts_on:date}));
 const validated=await client.rpc('school_student_bulk_validate',{p_school_id:school,p_rows:rows});assert.equal(validated.error,null);assert.equal(validated.data.valid,true);assert.equal(validated.data.rows.length,200);
 const request_id=randomUUID(),included=rows.map(r=>r.source_row),started=performance.now();
 const committed=await client.rpc('school_student_bulk_commit',{p_school_id:school,p_request_id:request_id,p_rows:rows,p_included_rows:included,p_confirmed:true});
 assert.equal(committed.error,null,JSON.stringify(committed.error));assert.equal(committed.data.status,'committed');assert.equal(committed.data.created.length,200);
 const elapsed=performance.now()-started;
 const replay=await client.rpc('school_student_bulk_commit',{p_school_id:school,p_request_id:request_id,p_rows:rows.toReversed(),p_included_rows:included.toReversed(),p_confirmed:true});assert.equal(replay.error,null);assert.deepEqual(replay.data,committed.data);
 assert.equal(sql(`select count(*) from students where school_id='${school}' and student_code like '${prefix}-%'`),'200');
 const session=await client.rpc('pikas_session_status');assert.equal(session.error,null);const sid=session.data.session_id;
 sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '31 minutes' where session_id='${sid}'`);
 assert.equal((await client.rpc('school_student_bulk_validate',{p_school_id:school,p_rows:rows})).error?.message,'application_session_expired');
 assert.equal((await client.rpc('school_student_bulk_commit',{p_school_id:school,p_request_id:request_id,p_rows:rows,p_included_rows:included,p_confirmed:true})).error?.message,'application_session_expired');
 console.log(`PASS real HTTP: 200-row validation/atomic commit (${Math.round(elapsed)}ms), canonical replay, exactly 200 students; expired direct validation/replay denied.`);
}finally{assert.equal((await client.rpc('pikas_session_end')).error,null);assert.equal((await client.auth.signOut({scope:'local'})).error,null);}
