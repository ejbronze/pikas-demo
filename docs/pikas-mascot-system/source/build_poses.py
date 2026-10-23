"""Compose PIKAS pose SVGs from the approved FND-01 parts."""
import re
import cairosvg

base = open('pikas-fnd-01-neutral.svg').read()

def grab(gid):
    i = base.index(f'<g id="{gid}"')
    depth, j = 0, i
    while True:
        o = base.find('<g', j + 1); c = base.find('</g>', j + 1)
        if o != -1 and o < c:
            depth += 1; j = o
        else:
            if depth == 0:
                return base[i:c + 4]
            depth -= 1; j = c

DEFS = base[base.index('<defs>'):base.index('</defs>') + 7]
P = {k: grab(k) for k in ['feet', 'body', 'arm-l', 'arm-r', 'ear-l', 'ear-r', 'tufts', 'head', 'whiskers', 'eyes', 'nose', 'mouth-g']}

CLOSED_SMILE = ('<g id="mouth-g"><path d="M160 138 L160 148" stroke-width="6"/>'
                '<path d="M128 142 Q144 162 160 148 Q176 162 192 142" fill="none" stroke-width="6"/></g>')
WARM_EYES = ('<g id="eyes" fill="none" stroke-width="7">'
             '<path d="M106 116 Q118 100 130 116"/><path d="M190 116 Q202 100 214 116"/></g>')

# viewer's-left arm bent up to chest, open at the shoulder
ARM_BENT = ('<g id="arm-l-bent"><path d="M90 232 C74 252 80 280 104 284 L122 268 C110 262 106 248 110 236 Z" '
            'fill="#FFC72C" stroke="none"/><path d="M90 232 C74 252 80 280 104 284" fill="none"/></g>')
PAW = ('<g id="paw"><path d="M98 262 C96 240 122 230 140 242 C158 254 154 282 134 290 C114 297 100 282 98 262 Z" '
       'fill="#FFC72C"/><path d="M127 247 Q141 249 142 262" fill="none" stroke-width="6"/></g>')
CARD = ('<g id="card" transform="rotate(-14 192 244)">'
        '<rect x="130" y="214" width="132" height="86" rx="13" fill="#16C2C7"/>'
        '<rect x="152" y="246" width="22" height="17" rx="4" fill="#FFC72C" stroke="none"/>'
        '<g fill="none" stroke="#FFFFFF" stroke-width="5.5"><path d="M206 246 Q212 255 206 264"/>'
        '<path d="M216 240 Q225 255 216 270"/><path d="M226 234 Q238 255 226 276"/></g></g>')

def flower(cx, cy):
    petals = ''.join(
        f'<circle cx="{cx + 19 * __import__("math").cos(a):.1f}" cy="{cy + 19 * __import__("math").sin(a):.1f}" r="15.5" fill="#FFE066"/>'
        for a in [(-90 + 72 * k) * 3.14159265 / 180 for k in range(5)])
    return (f'<g id="flower">'
            f'<path d="M140 252 Q164 250 {cx - 10} {cy + 16}" fill="none" stroke-width="13"/>'
            f'<path d="M140 252 Q164 250 {cx - 10} {cy + 16}" fill="none" stroke="#3BAA6E" stroke-width="5"/>'
            f'<ellipse cx="166" cy="240" rx="14" ry="7.5" transform="rotate(-30 166 240)" fill="#3BAA6E" stroke-width="6"/>'
            f'<g stroke-width="6">{petals}</g>'
            f'<g stroke="none">{petals}</g>'
            f'<circle cx="{cx}" cy="{cy}" r="11" fill="#E8731C" stroke-width="5"/></g>')

def svg(title, parts):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 424" width="320" height="424">\n'
            f'  <title>{title}</title>\n  {DEFS}\n'
            f'  <g stroke="#0E1E4A" stroke-width="9" stroke-linejoin="round" stroke-linecap="round">\n    '
            + '\n    '.join(parts) + '\n  </g>\n</svg>\n')

HEAD = [P['ear-l'], P['ear-r'], P['tufts'], P['head'], P['whiskers']]

poses = {
    'pikas-fin-01-card': svg('PIKAS FIN-01 — card, full figure (v0.1)',
        [P['feet'], P['body'], P['arm-r'], ARM_BENT] + HEAD + [P['eyes'], P['nose'], CLOSED_SMILE, CARD, PAW]),
    'pikas-fnd-09-flower': svg('PIKAS FND-09 — flower (v0.1)',
        [P['feet'], P['body'], P['arm-r'], ARM_BENT] + HEAD + [WARM_EYES, P['nose'], P['mouth-g'], flower(198, 218), PAW]),
}
for name, s in poses.items():
    open(f'{name}.svg', 'w').write(s)
    cairosvg.svg2png(bytestring=s.encode(), write_to=f'{name}-preview.png', output_width=480, background_color='#f4f4f4')
    print(name, 'ok')

# ---------- gorra PIKAS ----------
def mirror(p):
    toks = re.findall(r'[A-Za-z]|-?\d+\.?\d*', p); out = []; x = True
    for t in toks:
        if t.isalpha(): out.append(t); x = True; continue
        v = float(t); out.append('%g' % (320 - v if x else v)); x = not x
    return ' '.join(out)

