#!/usr/bin/env python3
"""Local Docker only: focused 4D.4 lock proofs. Reset local DB afterward."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
DOCKER=shutil.which('docker') or '/Applications/Docker.app/Contents/Resources/bin/docker'
CONTAINER='supabase_db_pikas-foundation'
CMD=[DOCKER,'exec','-i',CONTAINER,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres']
ADMIN='4d4c0000-0000-4000-8000-000000000001'
PERSON='4d4c0000-0000-4000-8000-000000000002'
AUTH='4d4c0000-0000-4000-8000-000000000003'
MEMBER='4d4c0000-0000-4000-8000-000000000004'
KEY='4d4c0000-0000-4000-8000-000000000005'
PREPARE='4d4c0000-0000-4000-8000-000000000006'
def run(sql):
 r=subprocess.run(CMD,input=sql,text=True,capture_output=True,timeout=30)
 if r.returncode: raise AssertionError(r.stderr)
 return r.stdout.strip()
def connection(sql):
 p=subprocess.Popen(CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 p.stdin.write("set statement_timeout='25s';\n"+sql+"\nselect 'READY:'||pg_backend_pid();\n");p.stdin.flush()
 for line in p.stdout:
  if line.startswith('READY:'):return p,int(line.split(':')[1])
 raise AssertionError(p.stderr.read())
def blocked(worker,holder):
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  if run(f'select {holder}=any(pg_blocking_pids({worker}));')=='t':return
  time.sleep(.04)
 raise AssertionError('Actual blocking not observed')
def finish(p,sql=''):
 out,err=p.communicate(sql+'\n',timeout=30)
 return p.returncode,out.strip(),err
def stop(*processes):
 for p in processes:
  if p is not None and p.poll() is None:p.kill();p.communicate(timeout=10)
def prefix():return f"set request.jwt.claim.sub='{ADMIN}';set role authenticated;"
def command(key,op,payload):return f"select public.platform_team_command('{key}','{op}','{json.dumps(payload)}');"
def count(key):return run(f"select count(*) from pikas_private.platform_requests where request_id='{key}';")
def preflight():
 endpoint=os.environ.get('DOCKER_HOST') or subprocess.check_output([DOCKER,'context','inspect','--format','{{.Endpoints.docker.Host}}'],text=True).strip()
 if endpoint not in {'unix:///var/run/docker.sock','unix://'+str(Path.home()/'.docker/run/docker.sock')}:raise RuntimeError('Refusing non-local Docker')
 label=subprocess.check_output([DOCKER,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}',CONTAINER],text=True).strip()
 if label!='pikas-foundation' or run('select max(version) from supabase_migrations.schema_migrations;')!='202610100004':raise RuntimeError('Wrong local project/migration')
 if run(f"select exists(select 1 from auth.users where id='{ADMIN}');")!='f':raise RuntimeError('Reset local DB before rerun')
def revocation():
 holder=worker=None
 try:
  holder,hp=connection(f"begin;update pikas_private.platform_memberships set status='suspended' where id='{MEMBER}';")
  worker,wp=connection(prefix());worker.stdin.write(command(KEY,'prepare',{'name':'Synthetic','email':'revoked@example.invalid','demo':True})+'\n');worker.stdin.flush();blocked(wp,hp)
  assert finish(holder,'commit;')[0]==0
  code,_,err=finish(worker);assert code!=0 and '42501' in err,err
  assert count(KEY)=='0'
  assert run("select count(*) from pikas_private.platform_team_intents where email_key='revoked@example.invalid';")=='0'
  print('PASS: revoked authority denies waiting preparation and journal')
 finally:
  stop(holder,worker);run(f"update pikas_private.platform_memberships set status='active' where id='{MEMBER}';")
def completion(change_email):
 run(prefix()+command(PREPARE,'prepare',{'name':'Synthetic operator','email':'team-race@example.invalid','demo':True}))
 handle=run("select handle from pikas_private.platform_team_intents where email_key='team-race@example.invalid' and status='pending' and expires_at>clock_timestamp();")
 sql=command(KEY,'complete',{'handle':handle})
 holder=first=second=None
 try:
  holder,hp=connection(f"begin;select id from auth.users where id='{AUTH}' for update;")
  first,fp=connection(prefix());first.stdin.write(sql+'\n');first.stdin.flush();blocked(fp,hp)
  if change_email:
   assert finish(holder,f"update auth.users set email='changed@example.invalid' where id='{AUTH}';commit;")[0]==0
   code,_,err=finish(first);assert code!=0 and 'confirmed_identity_pending' in err,err
   assert count(KEY)=='0'
   assert run(f"select count(*) from public.persons where auth_user_id='{AUTH}';")=='0'
   print('PASS: committed Auth email change prevents Person and role grant')
  else:
   second,sp=connection(prefix());second.stdin.write(sql+'\n');second.stdin.flush();blocked(sp,fp)
   assert finish(holder,'commit;')[0]==0
   c1,o1,e1=finish(first);c2,o2,e2=finish(second);assert c1==c2==0,(e1,e2);assert json.loads(o1)==json.loads(o2)
   assert run(f"select count(*) from public.persons where auth_user_id='{AUTH}';")=='1'
   assert run(f"select count(*) from pikas_private.platform_memberships m join public.persons p on p.id=m.person_id where p.auth_user_id='{AUTH}';")=='2'
   assert count(KEY)=='1'
   assert run(f"select count(*) from pikas_private.platform_audit_events where request_id='{KEY}' and action='team_complete' and actor_person_id='{PERSON}';")=='1'
   print('PASS: concurrent same-key completion yields one Person, selected roles and real-actor audit')
 finally:stop(holder,first,second)
def main():
 global KEY,PREPARE
 preflight()
 run(f"insert into auth.users(id,aud,role,email,confirmed_at) values('{ADMIN}','authenticated','authenticated','team-race-admin@example.invalid',now()),('{AUTH}','authenticated','authenticated','team-race@example.invalid',now());insert into public.persons(id,auth_user_id,display_name) values('{PERSON}','{ADMIN}','Synthetic admin');insert into pikas_private.platform_memberships(id,person_id,role_code) values('{MEMBER}','{PERSON}','platform_admin');insert into pikas_private.platform_team_handles(person_id) values('{PERSON}');")
 revocation();completion(True)
 # Preserve failed request fixtures and use a separate identity/intent/key for the next race.
 run(f"update auth.users set email='team-race@example.invalid' where id='{AUTH}';update pikas_private.platform_team_intents set expires_at=clock_timestamp()-interval '1 second' where email_key='team-race@example.invalid';")
 KEY='4d4c0000-0000-4000-8000-000000000007';PREPARE='4d4c0000-0000-4000-8000-000000000008'
 completion(False)
 print('3 focused concurrency cases passed; pg_blocking_pids observed every boundary. Reset local DB.')
if __name__=='__main__':main()
