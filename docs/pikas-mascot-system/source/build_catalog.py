import base64, json, html
def d(f): return 'data:image/svg+xml;base64,' + base64.b64encode(open(f, 'rb').read()).decode()

SETS = [
 ('Foundation', 'A', [
   ('FND-01','Neutral front','pikas-fnd-01-neutral.svg','The canonical full figure. Base for every pose.','off'),
   ('FND-02','Three-quarter','pikas-fnd-02-three-quarter.svg','Beside text blocks and cards.','off'),
   ('FND-03','Wave','pikas-fnd-03-wave.svg','Welcome, sign-in, website hero.','off'),
   ('FND-04','Point right','pikas-fnd-04-point-right.svg','Points to a button or panel on the right.','off'),
   ('FND-08','Head mark','pikas-fnd-08-head.svg','Avatars, toasts, navigation. 24–64 px.','off'),
   ('FND-08c','Head mark, cap','pikas-fnd-08-head-cap.svg','Head mark for Onboarding, Cafetería and POS.','on'),
   ('FND-05','Point left','pikas-fnd-05-point-left.svg','Points to a button or panel on the left.','off'),
   ('FND-06','Present','pikas-fnd-06-present.svg','Introducing a screen or feature; website, presentations.','off'),
   ('FND-07','Think','pikas-fnd-07-think.svg','Decision points and help prompts.','off'),
   ('FND-09','Flower','pikas-fnd-09-flower.svg','Students, welcome, progress, website chapters.','off')]),
 ('Success', 'B', [
   ('SUC-01','Done','pikas-suc-01-done.svg','Saved, configured, task complete.','off'),
   ('SUC-02','Celebrate','pikas-suc-02-celebrate.svg','Setup complete, go-live. Once per milestone.','off'),
   ('SUC-03','Checklist done','pikas-suc-03-checklist-done.svg','Readiness at 100%, cashier ready.','off')]),
 ('Onboarding', 'C', [
   ('ONB-01','Checklist','pikas-onb-01-checklist.svg','Readiness checklists in School, Cafetería and Platform.','on'),
   ('ONB-02','Map','pikas-onb-02-map.svg','First onboarding step: here is the route.','on'),
   ('ONB-03','Next step','pikas-onb-03-next-step.svg','Between steps of a multi-step flow.','on')]),
 ('Cafetería', 'D', [
   ('CAF-01','Tray','pikas-caf-01-tray.svg','Products and menus; empty menu state.','on'),
   ('CAF-02','Caja','pikas-caf-02-caja.svg','Caja setup and empty Caja list.','on'),
   ('CAF-03','Staff','pikas-caf-03-staff.svg','Staff list, inviting a cashier.','on')]),
 ('POS', 'E', [
   ('POS-01','Ready','pikas-pos-01-ready.svg','"Caja lista" at shift start. 32–64 px.','on'),
   ('POS-02','Sale complete','pikas-pos-02-sale-complete.svg','Payment accepted, shown for 1.5 s.','on'),
   ('POS-03','Offline','pikas-pos-03-offline.svg','Beside the offline banner text. Never on declined payments.','on')]),
 ('PIKAS Cash', 'F', [
   ('FIN-01','Card','pikas-fin-01-card.svg','Paying: wallet intro, POS, transactions.','off'),
   ('FIN-02','Receipt review','pikas-fin-02-receipt.svg','Transaction history header; no receipts yet.','off'),
   ('FIN-03','Transfer','pikas-fin-03-transfer.svg','Explaining a top-up or transfer, before the form.','off'),
   ('FIN-04','Wallet','pikas-fin-04-wallet.svg','The account: balance, wallet home, top-ups.','off'),
   ('FIN-05','Coin purse','pikas-fin-05-purse.svg','Today\'s money: "Para hoy", allowance, student pocket view.','off')]),
 ('Session and attention', 'G', [
   ('ATT-01','Worried, hourglass','pikas-att-01-worried.svg','"Tu sesión está por terminar." Countdown warnings only.','off'),
   ('ATT-02','Bored','pikas-att-02-bored.svg','"¿Sigues ahí?" after a long idle. Student views only.','off')]),
 ('Support', 'G', [
   ('SUP-01','Helper','pikas-sup-01-helper.svg','Help centre, contact support.','off'),
   ('SUP-02','Magnifier','pikas-sup-02-magnifier.svg','No search results; checking setup.','off'),
   ('SUP-03','Needs attention','pikas-sup-03-needs-attention.svg','Recoverable warnings only: a missing Caja or price.','off')]),
 ('Empty states', 'H', [
   ('EMP-01','Empty tray','pikas-emp-01-empty-tray.svg','No products or no menu yet, with a create button.','off'),
   ('EMP-02','Empty box','pikas-emp-02-empty-box.svg','Any list with no records yet, with a create button.','off')]),
 ('Demo', 'I', [
   ('DEM-01','Demo PIKAS','pikas-dem-01-demo.svg','Demo Lab, sandbox banners, the public demo.','off')]),
]
MOTION = [
 ('LOAD-01','Collecting flowers','pikas-load-01-collecting.svg','Loop, 3.6 s. Show after 1 s of waiting; swap to text after 10 s.', False),
 ('Blink','Idle blink','pikas-fnd-01-neutral-blink.svg','Loop, every 5.5 s. Welcome and empty states.', False),
 ('Wave','Wave','pikas-fnd-03-wave-anim.svg','One-shot, 2 swings, 0.9 s each.', True),
 ('Bounce-in','Bounce-in','pikas-emp-02-empty-box-bounce.svg','One-shot, 0.45 s, on entering a state.', True),
 ('Success pop','Success pop','pikas-suc-01-done-pop.svg','One-shot, 0.35 s pop + check draw.', True),
 ('WALK-01','Walk cycle','pikas-walk-01.svg','Loop, 0.64 s per step pair. Website valley only; scrub its position with scroll.', False),
 ('Countdown','Session countdown','pikas-att-01-worried-countdown.svg','Loop. Sand drains over the time left (set --countdown); eyes glance at the hourglass.', False),
]
PENDING = ['Website chapters 2–6 (Families, Cafetería, POS, PIKAS Cash, closing view)','Final package and agent handoff brief']
PALETTE = [('PIKAS Yellow','#FFC72C','Body'),('PIKAS Navy','#0E1E4A','Line, eyes, cap'),('PIKAS Teal','#16C2C7','Props, tile'),
           ('Teal Deep','#0A7C82','Teal for text'),('Cream','#FFF4E0','Ears, muzzle, belly'),('Blush','#F47C7C','Tongue'),
           ('Flower Yellow','#FFE066','Petals'),('Flower Orange','#E8731C','Flower centre'),('Leaf Green','#3BAA6E','Stem, haypile')]