def cap(triangle=True):
    tri = ('<path d="M160 36 L170 52 Q171 55 168 55 L152 55 Q149 55 150 52 Z" fill="#FFC72C" stroke="none"/>'
           if triangle else '')
    return ('<g id="cap">'
            '<path d="M127 60 C125 36 140 28 160 28 C180 28 195 36 193 60 Z" fill="#0E1E4A" stroke-width="7"/>'
            + tri +
            '<path d="M122 58 C142 68 178 68 198 58 C203 66 194 77 160 79 C126 77 117 66 122 58 Z" fill="#16C2C7" stroke-width="7"/>'
            '<circle cx="160" cy="27" r="5" fill="#0E1E4A" stroke="none"/></g>')

PAW_R = ('<g id="paw-r" transform="translate(40 40) scale(0.85) translate(36 38)"><path d="%s" fill="#FFC72C"/>'
         '<path d="%s" fill="none" stroke-width="6"/></g>') % (
    mirror('M98 262 C96 240 122 230 140 242 C158 254 154 282 134 290 C114 297 100 282 98 262 Z'),
    mirror('M127 247 Q141 249 142 262'))
ARM_BENT_R = ('<g id="arm-r-bent"><path d="%s" fill="#FFC72C" stroke="none"/><path d="%s" fill="none"/></g>') % (
    mirror('M90 232 C74 252 80 280 104 290 L122 290 C110 270 106 248 110 236 Z'), mirror('M90 232 C74 252 80 280 104 290'))

CLIPBOARD = ('<g id="clipboard" transform="rotate(-5 165 270)">'
             '<rect x="112" y="210" width="108" height="122" rx="10" fill="#16C2C7"/>'
             '<rect x="124" y="228" width="84" height="94" rx="5" fill="#FFFFFF" stroke-width="5"/>'
             '<rect x="146" y="203" width="40" height="18" rx="6" fill="#0E1E4A" stroke="none"/>'
             '<g stroke-width="5" fill="none">'
             '<rect x="134" y="240" width="14" height="14" rx="3"/><path d="M137 247 L141 251 L148 241" stroke="#0A7C82"/>'
             '<path d="M156 247 H198"/>'
             '<rect x="134" y="266" width="14" height="14" rx="3"/><path d="M137 273 L141 277 L148 267" stroke="#0A7C82"/>'
             '<path d="M156 273 H198"/>'
             '<rect x="134" y="292" width="14" height="14" rx="3" fill="#FFE066"/><path d="M156 299 H190"/></g></g>')

extra = {
    'pikas-onb-01-checklist': svg('PIKAS ONB-01 — checklist, cap on (v0.1)',
        [P['feet'], P['body'], ARM_BENT, ARM_BENT_R] + HEAD + [cap(), P['eyes'], P['nose'], CLOSED_SMILE, CLIPBOARD, '<g transform="translate(-12 58)">' + PAW + '</g>', PAW_R]),
}
head_parts = HEAD + [P['eyes'], P['nose'], P['mouth-g']]
def head_svg(title, with_cap, tri=True):
    s = svg(title, head_parts + ([cap(tri)] if with_cap else []))
    return s.replace('viewBox="0 0 320 424" width="320" height="424"', 'viewBox="6 4 308 216" width="308" height="216"')
extra['pikas-fnd-08-head'] = head_svg('PIKAS FND-08 — head mark (v0.1)', False)
extra['pikas-fnd-08-head-cap'] = head_svg('PIKAS FND-08 — head mark, cap (v0.1)', True)
extra['pikas-fnd-08-head-cap-small'] = head_svg('PIKAS FND-08 — head mark, cap, 32–48 px (v0.1)', True, tri=False)
cap_only = svg('gorra PIKAS', [cap()]).replace('viewBox="0 0 320 424" width="320" height="424"', 'viewBox="110 16 100 72" width="200" height="144"')
extra['pikas-cap'] = cap_only
for name, s in extra.items():
    open(f'{name}.svg', 'w').write(s)
    print(name, 'ok')

# ---------- first-pack poses, batch 2 ----------
def paw_at(cx, cy, r=19, thumb_up=False):
    t = (f'<rect x="{cx-14}" y="{cy-r-24}" width="20" height="38" rx="10" transform="rotate(-12 {cx-4} {cy-r})" fill="#FFC72C"/>' if thumb_up else
         f'<path d="M{cx-8} {cy-r+8} Q{cx+4} {cy-r+8} {cx+6} {cy-2}" fill="none" stroke-width="6"/>')
    body = f'<ellipse cx="{cx}" cy="{cy}" rx="{r+2}" ry="{r}" fill="#FFC72C"/>'
    return '<g>' + (t + body if thumb_up else body + t) + '</g>'

def raised_arm(side='r'):
    fill = 'M226 230 C248 226 266 214 276 200 L296 214 C284 236 260 252 234 258 Z'
    line = 'M234 258 C260 252 284 236 296 214'
    if side == 'l': fill, line = mirror(fill), mirror(line)
    cx = 288 if side == 'r' else 32
    return (f'<g id="arm-{side}-raised"><path d="{fill}" fill="#FFC72C" stroke="none"/>'
            f'<path d="{line}" fill="none"/>{paw_at(cx, 200)}</g>')

