#!/usr/bin/env python3
"""Local Docker only: 4D.3 mutation locks with observed blocking and final-state proofs.
Synthetic fixtures persist locally; reset the local database after running.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
DOCKER=shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
CONTAINER="supabase_db_pikas-foundation"
CMD=[DOCKER,"exec","-i",CONTAINER,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose","-U","postgres","-d","postgres"]
IDENTITY="4d3c0000-0000-4000-8000-000000000001"
CAFETERIA="00000000-0000-0000-0000-000000000111"
AUTH="00000000-0000-0000-0000-000000002003"
MEMBER="00000000-0000-0000-0000-000000003201"
REQUEST="4d3c0000-0000-4000-8000-000000000002"
PREPARE="4d3c0000-0000-4000-8000-000000000003"
REGISTER="4d3c0000-0000-4000-8000-000000000004"
def run(sql):
    result = subprocess.run(CMD, input=sql, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def preflight():
    endpoint = os.environ.get("DOCKER_HOST") or subprocess.check_output([DOCKER, "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], text=True).strip()
    if endpoint not in {"unix:///var/run/docker.sock", "unix://" + str(Path.home() / ".docker/run/docker.sock")}:
        raise RuntimeError("Refusing non-local Docker")
    label = subprocess.check_output([DOCKER, "inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', CONTAINER], text=True).strip()
    if label != "pikas-foundation" or run("select max(version) from supabase_migrations.schema_migrations;") != "202610100003":
        raise RuntimeError("Unexpected local project/migration")
    if run(f"select exists(select 1 from auth.users where id='{IDENTITY}');") != "f":
        raise RuntimeError("Reset local fixtures before running this harness")


def connection(sql):
    process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write("set statement_timeout='25s';\n" + sql + "\nselect 'READY:'||pg_backend_pid();\n")
    process.stdin.flush()
    for line in process.stdout:
        if line.startswith("READY:"):
            return process, int(line.split(":")[1])
    raise AssertionError(process.stderr.read())


def blocked(worker_pid, holder_pid):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if run(f"select {holder_pid}=any(pg_blocking_pids({worker_pid}));") == "t":
            return
        time.sleep(.04)
    raise AssertionError("Actual lock blocking was not observed")


def finish(process, statement=""):
    output, error = process.communicate(statement + "\n", timeout=30)
    return process.returncode, output.strip(), error


def stop(*processes):
    for process in processes:
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate(timeout=10)



def prefix(auth=AUTH):
    return f"set request.jwt.claim.sub='{auth}'; set role authenticated;"


def command(key, operation, payload):
    return f"select public.cafeteria_admin_command('{CAFETERIA}','{key}','{operation}','{json.dumps(payload)}');"


def journal_count(key):
    return run(f"select count(*) from pikas_private.cafeteria_admin_requests where request_id='{key}';")


def revocation():
    holder = worker = None
    try:
        holder, hp = connection(f"begin; update public.cafeteria_memberships set status='suspended' where id='{MEMBER}';")
        worker, wp = connection(prefix())
        worker.stdin.write(command(REQUEST, 'register_save', {'id':REGISTER,'version':None,'code':'RACE','name':'Synthetic race','status':'active'})+"\n"); worker.stdin.flush()
        blocked(wp,hp)
        assert finish(holder,'commit;')[0]==0
        code,_,error=finish(worker)
        assert code!=0 and '42501' in error and 'cafeteria_authority_required' in error,error
        assert journal_count(REQUEST)=='0'
        assert run(f"select count(*) from public.cafeteria_registers where id='{REGISTER}';")=='0'
        print('PASS: revoked membership denies waiting write, register and journal')
    finally:
        stop(holder,worker)
        run(f"update public.cafeteria_memberships set status='active' where id='{MEMBER}';")


def staff_completion(change_email=False):
    invitation=json.loads(run(prefix()+command(PREPARE,'staff_prepare',{'email':'4d3-race@example.invalid','role':'pos_cashier'})))['target_id']
    sql=command(REQUEST,'staff_complete',{'invitation_id':invitation,'display_name':'Synthetic race cashier'})
    holder=first=second=None
    try:
        holder,hp=connection(f"begin; select id from auth.users where id='{IDENTITY}' for update;")
        first,fp=connection(prefix()); first.stdin.write(sql+"\n"); first.stdin.flush(); blocked(fp,hp)
        if change_email:
            assert finish(holder,f"update auth.users set email='changed@example.invalid' where id='{IDENTITY}'; commit;")[0]==0
            code,_,error=finish(first)
            assert code!=0 and 'confirmed_identity_pending' in error,error
            assert run(f"select count(*) from public.persons where auth_user_id='{IDENTITY}';")=='0'
            assert journal_count(REQUEST)=='0'
            run(f"update auth.users set email='4d3-race@example.invalid' where id='{IDENTITY}';")
            print('PASS: Auth email change across lock cannot link or grant')
            return
        second,sp=connection(prefix()); second.stdin.write(sql+"\n"); second.stdin.flush(); blocked(sp,fp)
        assert finish(holder,'commit;')[0]==0
        c1,o1,e1=finish(first); c2,o2,e2=finish(second)
        assert c1==c2==0,e1+e2
        assert json.loads(o1)==json.loads(o2)
        assert run(f"select count(*) from public.persons where auth_user_id='{IDENTITY}';")=='1'
        assert run(f"select count(*) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id where p.auth_user_id='{IDENTITY}' and m.cafeteria_id='{CAFETERIA}';")=='1'
        assert run(f"select count(*) from public.audit_events where request_id='{REQUEST}';")=='1'
        print('PASS: same-key staff completion creates one Person, membership and command audit')
    finally:
        stop(holder,first,second)


def open_session_conflict():
    holder=worker=None
    register='00000000-0000-0000-0000-000000009401'
    key='4d3c0000-0000-4000-8000-000000000005'
    try:
        holder,hp=connection("begin;"+prefix('00000000-0000-0000-0000-000000002008')+f"select public.open_register_session('{register}','00000000-0000-0000-0000-000000009501',0,'4d3-real-open-session-race');")
        worker,wp=connection(prefix()); worker.stdin.write(command(key,'register_save',{'id':register,'version':1,'code':'CAJA-1','name':'Unsafe rename','status':'inactive'})+"\n");worker.stdin.flush();blocked(wp,hp)
        assert finish(holder,'commit;')[0]==0
        code,_,error=finish(worker)
        assert code!=0 and 'open_register_configuration_locked' in error,error
        assert journal_count(key)=='0'
        assert run(f"select display_name||':'||status||':'||version from public.cafeteria_registers where id='{register}';")=='Caja 1:active:1'
        print('PASS: concurrent POS session opening blocks unsafe register edit')
    finally:
        stop(holder,worker)


def assignment_revocation():
    holder=worker=None
    member='00000000-0000-0000-0000-000000004601'
    key='4d3c0000-0000-4000-8000-000000000006'
    try:
        holder,hp=connection(f"begin; update public.cafeteria_memberships set status='suspended' where id='{member}';")
        worker,wp=connection(prefix()); worker.stdin.write(command(key,'assignment_save',{'membership_id':member,'register_id':'00000000-0000-0000-0000-000000009402','status':'active','version':1})+"\n");worker.stdin.flush();blocked(wp,hp)
        assert finish(holder,'commit;')[0]==0
        code,_,error=finish(worker)
        assert code!=0 and 'active_pos_membership_and_register_required' in error,error
        assert journal_count(key)=='0'
        assert run("select version from public.cafeteria_register_assignments where id='00000000-0000-0000-0000-000000009502';")=='1'
        print('PASS: staff revoked across lock cannot receive active assignment')
    finally:
        stop(holder,worker)
        run(f"update public.cafeteria_memberships set status='active' where id='{member}';")


def same_key_register():
    holder=first=second=None
    key='4d3c0000-0000-4000-8000-000000000007'
    sql=command(key,'register_save',{'id':REGISTER,'version':None,'code':'RACE','name':'Synthetic race','status':'active'})
    try:
        holder,hp=connection(f"begin; select pg_advisory_xact_lock(hashtextextended('{key}',20261013));")
        first,fp=connection(prefix());first.stdin.write(sql+"\n");first.stdin.flush();blocked(fp,hp)
        second,sp=connection(prefix());second.stdin.write(sql+"\n");second.stdin.flush();blocked(sp,hp)
        assert finish(holder,'commit;')[0]==0
        c1,o1,e1=finish(first);c2,o2,e2=finish(second)
        assert c1==c2==0,e1+e2
        assert json.loads(o1)==json.loads(o2)
        assert run(f"select count(*) from public.cafeteria_registers where id='{REGISTER}';")=='1'
        assert run(f"select count(*) from public.audit_events where request_id='{key}';")=='1'
        print('PASS: concurrent same-key register creation creates one register and command audit')
    finally:
        stop(holder,first,second)


if __name__=='__main__':
    preflight()
    run("update auth.users set confirmed_at=now() where id='00000000-0000-0000-0000-000000002008';")
    revocation()
    run(f"insert into auth.users(id,aud,role,email,confirmed_at) values('{IDENTITY}','authenticated','authenticated','4d3-race@example.invalid',now());")
    staff_completion(change_email=True)
    staff_completion()
    open_session_conflict()
    assignment_revocation()
    same_key_register()
    print('6 real concurrency cases passed; pg_blocking_pids observed every boundary')
