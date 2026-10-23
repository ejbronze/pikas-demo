"""Animated PIKAS assets: loader + starter motion set (CSS inside SVG, reduced-motion safe)."""
import re
exec(open('build_poses.py').read().split("poses = {")[0])  # parts + svg() helpers only
src = open('build_poses.py').read()
for name in ['def mirror', 'def paw_at', 'def mini_flower']:
    blk = src[src.index(name):]
    blk = blk[:blk.index('\n\n')]
    exec(blk)
ns = {}
for const in ['CLOSED_SMILE', 'WARM_EYES']:
    pass

def inner(svgtext):
    """Body of a pose SVG (defs + drawing) for embedding."""
    a = svgtext.index('<defs>'); b = svgtext.rindex('</svg>')
    return svgtext[a:b]

REDUCED = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'

# ---------- LOAD-01: collecting flowers ----------
fl = open('pikas-fnd-09-flower.svg').read()
body = inner(fl).replace('id="', 'id="ld-').replace('url(#', 'url(#ld-').replace('href="#', 'href="#ld-')

def pile_flower(cx, cy, cls):
    return (f'<g class="{cls}"><path d="M{cx} {cy+10} L{cx} {cy+26}" stroke="#0E1E4A" stroke-width="9" stroke-linecap="round"/>'
            f'<path d="M{cx} {cy+10} L{cx} {cy+26}" stroke="#3BAA6E" stroke-width="3.5" stroke-linecap="round"/>'
            f'<g stroke="#0E1E4A">{mini_flower(cx, cy, 9)}</g></g>')