POINT_ARM = ('<g id="arm-r-point"><path d="M224 230 C250 236 276 240 294 242 L294 280 C272 278 250 274 228 268 Z" '
             'fill="#FFC72C" stroke="none"/><path d="M228 268 C250 274 272 278 294 280" fill="none"/>'
             '<ellipse cx="306" cy="261" rx="22" ry="21" fill="#FFC72C"/>'
             '<path d="M298 246 Q314 244 320 256" fill="none" stroke-width="6"/></g>')
LOOK_RIGHT = P['eyes'].replace('cx="118"', 'cx="122"').replace('cx="202"', 'cx="206"') \
                      .replace('cx="114.5"', 'cx="119.5"').replace('cx="198.5"', 'cx="203.5"')

def petal(x, y, a):
    return f'<ellipse cx="{x}" cy="{y}" rx="13" ry="8" transform="rotate({a} {x} {y})" fill="#FFE066" stroke-width="4"/>'
PETALS = '<g id="petals">' + ''.join(petal(*p) for p in
    [(30, 34, 20), (300, 30, -30), (24, 120, 60), (312, 112, -10), (134, 16, 40), (204, 16, -50)]) + '</g>'

BOX = ('<g id="box">'
       '<path d="M108 270 L124 248 L196 248 L212 270 Z" fill="#0E1E4A"/>'
       '<path d="M108 270 L84 252 L100 236 L124 248 Z" fill="#FFF4E0" stroke-width="6"/>'
       '<path d="M212 270 L236 252 L220 236 L196 248 Z" fill="#FFF4E0" stroke-width="6"/>'
       '<rect x="108" y="270" width="104" height="78" rx="6" fill="#16C2C7"/>'
       '<path d="M140 300 H180" stroke="#FFFFFF" stroke-width="5"/></g>')

GOGGLES = ('<g id="goggles">'
           '<path d="M60 84 C100 66 220 66 260 84" fill="none" stroke-width="10"/>'
           '<circle cx="136" cy="76" r="16" fill="#16C2C7" stroke-width="7"/><circle cx="184" cy="76" r="16" fill="#16C2C7" stroke-width="7"/>'
           '<circle cx="131" cy="71" r="4" fill="#FFFFFF" stroke="none"/><circle cx="179" cy="71" r="4" fill="#FFFFFF" stroke="none"/>'
           '<path d="M152 76 H168" stroke-width="6"/></g>')
DEMO_BADGE = ('<g id="demo-badge">'
              '<rect x="184" y="350" width="136" height="40" rx="12" fill="#0E1E4A" stroke="#FFF4E0" stroke-width="4"/>'
              '<path d="M200 380 L210 362 L220 380 Z" fill="#FFC72C" stroke="none"/>'
              '<text x="230" y="378" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="20" '
              'fill="#FFFFFF" stroke="none">DEMO</text></g>')

batch2 = {
    'pikas-fnd-03-wave': [P['feet'], P['body'], P['arm-l'], raised_arm('r')] + HEAD + [P['eyes'], P['nose'], P['mouth-g']],
    'pikas-fnd-04-point-right': [P['feet'], P['body'], P['arm-l'], POINT_ARM] + HEAD + [LOOK_RIGHT, P['nose'], CLOSED_SMILE],

    'pikas-suc-02-celebrate': [PETALS, P['feet'], P['body'], raised_arm('l'), raised_arm('r')] + HEAD + [WARM_EYES, P['nose'], P['mouth-g']],
    'pikas-emp-02-empty-box': [P['feet'], P['body'], ARM_BENT, ARM_BENT_R] + HEAD + [P['eyes'], P['nose'], CLOSED_SMILE, BOX, paw_at(106, 306), paw_at(214, 306)],
    'pikas-dem-01-demo': [P['feet'], P['body'], P['arm-l'], P['arm-r']] + HEAD + [GOGGLES, P['eyes'], P['nose'], P['mouth-g'], DEMO_BADGE],
}
for name, parts in batch2.items():
    s = svg(f'PIKAS {name[6:].upper()} (v0.1)', parts).replace('viewBox="0 0 320 424" width="320" height="424"',
                                                            'viewBox="0 0 336 424" width="336" height="424"')
    open(f'{name}.svg', 'w').write(s)
    print(name, 'ok')

# ---------- SUC-01 v0.3: check badge instead of a thumb gesture ----------
CHECK_BADGE = ('<g id="check-badge">'
               '<circle cx="214" cy="258" r="38" fill="#16C2C7"/>'
               '<path d="M196 259 L210 273 L234 244" fill="none" stroke="#FFFFFF" stroke-width="8"/></g>')
s = svg('PIKAS SUC-01 — done, check badge (v0.3)',
        [P['feet'], P['body'], P['arm-l'], ARM_BENT_R] + HEAD + [WARM_EYES, P['nose'], P['mouth-g'], CHECK_BADGE, paw_at(210, 302)])
open('pikas-suc-01-done.svg', 'w').write(s)
print('suc-01 v0.3 ok')

# ---------- batch 3: three-quarter, Cafetería, POS ----------
def shift(markup, dx):
    return f'<g transform="translate({dx} 0)">{markup}</g>'