sources = {}
def card(aid, name, f, use, cap):
    sources[aid] = open(f).read()
    capl = '<span class="chip cap">Cap on</span>' if cap == 'on' else ''
    return (f'<article class="asset"><div class="stage"><img src="{d(f)}" alt="" loading="lazy"></div>'
            f'<div class="meta"><div class="row"><code>{aid}</code>{capl}</div><h3>{html.escape(name)}</h3>'
            f'<p>{html.escape(use)}</p><button type="button" class="copy" data-id="{aid}" data-file="{f}">Copy SVG</button></div></article>')

drawn = sum(1 for _, _, a in SETS for x in a if not x[0].endswith('c'))
sets_html = ''.join(f'<section class="set"><h2><span class="letter">{L}</span>{n}</h2><div class="grid">'
                    + ''.join(card(*a) for a in items) + '</div></section>' for n, L, items in SETS)
motion_html = ''.join(
    (sources.__setitem__(mid, open(f).read()) or '') +
    f'<article class="motion{" wide" if mid=="LOAD-01" else ""}"><div class="stage"><img id="m-{i}" src="{d(f)}" alt="" data-src="{d(f)}"></div>'
    f'<div class="meta"><div class="row"><code>{mid}</code></div><h3>{name}</h3><p>{use}</p>'
    + (f'<button type="button" class="replay" data-target="m-{i}">Replay</button>' if oneshot else '')
    + f'<button type="button" class="copy" data-id="{mid}" data-file="{f}">Copy SVG</button></div></article>'
    for i, (mid, name, f, use, oneshot) in enumerate(MOTION))
pal_html = ''.join(f'<li><span class="sw" style="background:{h}"></span><span class="pn">{n}</span>'
                   f'<button type="button" class="hex" data-hex="{h}">{h}</button><span class="pr">{r}</span></li>' for n, h, r in PALETTE)
pend_html = ''.join(f'<li>{p}</li>' for p in PENDING)

page = open('catalog_template.html').read()
page = (page.replace('%%MARK%%', d('pikas-mark-master.svg')).replace('%%SETS%%', sets_html)
        .replace('%%MOTION%%', motion_html).replace('%%PALETTE%%', pal_html).replace('%%PENDING%%', pend_html)
        .replace('%%DRAWN%%', str(drawn)).replace('%%SOURCES%%', json.dumps(sources).replace('</', '<\\/')))
open('catalog/pikas-catalog.html', 'w').write(page)
print('catalog', len(page) // 1024, 'KB,', drawn, 'poses')
