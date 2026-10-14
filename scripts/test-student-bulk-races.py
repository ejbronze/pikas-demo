#!/usr/bin/env python3
"""LOCAL ONLY: five focused bulk races; tagged successful test students/journals are retained.
No fixture reset, production target, tenant grant or financial operation.
"""
import json
import subprocess
import time
import uuid
DOCKER='/Applications/Docker.app/Contents/Resources/bin/docker'
CMD=[DOCKER,'exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres']

def sql(text):
 p=subprocess.run(CMD,input=text,text=True,capture_output=True,timeout=30)
 assert p.returncode==0,p.stderr
 return p.stdout.strip()
assert subprocess.check_output([DOCKER,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],text=True).strip()=='pikas-4d6'
uid=sql("select auth_user_id from persons where id='4d6b0000-0000-4000-8000-000000000001'")
assert str(uuid.UUID(uid))==uid
school='df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488'

def claims(sid):return json.dumps({'sub':uid,'role':'authenticated','session_id':sid})
def initialize(sid):
 sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{sid}','{uid}',clock_timestamp(),clock_timestamp());set request.jwt.claims='{claims(sid)}';select public.pikas_session_start();")
def connection(sid):
 p=subprocess.Popen(CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 p.stdin.write(f"begin;set local statement_timeout='20s';set local request.jwt.claims='{claims(sid)}';set local role authenticated;select 'READY:'||pg_backend_pid();\n");p.stdin.flush()
 for line in p.stdout:
  if line.startswith('READY:'):return p,int(line.split(':')[1])
 raise AssertionError(p.stderr.read())
def write(p,text):p.stdin.write(text+'\n');p.stdin.flush()
def finish(p):
 p.stdin.close();p.wait(timeout=25)
 return p.returncode,p.stdout.read(),p.stderr.read()
def blocked(bpid,apid):
 for _ in range(100):
  if sql(f'select {apid}=any(pg_blocking_pids({bpid}))')=='t':return
  time.sleep(.03)
 raise AssertionError('Blocking not observed')
def command(key,code,campus=False):
 rows=json.dumps([{'source_row':2,'first_name':'Bulk race','last_name':'Local only','student_code':code,'starts_on':sql('select current_date::text'),**({'location_id':'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4'} if campus else {})}])
 return f"select public.school_student_bulk_commit('{school}','{key}','{rows}'::jsonb,array[2],true);"
for case in ['duplicate_codes','exact_replay','mismatched_replay','timeout_while_waiting','campus_stability']:
 sa,sb=str(uuid.uuid4()),str(uuid.uuid4());a=b=None
 code='B2A-RACE-'+uuid.uuid4().hex[:12];ka,kb=str(uuid.uuid4()),str(uuid.uuid4())
 if case in ['exact_replay','mismatched_replay']:kb=ka
 codeb=code+'-OTHER' if case=='mismatched_replay' else code
 try:
  initialize(sa);initialize(sb)
  sql(f"set request.jwt.claims='{claims(sa)}';select public.platform_enter_sandbox_pov('{uuid.uuid4()}','03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin');")
  a,apid=connection(sa);write(a,command(ka,code,case=='campus_stability')+"select 'HOLD';")
  first=None
  for line in a.stdout:
   if line.startswith('{'):first=json.loads(line)
   if line.strip()=='HOLD':break
  assert first and first['status']=='committed'
  b,bpid=connection(sb)
  if case=='campus_stability':write(b,"reset role;select id from public.school_locations where id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4' for no key update;rollback;")
  else:write(b,command(kb,codeb)+'commit;')
  blocked(bpid,apid)
  if case=='timeout_while_waiting':sql(f"update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '31 minutes' where session_id='{sb}';")
  write(a,'commit;');assert finish(a)[0]==0
  status,out,err=finish(b)
  if case=='mismatched_replay':assert status!=0 and '23505' in err and 'student_bulk_request_conflict' in err,err
  elif case=='timeout_while_waiting':assert status!=0 and '42501' in err and 'application_session_expired' in err,err
  elif case=='campus_stability':assert status==0,err
  else:
   assert status==0,err
   second=next(json.loads(line) for line in out.splitlines() if line.startswith('{'))
   if case=='exact_replay':assert second==first
   else:assert second['status']=='invalid' and second['rows'][0]['errors']==['existing_code']
  assert sql(f"select count(*) from students where school_id='{school}' and code_key=lower('{code}')")=='1'
  assert sql(f"select count(*) from pikas_private.student_bulk_requests where request_id='{ka}'")=='1'
  if kb!=ka:assert sql(f"select count(*) from pikas_private.student_bulk_requests where request_id='{kb}'")=='0'
  if codeb!=code:assert sql(f"select count(*) from students where code_key=lower('{codeb}')")=='0'
  print(f'PASS {case}: pg_blocking_pids({bpid}) observed {apid}; losing/replayed operation created no duplicate')
 finally:
  for p in [a,b]:
   if p and p.poll() is None:p.kill();p.wait()
  sql(f"delete from auth.sessions where id in ('{sa}','{sb}') and user_id='{uid}';")
print('PASS 5/5 bulk race cases; successful tagged local fixture rows retained')