# three-quarter: features slide toward the turn, far ear smaller and tucked, far whiskers shorter
TQ_EAR_FAR = ('<g id="ear-r-far"><circle cx="236" cy="64" r="42" fill="#0E1E4A" stroke="none"/>'
              '<circle cx="239" cy="60" r="29" fill="#FFF4E0" stroke="none"/></g>')
TQ_WHISKERS = ('<g id="whiskers" stroke-width="6">'
               '<path d="M26 128 L84 136"/><path d="M20 148 L82 148"/><path d="M28 168 L84 158"/>'
               '<path d="M300 126 L262 134"/><path d="M304 146 L264 146"/><path d="M298 164 L262 156"/></g>')
TQ_EYES = ('<g id="eyes" stroke="none">'
           '<ellipse cx="134" cy="112" rx="10.5" ry="13" fill="#0E1E4A"/><circle cx="131" cy="106.5" r="3.6" fill="#FFFFFF"/>'
           '<ellipse cx="212" cy="112" rx="9.5" ry="12.5" fill="#0E1E4A"/><circle cx="209.5" cy="106.5" r="3.4" fill="#FFFFFF"/></g>')
TQ_HEAD = TQ_EAR_FAR + P['ear-l'] + P['tufts'] + P['head'].replace(
    'fill="#FFF4E0" d="M98 156', 'fill="#FFF4E0" transform="translate(16 0)" d="M98 156')
TQ_FACE = shift(P['nose'] + CLOSED_SMILE, 16)
TQ_BODY = P['body'].replace('cx="160" cy="312"', 'cx="172" cy="312"')

# cafetería props
TRAY = ('<g id="tray">'
        '<path d="M76 262 L244 262 L232 284 L88 284 Z" fill="#16C2C7"/>'
        '<ellipse cx="136" cy="256" rx="36" ry="11" fill="#FFF4E0" stroke-width="6"/>'
        '<circle cx="128" cy="251" r="9" fill="#E8731C" stroke-width="5"/><ellipse cx="146" cy="252" rx="9" ry="5" fill="#3BAA6E" stroke-width="5"/>'
        '<rect x="188" y="222" width="28" height="36" rx="5" fill="#FFF4E0" stroke-width="6"/>'
        '<rect x="191" y="234" width="22" height="20" rx="3" fill="#E8731C" stroke="none"/>'
        '<path d="M206 222 L214 202" stroke-width="5"/></g>')
COUNTER = ('<g id="caja">'
           '<rect x="176" y="248" width="92" height="56" rx="8" fill="#0E1E4A"/>'
           '<rect x="188" y="258" width="68" height="20" rx="4" fill="#FFF4E0" stroke="none"/>'
           '<g fill="#16C2C7" stroke="none"><rect x="190" y="284" width="14" height="10" rx="2"/><rect x="214" y="284" width="14" height="10" rx="2"/><rect x="238" y="284" width="14" height="10" rx="2"/></g>'
           '<rect x="24" y="304" width="288" height="120" rx="14" fill="#16C2C7"/>'
           '<path d="M24 330 H312" stroke-width="6"/></g>')
APRON = ('<g id="apron">'
         '<path d="M118 228 L202 228 L214 360 Q160 376 106 360 Z" fill="#16C2C7"/>'
         '<path d="M126 230 Q160 196 194 230" fill="none" stroke-width="6"/>'
         '<rect x="170" y="252" width="34" height="44" rx="6" fill="#FFFFFF" stroke-width="5"/>'
         '<circle cx="187" cy="266" r="7" fill="#FFC72C" stroke-width="4"/><path d="M178 284 H196" stroke-width="4"/>'
         '<path d="M187 244 L187 252" stroke-width="4"/></g>')

NEUTRAL_MOUTH = '<g id="mouth-g"><path d="M160 138 L160 148" stroke-width="6"/><path d="M146 152 Q160 158 174 152" fill="none" stroke-width="6"/></g>'
def small_badge(kind):
    if kind == 'check':
        return ('<g id="badge"><circle cx="258" cy="176" r="36" fill="#16C2C7" stroke-width="8"/>'
                '<path d="M242 177 L254 190 L276 164" fill="none" stroke="#FFFFFF" stroke-width="7"/></g>')
    return ('<g id="badge"><circle cx="258" cy="176" r="36" fill="#F5A524" stroke-width="8"/>'
            '<path d="M258 156 V180" stroke-width="8"/><circle cx="258" cy="195" r="5.5" fill="#0E1E4A" stroke="none"/></g>')

def head_crop(s): return s.replace('viewBox="0 0 320 424" width="320" height="424"', 'viewBox="6 4 308 216" width="308" height="216"')

