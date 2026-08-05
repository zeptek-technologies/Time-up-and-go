// ============================================================
// TUGWiFiPortal.h — WiFi Provisioning Portal (Captive Portal)
// ============================================================
// ใช้ร่วมกันทั้ง ESP_Chair_v2 และ ESP_Checkpoint_v2
// ⚠️  ไฟล์นี้ต้องเหมือนกันเป๊ะทั้งสองโฟลเดอร์ ถ้าแก้ที่หนึ่งต้องคัดลอกไปอีกที่
//
// สิ่งที่ไฟล์นี้ทำ:
//   • เปิด SoftAP ค้างไว้ตลอดเวลา (โหมด WIFI_AP_STA) ผู้ใช้ต่อเข้ามาตั้งค่าได้เสมอ
//     แม้บอร์ดกำลังต่อ WiFi บ้าน/โรงพยาบาลอยู่ก็ตาม
//   • DNS wildcard + redirect ทุก request → หน้าเว็บตั้งค่าเด้งเองแบบ WiFi โรงแรม
//   • จำ WiFi ที่เคยต่อได้สูงสุด 5 วง เก็บใน NVS แล้วต่อให้อัตโนมัติเมื่อบูต
//   • ทุกอย่างเป็น non-blocking — เรียก handle() ในลูปหลัก ไม่หน่วงการจับเวลา
//
// ⚠️  ข้อควรรู้เรื่อง ESP-NOW:
//     ช่อง (channel) ของ SoftAP จะวิ่งตามช่องของ Router ที่ STA ต่ออยู่เสมอ
//     ดังนั้นสองบอร์ดต้องต่อ "WiFi วงเดียวกัน" ESP-NOW จึงจะคุยกันได้
//     ถ้าบอร์ดไหนยังไม่ได้ต่อ WiFi มันจะอยู่ที่ TUG_PORTAL_FALLBACK_CH (ช่อง 1)
//     ทำให้สองบอร์ดที่ยังไม่ได้ตั้งค่าทั้งคู่ยังคุยกันได้อยู่
// ============================================================

#pragma once

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>

#define TUG_PORTAL_MAX_NETWORKS   5      // จำ WiFi ได้กี่วง
#define TUG_PORTAL_CONNECT_MS     15000  // เวลารอต่อ WiFi ต่อ 1 วง
#define TUG_PORTAL_RETRY_MS       20000  // เว้นระยะก่อนวนลองต่อใหม่รอบถัดไป
#define TUG_PORTAL_SCAN_CACHE_MS  30000  // ผลสแกนเก่ากว่านี้ถือว่าหมดอายุ
#define TUG_PORTAL_FALLBACK_CH    1      // ช่องของ AP ตอนยังไม่ได้ต่อ WiFi
#define TUG_PORTAL_NVS_NS         "tugwifi"

// ============================================================
// หน้าเว็บตั้งค่า — เก็บใน PROGMEM (flash) ไม่กิน RAM
// ============================================================
static const char TUG_PORTAL_HTML[] PROGMEM = R"HTMLPAGE(
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ตั้งค่าเครือข่าย</title>
<style>
:root{
  --bg:#0b1020; --bg2:#111a33; --card:rgba(255,255,255,.05);
  --line:rgba(255,255,255,.10); --line2:rgba(255,255,255,.16);
  --text:#eef2ff; --muted:#93a0c0; --accent:#5b8cff; --accent2:#3d6dfa;
  --ok:#2fd48a; --warn:#f5b544; --err:#ff6b6b; --radius:16px;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0}
body{
  min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",
    "Sarabun","Noto Sans Thai",Roboto,sans-serif;
  color:var(--text);background:var(--bg);
  background-image:
    radial-gradient(900px 500px at 15% -10%,rgba(91,140,255,.22),transparent 60%),
    radial-gradient(700px 500px at 110% 10%,rgba(47,212,138,.12),transparent 60%),
    linear-gradient(180deg,var(--bg) 0%,var(--bg2) 100%);
  background-attachment:fixed;
  padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
}
.wrap{max-width:560px;margin:0 auto;padding:28px 18px 48px}

/* ---------- header ---------- */
.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.brand .mark{
  width:42px;height:42px;border-radius:12px;flex:none;
  display:grid;place-items:center;
  background:linear-gradient(145deg,var(--accent),var(--accent2));
  box-shadow:0 6px 18px rgba(61,109,250,.38);
}
.brand h1{font-size:17px;margin:0;font-weight:650;letter-spacing:.2px}
.brand p{margin:2px 0 0;font-size:12.5px;color:var(--muted)}

/* ---------- cards ---------- */
.card{
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  padding:18px;margin-bottom:16px;
}
.card-head{display:flex;align-items:center;justify-content:space-between;
  gap:10px;margin-bottom:14px}
.card-head h2{font-size:13px;margin:0;font-weight:600;letter-spacing:.6px;
  text-transform:uppercase;color:var(--muted)}

/* ---------- status ---------- */
.status-top{display:flex;align-items:center;gap:12px}
.dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--muted)}
.dot.on{background:var(--ok);box-shadow:0 0 0 4px rgba(47,212,138,.16);
  animation:pulse 2.2s ease-in-out infinite}
