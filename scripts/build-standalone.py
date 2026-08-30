# -*- coding: utf-8 -*-
"""Build the OFFLINE/artifact variant of the KobiX app from the deployed one.

The deployed site (repo root) authenticates server-side; this script
produces standalone/israel-new-homes-v2.html for use as a local file or a
private Claude artifact, where no server exists: it injects a client-side
password gate (deterrent only — suitable for a private file, stated as such)
and hides the server logout/session controls.

Usage: python3 scripts/build-standalone.py [password]
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
DST = ROOT / "standalone" / "israel-new-homes-v2.html"
PASSWORD = sys.argv[1] if len(sys.argv) > 1 else "test4321"

s = SRC.read_text(encoding="utf-8")
# the Artifact host supplies doctype/html/head/body — strip the deploy skeleton
s = "\n".join(ln for ln in s.split("\n") if "<!-- doc-skeleton -->" not in ln)

GATE_CSS = """
/* ============================ offline access gate ============================ */
body:not(.unlocked){overflow:hidden}
body:not(.unlocked)>*:not(#gate){visibility:hidden}
#gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--paper);padding:24px}
#gate.hide{display:none}
.gate-card{width:100%;max-width:372px;background:var(--panel);border:1px solid var(--edge);
  border-radius:16px;padding:0 0 24px;overflow:hidden;box-shadow:var(--shadow-pop);text-align:center}
.gate-rib{height:3px;background:linear-gradient(to left,var(--accent-deep),var(--accent) 55%,var(--gold))}
.gate-in{padding:26px 26px 0;display:flex;flex-direction:column;gap:5px}
.gate-mark{display:flex;align-items:center;justify-content:center;gap:9px;direction:ltr}
.gate-mark .globe{width:30px;height:30px}
.gate-word{text-align:left;font-family:var(--f-display);line-height:1.05}
.gate-word b{font-size:19px;font-weight:800;display:block}
.gate-word span{font-size:8px;font-weight:700;letter-spacing:.2em;color:var(--ink-3);text-transform:uppercase}
.gate-sub{font-size:12.5px;color:var(--ink-3)}
.gate-caveat{margin-top:9px;padding-top:10px;border-top:1px solid var(--hairline);
  font-size:11px;font-weight:800;letter-spacing:.07em;color:var(--brass)}
.gate-form{display:flex;flex-direction:column;gap:9px;padding:18px 26px 0}
#gatePass{height:45px;border:1px solid var(--baseline);border-radius:10px;background:var(--paper);
  padding-inline:14px;font-size:15px;text-align:center;letter-spacing:.14em;color:var(--ink);
  transition:border-color .15s,box-shadow .15s}
#gatePass:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-wash)}
.gate-btn{height:45px;border-radius:10px;background:var(--accent);color:#fff;
  font-family:var(--f-display);font-size:14.5px;font-weight:700}
.gate-btn:hover{filter:brightness(1.06)}
.gate-btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.gate-err{min-height:17px;font-size:12.5px;font-weight:700;color:var(--down);opacity:0;transition:opacity .15s}
.gate-err.on{opacity:1}
.gate-card.shake{animation:gsh .28s ease}
@keyframes gsh{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}50%{transform:translateX(5px)}75%{transform:translateX(-3px)}}
@media(prefers-reduced-motion:reduce){.gate-card.shake{animation:none}}
/* offline build: no server session — hide logout controls */
#logoutBtn,.rail a[href="/api/logout"]{display:none!important}
"""

GATE_HTML = """<div id="gate" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="gateT">
  <div class="gate-card" id="gateCard">
    <div class="gate-rib"></div>
    <div class="gate-in">
      <div class="gate-mark" aria-hidden="true"><span class="globe"></span>
        <span class="gate-word"><b>KobiX</b><span>RealEstate V1</span></span></div>
      <h2 id="gateT" style="font-size:15px;font-weight:700">מודיעין שוק הדירות החדשות</h2>
      <p class="gate-sub">הזינו סיסמה כדי להציג את הלוח</p>
      <p class="gate-caveat">לשימוש פנימי בלבד</p>
    </div>
    <form class="gate-form" id="gateForm" autocomplete="off">
      <input id="gatePass" type="password" autocomplete="off" aria-label="סיסמה" placeholder="••••••••" autofocus>
      <button type="submit" class="gate-btn">כניסה</button>
      <p class="gate-err" id="gateErr" role="alert">סיסמה שגויה</p>
    </form>
  </div>
</div>

"""

GATE_JS = """<script>
/* offline access gate (local/artifact builds only — deterrent, not security) */
(function(){
  var PASS=%r;
  var gate=document.getElementById("gate"),form=document.getElementById("gateForm"),
      pass=document.getElementById("gatePass"),err=document.getElementById("gateErr"),
      card=document.getElementById("gateCard");
  function unlock(){document.body.classList.add("unlocked");gate.classList.add("hide")}
  form.addEventListener("submit",function(e){
    e.preventDefault();
    if(pass.value.trim()===PASS){unlock();return}
    err.classList.add("on");card.classList.remove("shake");void card.offsetWidth;
    card.classList.add("shake");pass.value="";pass.focus();
  });
  pass.addEventListener("input",function(){err.classList.remove("on")});
  try{pass.focus()}catch(e){}
})();
</script>
""" % PASSWORD

assert "</style>" in s and s.count("</style>") == 1
s = s.replace("</style>", GATE_CSS + "</style>", 1)
anchor = '<header class="top">'
assert s.count(anchor) == 1
s = s.replace(anchor, GATE_HTML + anchor, 1)
s = s.rstrip() + "\n\n" + GATE_JS

DST.write_text(s, encoding="utf-8")
print("built %s (%d chars)" % (DST, len(s)))