batch3 = {
    'pikas-fnd-02-three-quarter': svg('PIKAS FND-02 — three-quarter (v0.1)',
        [P['feet'], TQ_BODY, P['arm-l'], P['arm-r'], TQ_HEAD, TQ_WHISKERS, TQ_EYES, TQ_FACE]),
    'pikas-caf-01-tray': svg('PIKAS CAF-01 — tray, cap on (v0.1)',
        [P['feet'], P['body'], ARM_BENT, ARM_BENT_R] + HEAD + [cap(), P['eyes'], P['nose'], P['mouth-g'], TRAY,
         paw_at(86, 276), paw_at(234, 276)]),
    'pikas-caf-02-caja': svg('PIKAS CAF-02 — caja, cap on (v0.1)',
        [P['body'], P['arm-l'], ARM_BENT_R] + HEAD + [cap(), P['eyes'], P['nose'], CLOSED_SMILE, COUNTER, paw_at(206, 300)]),
    'pikas-caf-03-staff': svg('PIKAS CAF-03 — staff, apron + badge, cap on (v0.1)',
        [P['feet'], P['body'], APRON, P['arm-l'], P['arm-r']] + HEAD + [cap(), P['eyes'], P['nose'], CLOSED_SMILE]),
    'pikas-pos-01-ready': head_crop(svg('PIKAS POS-01 — ready, compact (v0.1)', HEAD + [cap(False), P['eyes'], P['nose'], CLOSED_SMILE])),
    'pikas-pos-02-sale-complete': head_crop(svg('PIKAS POS-02 — sale complete, compact (v0.1)',
        HEAD + [cap(False), WARM_EYES, P['nose'], P['mouth-g'], small_badge('check')])),
    'pikas-pos-03-offline': head_crop(svg('PIKAS POS-03 — offline, compact (v0.1)',
        HEAD + [cap(False), P['eyes'], P['nose'], NEUTRAL_MOUTH, small_badge('alert')])),
}
for name, s in batch3.items():
    open(f'{name}.svg', 'w').write(s); print(name, 'ok')

# ---------- FND-02 v0.2: body turns with the head ----------
TQ_BODY_SHAPE = 'M104 196 C74 220 58 268 60 318 C62 370 100 394 162 394 C214 394 248 368 250 318 C250 270 236 220 214 196 Z'
TQ_BODY2 = (f'<g id="body"><path d="{TQ_BODY_SHAPE}" fill="#FFC72C"/>'
            f'<clipPath id="tq-body"><path d="{TQ_BODY_SHAPE}"/></clipPath>'
            f'<ellipse clip-path="url(#tq-body)" cx="180" cy="312" rx="54" ry="70" fill="#FFF4E0" stroke="none"/>'
            f'<path d="{TQ_BODY_SHAPE}" fill="none"/></g>')
TQ_FAR_FOOT = '<g id="foot-far"><ellipse cx="204" cy="392" rx="27" ry="13" fill="#FFC72C"/></g>'
TQ_NEAR_FOOT = '<g id="foot-near"><ellipse cx="124" cy="399" rx="34" ry="15" fill="#FFC72C"/></g>'
TQ_FAR_ARM = ('<g id="arm-far" transform="translate(-8 4)"><path d="M228 236 C246 258 252 292 246 314 C240 332 218 330 214 312 Z" '
              'fill="#FFC72C"/></g>')
s = svg('PIKAS FND-02 — three-quarter (v0.2)',
        [TQ_FAR_FOOT, TQ_FAR_ARM, TQ_NEAR_FOOT, TQ_BODY2, P['arm-l'], TQ_HEAD, TQ_WHISKERS, TQ_EYES, TQ_FACE])
open('pikas-fnd-02-three-quarter.svg', 'w').write(s)
print('fnd-02 v0.2 ok')

# ---------- batch 4: wallet + purse ----------
def mini_flower(cx, cy, r=5):
    import math
    pts = ''.join(f'<circle cx="{cx + r * 1.2 * math.cos(a):.1f}" cy="{cy + r * 1.2 * math.sin(a):.1f}" r="{r}" fill="#FFE066"/>'
                  for a in [(-90 + 72 * k) * math.pi / 180 for k in range(5)])
    return f'<g><g stroke-width="3">{pts}</g><g stroke="none">{pts}</g><circle cx="{cx}" cy="{cy}" r="{r*0.7:.1f}" fill="#E8731C" stroke-width="2.5"/></g>'

WALLET = ('<g id="wallet">'
          '<rect x="146" y="222" width="58" height="34" rx="5" fill="#16C2C7" stroke-width="6"/>'
          '<rect x="158" y="232" width="14" height="10" rx="2" fill="#FFC72C" stroke="none"/>'
          '<rect x="128" y="240" width="96" height="64" rx="11" fill="#0E1E4A"/>'
          '<path d="M136 262 H216" stroke="#2A3F7A" stroke-width="4"/>'
          '<path d="M196 270 L206 286 L186 286 Z" fill="#FFC72C" stroke="none"/></g>')
PURSE = ('<g id="purse">'
         '<path d="M200 262 C214 226 238 232 226 266" fill="none" stroke-width="6"/>'
         '<path d="M124 274 Q168 246 212 274 Q218 334 168 336 Q118 334 124 274 Z" fill="#16C2C7"/>'
         '<path d="M124 274 Q168 246 212 274" fill="none" stroke-width="9"/>'
         '<circle cx="162" cy="250" r="8" fill="#0E1E4A" stroke="none"/><circle cx="176" cy="250" r="8" fill="#0E1E4A" stroke="none"/>'
         + mini_flower(168, 304, 7) + '</g>')