.dot.busy{background:var(--warn);box-shadow:0 0 0 4px rgba(245,181,68,.16);
  animation:pulse 1s ease-in-out infinite}
.dot.off{background:var(--err);box-shadow:0 0 0 4px rgba(255,107,107,.14)}
@keyframes pulse{50%{opacity:.45}}
.status-txt{flex:1;min-width:0}
.status-txt .label{font-size:12px;color:var(--muted)}
.status-txt .value{font-size:17px;font-weight:650;margin-top:1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
  gap:10px;margin-top:16px}
.meta div{background:rgba(255,255,255,.04);border:1px solid var(--line);
  border-radius:10px;padding:9px 11px;min-width:0}
.meta .k{font-size:10.5px;color:var(--muted);letter-spacing:.5px;
  text-transform:uppercase}
.meta .v{font-size:13.5px;font-weight:600;margin-top:3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ---------- tabs ---------- */
.tabs{display:flex;gap:6px;background:rgba(255,255,255,.04);
  border:1px solid var(--line);border-radius:12px;padding:4px;margin-bottom:16px}
.tabs button{flex:1;padding:9px 6px;border:0;border-radius:9px;cursor:pointer;
  background:transparent;color:var(--muted);font-size:13px;font-weight:600;
  font-family:inherit;transition:.18s}
.tabs button.active{background:rgba(91,140,255,.20);color:var(--text)}

/* ---------- network list ---------- */
.net{display:flex;align-items:center;gap:12px;padding:13px 12px;cursor:pointer;
  border:1px solid transparent;border-radius:12px;transition:.16s}
.net:hover{background:rgba(255,255,255,.05)}
.net.sel{background:rgba(91,140,255,.13);border-color:rgba(91,140,255,.35)}
.net + .net{margin-top:2px}
.net .name{flex:1;min-width:0;font-size:14.5px;font-weight:550;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.net .sub{font-size:11.5px;color:var(--muted);font-weight:400;margin-top:2px}
.bars{display:flex;align-items:flex-end;gap:2px;height:14px;flex:none}
.bars i{width:3px;border-radius:1px;background:rgba(255,255,255,.18)}
.bars i:nth-child(1){height:4px}.bars i:nth-child(2){height:7px}
.bars i:nth-child(3){height:10.5px}.bars i:nth-child(4){height:14px}
.bars i.on{background:var(--text)}
.ic{flex:none;opacity:.55}

/* ---------- form ---------- */
label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px 2px}
input{width:100%;padding:12px 13px;font-size:15px;font-family:inherit;
  color:var(--text);background:rgba(255,255,255,.05);
  border:1px solid var(--line2);border-radius:11px;outline:none;transition:.16s}
input:focus{border-color:var(--accent);background:rgba(91,140,255,.08)}
input::placeholder{color:rgba(147,160,192,.6)}
.field{margin-bottom:13px}
.pw{position:relative}
.pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);
  background:transparent;border:0;color:var(--muted);cursor:pointer;padding:7px;
  font-size:12px;font-family:inherit}
.check{display:flex;align-items:center;gap:9px;margin:4px 0 14px;
  font-size:13px;color:var(--muted);cursor:pointer}
.check input{width:17px;height:17px;accent-color:var(--accent);flex:none;padding:0}
.btn{width:100%;padding:13px;border:0;border-radius:12px;cursor:pointer;
  font-size:15px;font-weight:650;font-family:inherit;color:#fff;
  background:linear-gradient(145deg,var(--accent),var(--accent2));
  box-shadow:0 6px 18px rgba(61,109,250,.32);transition:.16s}
.btn:active{transform:scale(.985)}
.btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
.btn.ghost{background:transparent;border:1px solid var(--line2);
  color:var(--muted);box-shadow:none;font-size:13px;padding:9px;width:auto}
.btn.link{background:none;box-shadow:none;color:var(--accent);font-size:12.5px;
  width:auto;padding:6px 8px}

/* ---------- misc ---------- */
.msg{padding:11px 13px;border-radius:11px;font-size:13px;margin-bottom:13px;
  display:none;line-height:1.5}
.msg.show{display:block}
.msg.ok{background:rgba(47,212,138,.12);border:1px solid rgba(47,212,138,.3);
  color:var(--ok)}
.msg.err{background:rgba(255,107,107,.11);border:1px solid rgba(255,107,107,.3);
  color:var(--err)}
.msg.info{background:rgba(245,181,68,.11);border:1px solid rgba(245,181,68,.3);
  color:var(--warn)}
.empty{text-align:center;color:var(--muted);font-size:13px;padding:26px 10px}
.spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.2);
  border-top-color:var(--text);border-radius:50%;display:inline-block;
  vertical-align:-3px;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.saved{display:flex;align-items:center;gap:10px;padding:12px;
  border:1px solid var(--line);border-radius:11px}