LOADER = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" width="480" height="300" role="img" aria-label="PIKAS recoge flores mientras carga">
<title>PIKAS LOAD-01 — collecting flowers (v0.1)</title>
<style>
.pk{{transform-box:fill-box;transform-origin:50% 100%;animation:reach 3.6s ease-in-out infinite}}
.f1,.f2,.f3{{transform-box:fill-box;transform-origin:50% 100%}}
.f1{{animation:pop1 3.6s ease-out infinite}}
.f2{{animation:pop2 3.6s ease-out infinite}}
.f3{{animation:pop3 3.6s ease-out infinite}}
.d1{{animation:dot1 3.6s steps(1) infinite}} .d2{{animation:dot2 3.6s steps(1) infinite}} .d3{{animation:dot3 3.6s steps(1) infinite}}
@keyframes reach{{0%,100%{{transform:rotate(0)}}6%{{transform:rotate(4deg)}}14%{{transform:rotate(0)}}39%{{transform:rotate(4deg)}}47%{{transform:rotate(0)}}72%{{transform:rotate(4deg)}}80%{{transform:rotate(0)}}}}
@keyframes pop1{{0%,4%{{transform:scale(0);opacity:0}}12%{{transform:scale(1.15);opacity:1}}16%,88%{{transform:scale(1);opacity:1}}96%,100%{{transform:scale(.6);opacity:0}}}}
@keyframes pop2{{0%,37%{{transform:scale(0);opacity:0}}45%{{transform:scale(1.15);opacity:1}}49%,88%{{transform:scale(1);opacity:1}}96%,100%{{transform:scale(.6);opacity:0}}}}
@keyframes pop3{{0%,70%{{transform:scale(0);opacity:0}}78%{{transform:scale(1.15);opacity:1}}82%,88%{{transform:scale(1);opacity:1}}96%,100%{{transform:scale(.6);opacity:0}}}}
@keyframes dot1{{0%{{fill:#FFF4E0}}12%{{fill:#FFC72C}}96%{{fill:#FFF4E0}}}}
@keyframes dot2{{0%{{fill:#FFF4E0}}45%{{fill:#FFC72C}}96%{{fill:#FFF4E0}}}}
@keyframes dot3{{0%{{fill:#FFF4E0}}78%{{fill:#FFC72C}}96%{{fill:#FFF4E0}}}}
{REDUCED}
</style>
<path d="M0 262 Q240 236 480 262 V300 H0 Z" fill="#FFF4E0"/>
<path d="M0 262 Q240 236 480 262" fill="none" stroke="#0E1E4A" stroke-width="5" stroke-linecap="round"/>
<g class="pk"><g transform="translate(112 26) scale(0.57)">{body}</g></g>
<g id="haypile">
  <path d="M286 258 Q330 214 374 258 Z" fill="#3BAA6E" stroke="#0E1E4A" stroke-width="5" stroke-linejoin="round"/>
  <path d="M306 246 L312 232 M330 240 L330 224 M352 246 L346 232" stroke="#0E1E4A" stroke-width="4" stroke-linecap="round"/>
  {pile_flower(306, 206, 'f1')}{pile_flower(330, 192, 'f2')}{pile_flower(354, 206, 'f3')}
</g>
<g stroke="#0E1E4A" stroke-width="3"><circle class="d1" cx="314" cy="282" r="6" fill="#FFC72C"/><circle class="d2" cx="330" cy="282" r="6" fill="#FFC72C"/><circle class="d3" cx="346" cy="282" r="6" fill="#FFC72C"/></g>
</svg>
'''
open('pikas-load-01-collecting.svg', 'w').write(LOADER)
print('loader ok')

# ---------- starter motion set ----------
def animate(src_file, out_file, css, title):
    s = open(src_file).read()
    s = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', s)
    s = s.replace('<defs>', f'<style>{css}{REDUCED}</style><defs>', 1)
    open(out_file, 'w').write(s)
    print(out_file, 'ok')

animate('pikas-fnd-01-neutral.svg', 'pikas-fnd-01-neutral-blink.svg',
        '#eyes{transform-box:fill-box;transform-origin:50% 55%;animation:blink 5.5s infinite}'
        '@keyframes blink{0%,94%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}',
        'PIKAS FND-01 — idle blink (loop)')
animate('pikas-fnd-03-wave.svg', 'pikas-fnd-03-wave-anim.svg',
        '#arm-r-raised{transform-box:view-box;transform-origin:232px 246px;animation:wave .9s ease-in-out 2}'
        '@keyframes wave{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(8deg)}}',
        'PIKAS FND-03 — wave (one-shot, 2 swings)')
animate('pikas-emp-02-empty-box.svg', 'pikas-emp-02-empty-box-bounce.svg',
        'svg>g{animation:bounce .45s cubic-bezier(.2,.8,.2,1) both}'
        '@keyframes bounce{0%{transform:translateY(12px);opacity:0}100%{transform:none;opacity:1}}',
        'PIKAS EMP-02 — bounce-in (one-shot)')
animate('pikas-suc-01-done.svg', 'pikas-suc-01-done-pop.svg',
        '#check-badge{transform-box:fill-box;transform-origin:50% 50%;animation:pop .35s cubic-bezier(.2,.8,.2,1) both}'
        '#check-badge path{stroke-dasharray:60;stroke-dashoffset:60;animation:draw .3s .2s ease-out forwards}'
        '@keyframes pop{0%{transform:scale(.9);opacity:0}100%{transform:none;opacity:1}}'
        '@keyframes draw{to{stroke-dashoffset:0}}'
        '@media (prefers-reduced-motion: reduce){#check-badge path{stroke-dashoffset:0}}',
        'PIKAS SUC-01 — success pop (one-shot)')

animate('pikas-att-01-worried.svg', 'pikas-att-01-worried-countdown.svg',
        '#sand-top{transform-box:fill-box;transform-origin:50% 100%;animation:drain var(--countdown,8s) linear var(--countdown-repeat,infinite) forwards}'
        '#sand-bottom{transform-box:fill-box;transform-origin:50% 100%;animation:fill var(--countdown,8s) linear var(--countdown-repeat,infinite) forwards}'
        '#sand-stream{animation:stream var(--countdown,8s) steps(1) var(--countdown-repeat,infinite) forwards}'
        '#eyes{animation:glance 4s ease-in-out infinite}'
        '@keyframes drain{0%{transform:scale(1)}100%{transform:scale(0)}}'
        '@keyframes fill{0%{transform:scale(.15)}100%{transform:scale(1)}}'
        '@keyframes stream{0%{opacity:1}99%{opacity:1}100%{opacity:0}}'
        '@keyframes glance{0%,40%,100%{transform:translate(0,0)}50%,80%{transform:translate(-3px,6px)}}'
        '@media (prefers-reduced-motion: reduce){#sand-top{transform:scale(.3)}}',
        'PIKAS ATT-01 — session countdown, worried (loop; set --countdown to the time left)')

# ---------- WALK-01: walk cycle (three-quarter, facing right) ----------
animate('pikas-fnd-02-three-quarter.svg', 'pikas-walk-01.svg',
        '#foot-near{transform-box:fill-box;transform-origin:50% 100%;animation:stepA .64s ease-in-out infinite}'
        '#foot-far{transform-box:fill-box;transform-origin:50% 100%;animation:stepB .64s ease-in-out infinite}'
        '#arm-l{transform-box:view-box;transform-origin:96px 236px;animation:swing .64s ease-in-out infinite}'
        'svg>g{animation:bob .32s ease-in-out infinite alternate}'
        '@keyframes stepA{0%,100%{transform:translate(-10px,0)}25%{transform:translate(0,-9px)}50%{transform:translate(10px,0)}75%{transform:translate(0,0)}}'
        '@keyframes stepB{0%,100%{transform:translate(8px,0)}25%{transform:translate(0,0)}50%{transform:translate(-8px,0)}75%{transform:translate(0,-8px)}}'
        '@keyframes swing{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}'
        '@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-4px)}}',
        'PIKAS WALK-01 — walk cycle, three-quarter facing right (loop, 0.64 s)')