batch4 = {
    'pikas-fin-04-wallet': svg('PIKAS FIN-04 — wallet (v0.1)',
        [P['feet'], P['body'], P['arm-r'], ARM_BENT] + HEAD + [P['eyes'], P['nose'], CLOSED_SMILE, WALLET, PAW]),
}
for name, s in batch4.items():
    open(f'{name}.svg', 'w').write(s); print(name, 'ok')

# ---------- batch 5: purse options + session-timeout faces ----------
POUCH = ('<g id="pouch">'
         '<path d="M196 274 C210 244 236 244 226 270" fill="none" stroke-width="6"/>'
         '<path d="M146 278 Q146 254 158 262 Q164 246 172 260 Q182 248 188 262 Q194 258 190 278 Z" fill="#16C2C7" stroke-width="6"/>'
         '<path d="M124 284 Q114 340 168 342 Q222 340 212 284 Q192 272 168 274 Q144 272 124 284 Z" fill="#16C2C7"/>'
         '<path d="M140 276 Q168 286 196 276" fill="none" stroke-width="7"/>'
         + mini_flower(168, 312, 7) + '</g>')
ZIP_PURSE = ('<g id="zip-purse">'
             '<rect x="122" y="262" width="96" height="68" rx="20" fill="#16C2C7"/>'
             '<path d="M130 282 H210" stroke-width="5"/>'
             '<path d="M136 278 V286 M146 278 V286 M156 278 V286 M166 278 V286 M176 278 V286 M186 278 V286 M196 278 V286" stroke-width="3"/>'
             '<rect x="200" y="276" width="14" height="22" rx="5" fill="#FFC72C" stroke-width="4"/>'
             + mini_flower(156, 308, 7) + '</g>')

HOURGLASS = ('<g id="hourglass">'
             '<path d="M134 236 L170 236 L154 266 L170 296 L134 296 L150 266 Z" fill="#16C2C7" stroke-width="6"/>'
             '<path id="sand-bottom" d="M140 290 L164 290 L152 274 Z" fill="#FFC72C" stroke="none"/><path id="sand-stream" d="M152 257 V289" stroke="#FFC72C" stroke-width="2.5"/>'
             '<path id="sand-top" d="M144 244 L160 244 L152 256 Z" fill="#FFC72C" stroke="none"/>'
             '<rect x="126" y="226" width="52" height="12" rx="5" fill="#0E1E4A"/>'
             '<rect x="126" y="294" width="52" height="12" rx="5" fill="#0E1E4A"/></g>')
WORRIED_EYES = ('<g id="eyes" stroke="none">'
                '<ellipse cx="121" cy="110" rx="10.5" ry="13" fill="#0E1E4A"/><circle cx="118" cy="104" r="3.6" fill="#FFFFFF"/>'
                '<ellipse cx="205" cy="110" rx="10.5" ry="13" fill="#0E1E4A"/><circle cx="202" cy="104" r="3.6" fill="#FFFFFF"/></g>'
                '<g fill="none" stroke-width="5"><path d="M104 88 Q114 82 128 86"/><path d="M192 86 Q206 82 216 88"/></g>')
WOBBLE_MOUTH = ('<g id="mouth-g"><path d="M160 138 L160 148" stroke-width="6"/>'
                '<path d="M144 156 Q152 149 160 156 Q168 163 176 156" fill="none" stroke-width="6"/></g>')
BORED_EYES = ('<g id="eyes">'
              '<ellipse cx="118" cy="114" rx="10.5" ry="11" fill="#0E1E4A" stroke="none"/>'
              '<ellipse cx="202" cy="114" rx="10.5" ry="11" fill="#0E1E4A" stroke="none"/>'
              '<rect x="104" y="98" width="28" height="15" fill="#FFC72C" stroke="none"/>'
              '<rect x="188" y="98" width="28" height="15" fill="#FFC72C" stroke="none"/>'
              '<path d="M105 113 H131 M189 113 H215" stroke-width="6"/></g>')
FLAT_MOUTH = '<g id="mouth-g"><path d="M160 138 L160 148" stroke-width="6"/><path d="M147 156 H173" stroke-width="6"/></g>'
CHIN_ARM = ('<g id="arm-r-chin"><path d="M232 236 C248 226 236 212 214 218 L200 236 C212 240 218 242 214 252 Z" fill="#FFC72C" stroke="none"/>'
            '<path d="M232 236 C248 226 236 212 214 218" fill="none"/></g>')

batch5 = {
    'pikas-fin-05-purse': svg('PIKAS FIN-05 — coin purse (v1)',
        [P['feet'], P['body'], P['arm-r'], ARM_BENT] + HEAD + [P['eyes'], P['nose'], P['mouth-g'], ZIP_PURSE,
         '<g transform="translate(-6 58)">' + PAW + '</g>']),
    'pikas-att-01-worried': svg('PIKAS ATT-01 — session ending, worried (v0.1)',
        [P['feet'], P['body'], P['arm-r'], ARM_BENT] + HEAD + [WORRIED_EYES, P['nose'], WOBBLE_MOUTH, '<g transform="translate(24 0)">' + HOURGLASS + '</g>',
         '<g transform="translate(-14 46)">' + PAW + '</g>']),
    'pikas-att-02-bored': svg('PIKAS ATT-02 — idle too long, bored (v0.1)',
        [P['feet'], P['body'], P['arm-l']] + HEAD + [BORED_EYES, P['nose'], FLAT_MOUTH, CHIN_ARM, paw_at(196, 222, r=18)]),
}
for name, s in batch5.items():
    open(f'{name}.svg', 'w').write(s); print(name, 'ok')