.saved + .saved{margin-top:8px}
.saved .name{flex:1;min-width:0;font-size:14px;font-weight:550;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foot{text-align:center;font-size:11.5px;color:var(--muted);
  margin-top:22px;line-height:1.7}
.hide{display:none}
@media(max-width:420px){
  .wrap{padding:20px 13px 40px}
  .card{padding:15px}
  .status-txt .value{font-size:15.5px}
}
</style>
</head>
<body>
<div class="wrap">

  <div class="brand">
    <div class="mark">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff"
           stroke-width="2" stroke-linecap="round">
        <path d="M2 8.5a15 15 0 0 1 20 0"/>
        <path d="M5.5 12.2a10 10 0 0 1 13 0"/>
        <path d="M9 15.9a5 5 0 0 1 6 0"/>
        <circle cx="12" cy="19.5" r="1.1" fill="#fff" stroke="none"/>
      </svg>
    </div>
    <div>
      <h1 id="devName">TUG Device</h1>
      <p>ตั้งค่าการเชื่อมต่อเครือข่าย</p>
    </div>
  </div>

  <!-- ---------- สถานะ ---------- -->
  <div class="card">
    <div class="status-top">
      <span class="dot off" id="dot"></span>
      <div class="status-txt">
        <div class="label">สถานะการเชื่อมต่อ</div>
        <div class="value" id="stTitle">กำลังตรวจสอบ...</div>
      </div>
    </div>
    <div class="meta" id="meta"></div>
  </div>

  <!-- ---------- ตั้งค่า ---------- -->
  <div class="card">
    <div class="tabs">
      <button class="active" data-tab="scan">เครือข่ายที่พบ</button>
      <button data-tab="manual">กรอกเอง</button>
      <button data-tab="saved">ที่บันทึกไว้</button>
    </div>

    <div class="msg" id="msg"></div>

    <!-- แท็บ: สแกน -->
    <div id="tab-scan">
      <div class="card-head">
        <h2>เลือกเครือข่าย</h2>
        <button class="btn ghost" id="rescan">สแกนใหม่</button>
      </div>
      <div id="netlist"><div class="empty"><span class="spin"></span></div></div>
      <div id="joinBox" class="hide" style="margin-top:14px">
        <div class="field pw">
          <label>รหัสผ่านของ <span id="joinName"></span></label>
          <input type="password" id="joinPw" placeholder="รหัสผ่าน WiFi"
                 autocomplete="off">
          <button type="button" data-toggle="joinPw">แสดง</button>
        </div>
        <label class="check">
          <input type="checkbox" id="joinSave" checked>
          จดจำเครือข่ายนี้ และเชื่อมต่ออัตโนมัติครั้งต่อไป
        </label>
        <button class="btn" id="joinBtn">เชื่อมต่อ</button>
      </div>
    </div>

    <!-- แท็บ: กรอกเอง -->
    <div id="tab-manual" class="hide">
      <div class="card-head"><h2>กรอกข้อมูลเครือข่ายเอง</h2></div>
      <div class="field">
        <label>ชื่อเครือข่าย (SSID)</label>
        <input type="text" id="mSsid" placeholder="เช่น Hospital-WiFi"
               autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field pw">
        <label>รหัสผ่าน (เว้นว่างหากเป็นเครือข่ายเปิด)</label>
        <input type="password" id="mPw" placeholder="รหัสผ่าน WiFi"
               autocomplete="off">
        <button type="button" data-toggle="mPw">แสดง</button>
      </div>
      <label class="check">
        <input type="checkbox" id="mSave" checked>
        จดจำเครือข่ายนี้ และเชื่อมต่ออัตโนมัติครั้งต่อไป
      </label>
      <button class="btn" id="mBtn">เชื่อมต่อ</button>
    </div>

    <!-- แท็บ: บันทึกไว้ -->
    <div id="tab-saved" class="hide">
      <div class="card-head"><h2>เครือข่ายที่จดจำไว้</h2></div>
      <div id="savedlist"></div>
    </div>
  </div>

  <div class="foot">
    เครือข่ายตั้งค่าของบอร์ดนี้เปิดค้างไว้ตลอดเวลา<br>
    เข้าหน้านี้ได้เสมอที่ <b id="apip">192.168.4.1</b>
  </div>
</div>

<script>
var sel = null, saved = [], busy = false, pollTimer = null;

function $(id){ return document.getElementById(id); }

function msg(text, kind){
  var m = $('msg');
  if(!text){ m.className = 'msg'; m.innerHTML = ''; return; }
  m.className = 'msg show ' + kind;
  m.innerHTML = text;
}

function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

/* rssi (dBm) -> จำนวนขีดสัญญาณ 1-4 */
function bars(rssi){
  var n = rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -78 ? 2 : 1, h = '';
  for(var i = 1; i <= 4; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
  return '<span class="bars">' + h + '</span>';
}

var LOCK = '<svg class="ic" width="13" height="13" viewBox="0 0 24 24" fill="none"'
  + ' stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11"'
  + ' rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

/* ---------- แท็บ ---------- */
document.querySelectorAll('.tabs button').forEach(function(b){
  b.onclick = function(){
    document.querySelectorAll('.tabs button').forEach(function(x){
      x.classList.remove('active');
    });
    b.classList.add('active');
    ['scan','manual','saved'].forEach(function(t){
      $('tab-' + t).classList.toggle('hide', t !== b.dataset.tab);
    });
    msg('');
  };
});

document.querySelectorAll('[data-toggle]').forEach(function(b){
  b.onclick = function(){
    var i = $(b.dataset.toggle);
    var showing = i.type === 'text';
    i.type = showing ? 'password' : 'text';
    b.textContent = showing ? 'แสดง' : 'ซ่อน';
  };
});

/* ---------- สถานะ ---------- */
function renderStatus(s){
  $('devName').textContent = s.device;
  $('apip').textContent = s.ap_ip;
  saved = s.saved || [];

  var dot = $('dot'), t = $('stTitle');
  if(s.connecting){
    dot.className = 'dot busy';
    t.innerHTML = 'กำลังเชื่อมต่อ ' + esc(s.target) + ' <span class="spin"></span>';
  } else if(s.connected){
    dot.className = 'dot on';
    t.textContent = s.ssid;   /* textContent ปลอดภัยอยู่แล้ว ไม่ต้อง escape ซ้ำ */
  } else {
    dot.className = 'dot off';
    t.textContent = 'ยังไม่ได้เชื่อมต่ออินเทอร์เน็ต';
  }

  var m = [];
  if(s.connected){
    m.push(['IP ของบอร์ด', s.ip]);
    m.push(['ความแรงสัญญาณ', s.rssi + ' dBm']);
    m.push(['ช่องสัญญาณ', s.channel]);
  } else {
    m.push(['สถานะ', s.connecting ? 'กำลังเชื่อมต่อ' : 'ออฟไลน์']);
    m.push(['จดจำไว้', saved.length + ' เครือข่าย']);
  }
  m.push(['เครือข่ายตั้งค่า', s.ap_ssid]);
  $('meta').innerHTML = m.map(function(x){
    return '<div><div class="k">' + esc(x[0]) + '</div>'
         + '<div class="v">' + esc(x[1]) + '</div></div>';
  }).join('');

  if(!busy && s.error){ msg(esc(s.error), 'err'); }
  renderSaved(s);
  busy = !!s.connecting;
  $('joinBtn').disabled = busy;
  $('mBtn').disabled = busy;
}

function renderSaved(s){
  if(!saved.length){
    $('savedlist').innerHTML =
      '<div class="empty">ยังไม่มีเครือข่ายที่จดจำไว้<br>'
      + 'เมื่อเชื่อมต่อสำเร็จ บอร์ดจะจำไว้ให้อัตโนมัติ</div>';
    return;
  }
  $('savedlist').innerHTML = saved.map(function(n){
    var active = s && s.connected && s.ssid === n;
    return '<div class="saved">'
      + '<span class="dot ' + (active ? 'on' : '') + '"></span>'
      + '<span class="name">' + esc(n) + '</span>'
      + (active ? '<span class="sub" style="color:var(--ok);font-size:11.5px">'
                  + 'ใช้งานอยู่</span>' : '')
      + '<button class="btn link" data-forget="' + esc(n) + '">ลบ</button></div>';
  }).join('');
  document.querySelectorAll('[data-forget]').forEach(function(b){
    b.onclick = function(){ forget(b.dataset.forget); };
  });
}

function poll(){
  fetch('/api/status').then(function(r){ return r.json(); })
    .then(renderStatus).catch(function(){});
}

/* ---------- สแกน ---------- */
function renderNets(d){
  if(d.scanning){
    $('netlist').innerHTML = '<div class="empty"><span class="spin"></span>'
      + '<br><br>กำลังค้นหาเครือข่าย...</div>';
    setTimeout(scan, 1400);
    return;
  }
  if(!d.nets || !d.nets.length){
    $('netlist').innerHTML = '<div class="empty">ไม่พบเครือข่ายในบริเวณนี้<br>'
      + 'กด "สแกนใหม่" เพื่อลองอีกครั้ง</div>';
    return;
  }
  $('netlist').innerHTML = d.nets.map(function(n, i){
    var isSaved = saved.indexOf(n.ssid) >= 0;
    return '<div class="net" data-i="' + i + '" data-ssid="' + esc(n.ssid) + '"'
      + ' data-open="' + (n.open ? 1 : 0) + '">'
      + '<div style="flex:1;min-width:0"><div class="name">' + esc(n.ssid) + '</div>'
      + '<div class="sub">' + (n.open ? 'เครือข่ายเปิด' : 'ต้องใช้รหัสผ่าน')
      + (isSaved ? ' &middot; จดจำไว้แล้ว' : '') + '</div></div>'
      + (n.open ? '' : LOCK) + bars(n.rssi) + '</div>';
  }).join('');

  document.querySelectorAll('.net').forEach(function(el){
    el.onclick = function(){
      document.querySelectorAll('.net').forEach(function(x){
        x.classList.remove('sel');
      });
      el.classList.add('sel');
      sel = { ssid: el.dataset.ssid, open: el.dataset.open === '1' };
      $('joinName').textContent = sel.ssid;
      $('joinBox').classList.remove('hide');
      $('joinPw').value = '';
      $('joinPw').parentElement.style.display = sel.open ? 'none' : 'block';
      if(!sel.open) $('joinPw').focus();
    };
  });
}

function scan(){
  fetch('/api/scan').then(function(r){ return r.json(); })
    .then(renderNets).catch(function(){});
}

$('rescan').onclick = function(){
  $('netlist').innerHTML = '<div class="empty"><span class="spin"></span></div>';
  fetch('/api/scan?refresh=1').then(function(r){ return r.json(); })
    .then(renderNets).catch(function(){});
};

/* ---------- เชื่อมต่อ ---------- */
function connect(ssid, pw, save){
  if(!ssid){ msg('กรุณาระบุชื่อเครือข่าย', 'err'); return; }
  busy = true;
  msg('กำลังเชื่อมต่อ ' + esc(ssid)
      + ' <span class="spin"></span><br>'
      + 'หากอุปกรณ์ของคุณหลุดจากเครือข่ายตั้งค่าชั่วครู่ ถือเป็นเรื่องปกติ', 'info');
  var body = new URLSearchParams();
  body.append('ssid', ssid);
  body.append('password', pw);
  body.append('save', save ? '1' : '0');
  fetch('/api/connect', { method: 'POST', body: body })
    .then(function(r){ return r.json(); })
    .then(function(){ setTimeout(watch, 1500); })
    .catch(function(){ setTimeout(watch, 2500); });
}

/* ตามผลการเชื่อมต่อจนกว่าจะรู้ผล */
function watch(){
  fetch('/api/status').then(function(r){ return r.json(); }).then(function(s){
    renderStatus(s);
    if(s.connecting){ setTimeout(watch, 1200); return; }
    busy = false;
    if(s.connected){
      msg('เชื่อมต่อ ' + esc(s.ssid) + ' สำเร็จ &middot; IP ' + esc(s.ip), 'ok');
      $('joinBox').classList.add('hide');
    } else {
      msg(esc(s.error || 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบรหัสผ่าน'), 'err');
    }
  }).catch(function(){ setTimeout(watch, 2000); });
}

$('joinBtn').onclick = function(){
  if(!sel){ msg('กรุณาเลือกเครือข่ายก่อน', 'err'); return; }
  connect(sel.ssid, sel.open ? '' : $('joinPw').value, $('joinSave').checked);
};
$('mBtn').onclick = function(){
  connect($('mSsid').value.trim(), $('mPw').value, $('mSave').checked);
};

function forget(ssid){
  var body = new URLSearchParams();
  body.append('ssid', ssid);
  fetch('/api/forget', { method: 'POST', body: body }).then(function(){
    msg('ลบ ' + esc(ssid) + ' ออกจากรายการที่จดจำแล้ว', 'ok');
    poll();
  });
}

/* ---------- เริ่มทำงาน ---------- */
poll();
scan();
pollTimer = setInterval(function(){ if(!busy) poll(); }, 4000);
</script>
</body>
</html>
)HTMLPAGE";

// ============================================================
// คลาสหลัก
// ============================================================
class TUGWiFiPortal {
public:
  // เรียกใน setup() — ก่อน esp_now_init() เสมอ เพราะฟังก์ชันนี้ตั้งโหมด WiFi
  void begin(const char* apSsid, const char* apPass, const char* deviceLabel) {
    _apSsid = apSsid;
    _device = deviceLabel;

    WiFi.persistent(false);          // เราจัดการ credential เองใน NVS
    WiFi.mode(WIFI_AP_STA);          // AP ค้างตลอด + STA ต่อ Router
    WiFi.setAutoReconnect(true);

    // ปิด modem sleep — ค่า default ของ ESP32 คือ "เปิด" ซึ่งทำให้วิทยุหลับเป็นช่วง ๆ
    // ผลคือ HTTPS ไป Firestore หน่วง/พลาดเป็นระยะ (heartbeat หลุดจนเว็บขึ้น OFFLINE หลอก ๆ)
    // และแพ็กเก็ต ESP-NOW ตกหล่นด้วย ระบบนี้ต้องการความแน่นอนมากกว่าประหยัดไฟ
    WiFi.setSleep(false);

    // รหัสผ่านสั้นกว่า 8 ตัว WPA2 ใช้ไม่ได้ → เปิดเป็นเครือข่ายเปิดแทน
    bool openAp = (apPass == nullptr || strlen(apPass) < 8);
    WiFi.softAP(apSsid, openAp ? nullptr : apPass, TUG_PORTAL_FALLBACK_CH);
    _apIP = WiFi.softAPIP();

    _dns.setErrorReplyCode(DNSReplyCode::NoError);
    _dns.start(53, "*", _apIP);      // ตอบทุกชื่อโดเมนด้วย IP ของบอร์ด

    _routes();
    _server.begin();

    loadSaved();

    Serial.println();
    Serial.println("  ------- WiFi Setup Portal -------");
    Serial.print  ("  [Portal] AP SSID : "); Serial.println(_apSsid);
    Serial.print  ("  [Portal] รหัสผ่าน : ");
    Serial.println(openAp ? "(ไม่มี — เครือข่ายเปิด)" : apPass);
    Serial.print  ("  [Portal] เปิดหน้าตั้งค่าที่ http://"); Serial.println(_apIP);
    Serial.print  ("  [Portal] จดจำ WiFi ไว้ "); Serial.print(_savedCount);
    Serial.println(" เครือข่าย");
    Serial.println("  ---------------------------------");

    if (_savedCount > 0) _beginAttempt(0);
    else Serial.println("  [Portal] ยังไม่เคยตั้งค่า WiFi — ต่อเข้า AP ด้านบนเพื่อตั้งค่า");
  }

  // เรียกทุกรอบของ loop() — ทำงานเร็ว ไม่บล็อก
  void handle() {
    _dns.processNextRequest();
    _server.handleClient();
    _tickScan();
    _tickConnect();
  }

  bool isConnected() const { return WiFi.status() == WL_CONNECTED; }
  bool isConnecting() const { return _connecting; }

  // ระหว่างช่วงที่ต้องการความแม่นยำของเวลา ให้เลื่อนงานหนัก (สแกน/ลองต่อใหม่) ออกไป
  // สแกน WiFi กินเวลาเป็นวินาทีและรบกวน ESP-NOW → ห้ามทำระหว่างจับเวลา
  void setTimingCritical(bool busy) { _timingCritical = busy; }

  String apSSID() const { return _apSsid; }
  IPAddress apIP()  const { return _apIP; }

  // ---------- NVS: รายการ WiFi ที่จดจำไว้ ----------
  void loadSaved() {
    _prefs.begin(TUG_PORTAL_NVS_NS, true);
    _savedCount = _prefs.getUChar("cnt", 0);
    if (_savedCount > TUG_PORTAL_MAX_NETWORKS) _savedCount = 0;   // ข้อมูลเพี้ยน → ทิ้ง
    for (uint8_t i = 0; i < _savedCount; i++) {
      _ssid[i] = _prefs.getString(_key("s", i).c_str(), "");
      _pass[i] = _prefs.getString(_key("p", i).c_str(), "");
    }
    _prefs.end();

    // ตัดรายการที่ SSID ว่างทิ้ง (กันข้อมูลเสียหายทำให้วนต่อ WiFi ชื่อว่าง)
    uint8_t w = 0;
    for (uint8_t i = 0; i < _savedCount; i++) {
      if (_ssid[i].length() == 0) continue;
      _ssid[w] = _ssid[i]; _pass[w] = _pass[i]; w++;
    }
    _savedCount = w;
  }

  void saveAll() {
    _prefs.begin(TUG_PORTAL_NVS_NS, false);
    _prefs.putUChar("cnt", _savedCount);
    for (uint8_t i = 0; i < _savedCount; i++) {
      _prefs.putString(_key("s", i).c_str(), _ssid[i]);
      _prefs.putString(_key("p", i).c_str(), _pass[i]);
    }
    // ล้างช่องที่ไม่ได้ใช้ ไม่ให้รหัสผ่านเก่าค้างอยู่ใน flash
    for (uint8_t i = _savedCount; i < TUG_PORTAL_MAX_NETWORKS; i++) {
      _prefs.remove(_key("s", i).c_str());
      _prefs.remove(_key("p", i).c_str());
    }
    _prefs.end();
  }

  // เพิ่ม/อัปเดตแล้วเลื่อนขึ้นหัวรายการ — วงที่ใช้ล่าสุดจะถูกลองต่อก่อนเสมอ
  void rememberNetwork(const String& ssid, const String& pass) {
    if (ssid.length() == 0) return;
    int found = -1;
    for (uint8_t i = 0; i < _savedCount; i++) if (_ssid[i] == ssid) { found = i; break; }

    if (found >= 0) {
      for (int i = found; i > 0; i--) { _ssid[i] = _ssid[i-1]; _pass[i] = _pass[i-1]; }
    } else {
      uint8_t last = (_savedCount < TUG_PORTAL_MAX_NETWORKS)
                     ? _savedCount++ : (TUG_PORTAL_MAX_NETWORKS - 1);
      for (int i = last; i > 0; i--) { _ssid[i] = _ssid[i-1]; _pass[i] = _pass[i-1]; }
    }
    _ssid[0] = ssid;
    _pass[0] = pass;
    saveAll();
  }

  void forgetNetwork(const String& ssid) {
    uint8_t w = 0;
    for (uint8_t i = 0; i < _savedCount; i++) {
      if (_ssid[i] == ssid) continue;
      _ssid[w] = _ssid[i]; _pass[w] = _pass[i]; w++;
    }
    _savedCount = w;
    saveAll();
  }

  // ใช้ตอนอัปโหลดครั้งแรก: ถ้ายังไม่เคยตั้งค่าอะไรเลย ให้ใส่ค่าเริ่มต้นไว้ให้
  void seedIfEmpty(const char* ssid, const char* pass) {
    if (_savedCount == 0 && ssid && strlen(ssid) > 0) {
      rememberNetwork(String(ssid), String(pass ? pass : ""));
      Serial.print("  [Portal] ใส่ค่าเริ่มต้นให้อัตโนมัติ: ");
      Serial.println(ssid);
    }
  }

private:
  WebServer   _server{80};
  DNSServer   _dns;
  Preferences _prefs;

  String    _apSsid, _device;
  IPAddress _apIP;

  String  _ssid[TUG_PORTAL_MAX_NETWORKS];
  String  _pass[TUG_PORTAL_MAX_NETWORKS];
  uint8_t _savedCount = 0;

  // --- สถานะการเชื่อมต่อ ---
  bool          _connecting     = false;
  bool          _manualAttempt  = false;   // ผู้ใช้กดเองหรือระบบลองเอง
  int8_t        _autoIndex      = -1;      // กำลังลองวงไหนของรายการที่จำไว้
  String        _target, _pendingPass, _lastError;
  bool          _pendingSave    = false;
  unsigned long _attemptStart   = 0;
  unsigned long _lastRetry      = 0;
  bool          _timingCritical = false;

  // --- สถานะการสแกน ---
  bool          _scanning   = false;
  unsigned long _scanDoneAt = 0;
  String        _scanCache;

  static String _key(const char* p, uint8_t i) { return String(p) + String(i); }

  static String _esc(const String& s) {
    String o;
    o.reserve(s.length() + 8);
    for (size_t i = 0; i < s.length(); i++) {
      char c = s[i];
      if (c == '"' || c == '\\') { o += '\\'; o += c; }
      else if ((uint8_t)c < 0x20)  { o += ' '; }
      else                          o += c;
    }
    return o;
  }

  // ---------- การเชื่อมต่อ (ไม่บล็อก) ----------
  void _beginAttempt(int8_t savedIndex) {
    if (savedIndex < 0 || savedIndex >= (int8_t)_savedCount) return;
    _autoIndex     = savedIndex;
    _manualAttempt = false;
    _startConnect(_ssid[savedIndex], _pass[savedIndex], false);
  }

  void _startConnect(const String& ssid, const String& pass, bool manual) {
    if (_scanning) { WiFi.scanDelete(); _scanning = false; }

    _target       = ssid;
    _pendingPass  = pass;
    _manualAttempt = manual || _manualAttempt;
    _connecting   = true;
    _attemptStart = millis();
    _lastError    = "";

    WiFi.disconnect(false, false);
    WiFi.begin(ssid.c_str(), pass.length() ? pass.c_str() : nullptr);

    Serial.print("  [Portal] กำลังเชื่อมต่อ: ");
    Serial.println(ssid);
  }

  void _tickConnect() {
    if (_connecting) {
      if (WiFi.status() == WL_CONNECTED) {
        _connecting = false;
        _lastError  = "";
        if (_pendingSave || !_manualAttempt) {
          // วงที่ต่อสำเร็จจะถูกเลื่อนขึ้นหัวรายการเสมอ (รวมถึงวงที่จำไว้อยู่แล้ว)
          rememberNetwork(_target, _pendingPass);
        }
        _pendingSave   = false;
        _manualAttempt = false;
        _autoIndex     = -1;

        Serial.println();
        Serial.print("  [Portal] เชื่อมต่อสำเร็จ: "); Serial.println(_target);
        Serial.print("  [Portal] IP: ");   Serial.println(WiFi.localIP());
        Serial.print("  [Portal] Ch: ");   Serial.print(WiFi.channel());
        Serial.print("  RSSI: ");          Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
        return;
      }

      wl_status_t st = WiFi.status();
      bool hardFail = (st == WL_NO_SSID_AVAIL || st == WL_CONNECT_FAILED);
      bool timeout  = (millis() - _attemptStart >= TUG_PORTAL_CONNECT_MS);
      if (!hardFail && !timeout) return;

      _connecting = false;
      _lastError  = (st == WL_NO_SSID_AVAIL)
                    ? ("ไม่พบเครือข่าย \"" + _target + "\" ในบริเวณนี้")
                    : ("เชื่อมต่อ \"" + _target + "\" ไม่สำเร็จ — กรุณาตรวจสอบรหัสผ่าน");
      Serial.print("  [Portal] ล้มเหลว: "); Serial.println(_lastError);

      WiFi.disconnect(false, false);
      _lastRetry = millis();

      // ถ้ากำลังไล่ลองวงที่จำไว้อยู่ ให้ข้ามไปวงถัดไปทันที ไม่ต้องรอครบรอบ
      if (!_manualAttempt && _autoIndex >= 0 &&
          _autoIndex + 1 < (int8_t)_savedCount) {
        _beginAttempt(_autoIndex + 1);
      } else {
        _autoIndex     = -1;
        _manualAttempt = false;
      }
      return;
    }

    // --- ไม่ได้ต่ออยู่และไม่ได้กำลังต่อ → วนลองรายการที่จำไว้ใหม่เป็นระยะ ---
    if (WiFi.status() == WL_CONNECTED || _savedCount == 0) return;
    if (_timingCritical) return;
    if (millis() - _lastRetry < TUG_PORTAL_RETRY_MS) return;
    _lastRetry = millis();
    _beginAttempt(0);
  }

  // ---------- การสแกน (async) ----------
  void _startScan() {
    if (_scanning || _connecting || _timingCritical) return;
    WiFi.scanDelete();
    WiFi.scanNetworks(true /* async */, false /* ไม่แสดง SSID ที่ซ่อน */);
    _scanning = true;
  }

  void _tickScan() {
    if (!_scanning) return;
    int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_RUNNING) return;

    _scanning   = false;
    _scanDoneAt = millis();

    String j = "{\"scanning\":false,\"nets\":[";
    if (n > 0) {
      int shown = 0;
      for (int i = 0; i < n && shown < 25; i++) {
        String s = WiFi.SSID(i);
        if (s.length() == 0) continue;             // ข้าม SSID ที่ซ่อนไว้
        if (s == _apSsid)    continue;             // ไม่ต้องโชว์ AP ของตัวเอง
        if (shown++) j += ',';
        j += "{\"ssid\":\"" + _esc(s) + "\",\"rssi\":" + String(WiFi.RSSI(i)) +
             ",\"open\":" +
             String(WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "true" : "false") + "}";
      }
    }
    j += "]}";
    _scanCache = j;
    WiFi.scanDelete();
  }

  // ---------- HTTP ----------
  String _statusJson() {
    String j = "{";
    j += "\"device\":\""     + _esc(_device) + "\",";
    j += "\"ap_ssid\":\""    + _esc(_apSsid) + "\",";
    j += "\"ap_ip\":\""      + _apIP.toString() + "\",";
    j += "\"connected\":"    + String(isConnected() ? "true" : "false") + ",";
    j += "\"connecting\":"   + String(_connecting ? "true" : "false") + ",";
    j += "\"target\":\""     + _esc(_target) + "\",";
    j += "\"ssid\":\""       + _esc(WiFi.SSID()) + "\",";
    j += "\"ip\":\""         + WiFi.localIP().toString() + "\",";
    j += "\"rssi\":"         + String(isConnected() ? WiFi.RSSI() : 0) + ",";
    j += "\"channel\":"      + String(WiFi.channel()) + ",";
    j += "\"error\":\""      + _esc(_lastError) + "\",";
    j += "\"saved\":[";
    for (uint8_t i = 0; i < _savedCount; i++) {
      if (i) j += ',';
      j += "\"" + _esc(_ssid[i]) + "\"";
    }
    j += "]}";
    return j;
  }

  void _routes() {
    _server.on("/", HTTP_GET, [this]() {
      _server.sendHeader("Cache-Control", "no-store");
      _server.send_P(200, "text/html; charset=utf-8", TUG_PORTAL_HTML);
    });

    _server.on("/api/status", HTTP_GET, [this]() {
      _server.sendHeader("Cache-Control", "no-store");
      _server.send(200, "application/json", _statusJson());
    });

    _server.on("/api/scan", HTTP_GET, [this]() {
      bool refresh = _server.hasArg("refresh");
      bool stale   = (_scanCache.length() == 0) ||
                     (millis() - _scanDoneAt > TUG_PORTAL_SCAN_CACHE_MS);
      if (!_scanning && (refresh || stale)) _startScan();

      _server.sendHeader("Cache-Control", "no-store");
      if (_scanning) {
        _server.send(200, "application/json", "{\"scanning\":true,\"nets\":[]}");
      } else if (_scanCache.length()) {
        _server.send(200, "application/json", _scanCache);
      } else {
        // สแกนไม่ได้ตอนนี้ (กำลังจับเวลาอยู่) — บอกให้ผู้ใช้กรอกเอง
        _server.send(200, "application/json", "{\"scanning\":false,\"nets\":[]}");
      }
    });

    _server.on("/api/connect", HTTP_POST, [this]() {
      String ssid = _server.arg("ssid");
      String pw   = _server.arg("password");
      _pendingSave = (_server.arg("save") != "0");
      if (ssid.length() == 0) {
        _server.send(400, "application/json",
                     "{\"ok\":false,\"error\":\"missing ssid\"}");
        return;
      }
      // ตอบกลับก่อน แล้วค่อยเริ่มต่อ — ไม่งั้น client จะค้างรอตอน WiFi สะดุด
      _server.send(200, "application/json", "{\"ok\":true}");
      _manualAttempt = true;
      _autoIndex     = -1;
      _startConnect(ssid, pw, true);
    });

    _server.on("/api/forget", HTTP_POST, [this]() {
      String ssid = _server.arg("ssid");
      forgetNetwork(ssid);
      _server.send(200, "application/json", "{\"ok\":true}");
      Serial.print("  [Portal] ลบเครือข่ายที่จำไว้: "); Serial.println(ssid);
    });

    // ---------- Captive portal ----------
    // ระบบปฏิบัติการแต่ละค่ายเช็ค "มีเน็ตไหม" ด้วย URL ต่างกัน
    // ถ้าเราตอบ redirect กลับมาที่หน้าเรา มันจะเด้ง popup ให้เองเหมือน WiFi โรงแรม
    auto redirect = [this]() {
      _server.sendHeader("Location", "http://" + _apIP.toString() + "/", true);
      _server.send(302, "text/plain", "");
    };
    _server.on("/generate_204",        redirect);   // Android
    _server.on("/gen_204",             redirect);   // Android (เก่า)
    _server.on("/hotspot-detect.html", redirect);   // iOS / macOS
    _server.on("/library/test/success.html", redirect);
    _server.on("/ncsi.txt",            redirect);   // Windows
    _server.on("/connecttest.txt",     redirect);   // Windows 10/11
    _server.on("/redirect",            redirect);
    _server.on("/canonical.html",      redirect);   // Firefox
    _server.on("/success.txt",         redirect);
    _server.onNotFound(redirect);
  }
};