# ---------- batch 6: the remaining catalog poses ----------
def eyes_dx(dx, dy=0):
    return (P['eyes'].replace('cx="118" cy="112"', f'cx="{118+dx}" cy="{112+dy}"').replace('cx="202" cy="112"', f'cx="{202+dx}" cy="{112+dy}"')
            .replace('cx="114.5" cy="106.5"', f'cx="{114.5+dx}" cy="{106.5+dy}"').replace('cx="198.5" cy="106.5"', f'cx="{198.5+dx}" cy="{106.5+dy}"'))

def mirror_g(markup):
    return f'<g transform="translate(320 0) scale(-1 1)">{markup}</g>'

OPEN_PAW_R = ('<g id="arm-r-present"><path d="M224 232 C248 244 268 262 280 280 L262 300 C250 284 236 272 222 266 Z" fill="#FFC72C" stroke="none"/>'
              '<path d="M222 266 C236 272 250 284 262 300" fill="none"/>'
              '<path d="M224 232 C248 244 268 262 280 280" fill="none"/>'
              '<ellipse cx="282" cy="292" rx="26" ry="13" transform="rotate(-20 282 292)" fill="#FFC72C"/>'
              '<path d="M266 286 Q282 280 296 284" fill="none" stroke-width="5"/></g>')
SMALL_MOUTH = '<g id="mouth-g"><path d="M160 138 L160 147" stroke-width="6"/><ellipse cx="160" cy="156" rx="6" ry="7" fill="#0E1E4A" stroke="none"/></g>'

CLIPBOARD_DONE = CLIPBOARD.replace(
    '<rect x="134" y="292" width="14" height="14" rx="3" fill="#FFE066"/>',
    '<rect x="134" y="292" width="14" height="14" rx="3"/><path d="M137 299 L141 303 L148 293" stroke="#0A7C82"/>')

MAP = ('<g id="map">'
       '<path d="M96 248 L134 240 L172 250 L212 240 L246 248 L246 318 L212 310 L172 320 L134 310 L96 318 Z" fill="#FFF4E0"/>'
       '<path d="M134 240 V310 M172 250 V320 M212 240 V310" stroke-width="4"/>'
       '<path d="M112 296 C130 268 160 300 186 276 S226 262 232 268" fill="none" stroke="#0A7C82" stroke-width="5" stroke-dasharray="2 9"/>'
       '<path d="M228 254 C228 244 242 244 242 254 C242 262 235 270 235 270 C235 270 228 262 228 254 Z" fill="#FFC72C" stroke-width="4"/></g>')

WALK_FEET = ('<g id="feet-walk" fill="#FFC72C">'
             '<ellipse cx="114" cy="400" rx="32" ry="15"/>'
             '<ellipse cx="210" cy="392" rx="30" ry="14" transform="rotate(-12 210 392)"/></g>')

RECEIPT = ('<g id="receipt">'
           '<path d="M132 226 H202 V318 L193 310 L184 318 L175 310 L166 318 L157 310 L148 318 L139 310 L132 318 Z" fill="#FFFFFF"/>'
           '<path d="M144 244 H190 M144 260 H182 M144 276 H190" stroke-width="4"/>'
           '<path d="M144 294 H170" stroke="#0A7C82" stroke-width="5"/></g>')

BANK = ('<g id="bank">'
        '<path d="M206 232 C230 214 254 208 270 214" fill="none" stroke-width="6" stroke-dasharray="1 10"/>'
        '<path d="M262 206 L276 214 L262 224" fill="none" stroke-width="6"/>'
        '<path d="M262 236 L298 220 L334 236 Z" fill="#16C2C7"/>'
        '<rect x="264" y="238" width="68" height="44" fill="#FFF4E0"/>'
        '<path d="M278 244 V276 M298 244 V276 M318 244 V276" stroke-width="6"/>'
        '<rect x="258" y="282" width="80" height="10" rx="3" fill="#0E1E4A"/></g>')
CARD_SMALL = ('<g id="card" transform="rotate(-14 166 262)">'
              '<rect x="126" y="236" width="86" height="56" rx="10" fill="#16C2C7"/>'
              '<rect x="140" y="256" width="15" height="12" rx="3" fill="#FFC72C" stroke="none"/></g>')

HEADSET = ('<g id="headset">'
           '<path d="M46 124 C36 -4 284 -4 274 124" fill="none" stroke-width="10"/>'
           '<rect x="36" y="110" width="26" height="40" rx="11" fill="#16C2C7"/>'
           '<rect x="258" y="110" width="26" height="40" rx="11" fill="#16C2C7"/>'
           '<path d="M50 150 C56 178 90 188 116 180" fill="none" stroke-width="6"/>'
           '<circle cx="120" cy="179" r="8" fill="#0E1E4A" stroke="none"/></g>')

MAGNIFIER = ('<g id="magnifier">'
             '<path d="M232 300 L262 330" stroke-width="14"/>'
             '<path d="M232 300 L262 330" stroke="#16C2C7" stroke-width="5"/>'
             '<circle cx="212" cy="276" r="32" fill="#E6F7F7" stroke-width="9"/>'
             '<path d="M196 262 Q204 252 216 252" fill="none" stroke="#FFFFFF" stroke-width="5"/></g>')

ALERT_BADGE = ('<g id="alert-badge"><circle cx="300" cy="206" r="26" fill="#F5A524" stroke-width="7"/>'
               '<path d="M300 192 V210" stroke-width="7"/><circle cx="300" cy="221" r="4.5" fill="#0E1E4A" stroke="none"/></g>')

TRAY_EMPTY = ('<g id="tray"><path d="M76 262 L244 262 L232 284 L88 284 Z" fill="#16C2C7"/></g>')

W336 = lambda s: s.replace('viewBox="0 0 320 424" width="320" height="424"', 'viewBox="0 0 340 424" width="340" height="424"')
L336 = lambda s: s.replace('viewBox="0 0 320 424" width="320" height="424"', 'viewBox="-20 0 340 424" width="340" height="424"')

batch6 = {
    'pikas-fnd-05-point-left': L336(svg('PIKAS FND-05 — point left (v0.1)',
        [P['feet'], P['body'], P['arm-r'], mirror_g(POINT_ARM)] + HEAD + [eyes_dx(-4), P['nose'], CLOSED_SMILE])),
    'pikas-fnd-06-present': W336(svg('PIKAS FND-06 — present (v0.1)',
        [P['feet'], P['body'], P['arm-l'], OPEN_PAW_R] + HEAD + [WARM_EYES, P['nose'], P['mouth-g']])),
    'pikas-fnd-07-think': svg('PIKAS FND-07 — think (v0.1)',
        [P['feet'], P['body'], P['arm-l']] + HEAD + [eyes_dx(4, -5), P['nose'], SMALL_MOUTH, CHIN_ARM, paw_at(196, 222, r=18)]),
    'pikas-suc-03-checklist-done': svg('PIKAS SUC-03 — checklist done (v0.1)',
        [P['feet'], P['body'], ARM_BENT, ARM_BENT_R] + HEAD + [WARM_EYES, P['nose'], P['mouth-g'], CLIPBOARD_DONE,
         '<g transform="translate(-12 58)">' + PAW + '</g>', PAW_R]),
    'pikas-onb-02-map': svg('PIKAS ONB-02 — map, cap on (v0.1)',
        [P['feet'], P['body'], ARM_BENT, ARM_BENT_R] + HEAD + [cap(), eyes_dx(0, 4), P['nose'], CLOSED_SMILE, MAP,
         paw_at(98, 284), paw_at(244, 284)]),
    'pikas-onb-03-next-step': W336(svg('PIKAS ONB-03 — next step, cap on (v0.1)',
        [WALK_FEET, P['body'], P['arm-l'], POINT_ARM] + HEAD + [cap(), eyes_dx(4), P['nose'], P['mouth-g']])),
    'pikas-fin-02-receipt': svg('PIKAS FIN-02 — receipt review (v0.1)',
        [P['feet'], P['body'], ARM_BENT, ARM_BENT_R] + HEAD + [eyes_dx(0, 5), P['nose'], CLOSED_SMILE, RECEIPT,
         paw_at(130, 300), paw_at(204, 300)]),
    'pikas-fin-03-transfer': W336(svg('PIKAS FIN-03 — transfer (v0.1)',
        [P['feet'], P['body'], P['arm-r'], ARM_BENT] + HEAD + [eyes_dx(4), P['nose'], CLOSED_SMILE, BANK, CARD_SMALL,
         '<g transform="translate(-4 24)">' + PAW + '</g>'])),
    'pikas-sup-01-helper': W336(svg('PIKAS SUP-01 — helper, headset (v0.1)',
        [P['feet'], P['body'], P['arm-l'], OPEN_PAW_R] + [P['ear-l'], P['ear-r'], P['tufts'], P['head'], HEADSET, P['whiskers'],
                                                          P['eyes'], P['nose'], P['mouth-g']])),
    'pikas-sup-02-magnifier': svg('PIKAS SUP-02 — magnifier (v0.1)',
        [P['feet'], P['body'], P['arm-l'], ARM_BENT_R] + HEAD + [eyes_dx(4, 5), P['nose'], SMALL_MOUTH, MAGNIFIER, paw_at(262, 330, r=16)]),
    'pikas-sup-03-needs-attention': W336(svg('PIKAS SUP-03 — needs attention (v0.1)',
        [P['feet'], P['body'], P['arm-l'], POINT_ARM] + HEAD + [eyes_dx(4, -2), P['nose'], NEUTRAL_MOUTH, ALERT_BADGE])),
    'pikas-emp-01-empty-tray': svg('PIKAS EMP-01 — empty tray (v0.1)',
        [P['feet'], P['body'], ARM_BENT, ARM_BENT_R] + HEAD + [eyes_dx(0, 5), P['nose'], SMALL_MOUTH, TRAY_EMPTY,
         paw_at(86, 276), paw_at(234, 276)]),
}
for name, s in batch6.items():
    open(f'{name}.svg', 'w').write(s); print(name, 'ok')
