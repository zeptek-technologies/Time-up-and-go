// ============================================================
// TUGWiFiPortal.h — WiFi Provisioning Portal (Captive Portal)
// ============================================================
// ใช้ร่วมกันทั้ง ESP_Chair_v2 และ ESP_Checkpoint_v2
// ⚠️  ไฟล์นี้ต้องเหมือนกันเป๊ะทั้งสองโฟลเดอร์ ถ้าแก้ที่หนึ่งต้องคัดลอกไปอีกที่
//
// สิ่งที่ไฟล์นี้ทำ:
//   • เปิด SoftAP ค้างไว้ตลอดเวลา (โหมด WIFI_AP_STA) ผู้ใช้ต่อเข้ามาตั้งค่าได้เสมอ
//     แม้บอร์ดกำลังต่อ WiFi บ้าน/โรงพยาบาลอยู่ก็ตาม
//   • DNS wildcard + redirect ทุก request + DHCP option 114 → หน้าตั้งค่าเด้งเองแบบ WiFi โรงแรม
//   • จำ WiFi ที่เคยต่อได้สูงสุด 5 วง เก็บใน NVS แล้วต่อให้อัตโนมัติเมื่อบูต
//   • หน้าเว็บ + การต่อ WiFi ทำงานใน FreeRTOS task ของตัวเอง (core 0)
//     ลูปหลักจะติด HTTPS หรือ ultrasonic อยู่แค่ไหน หน้าเว็บก็ยังตอบทันที
//
// ทำไมเดิม "ต่อ WiFi ของบอร์ดแล้วหน้าเว็บไม่เด้ง":
//   ① หน้าเว็บตอบได้เฉพาะตอนลูปหลักเรียก handle() — ถ้าลูปกำลังคุย Firestore
//      (บล็อกได้เป็นวินาที) มือถือจะรอคำตอบของ captive check ไม่ไหวแล้วเลิกเด้ง
//   ② ถ้า WiFi ที่จำไว้ไม่อยู่ในบริเวณ (เช่นย้ายสถานที่) WiFi driver จะสแกนหาวนไม่หยุด
//      (core 3.x นับ NO_AP_FOUND เป็นเหตุให้ auto-reconnect) วิทยุมีชุดเดียว
//      ระหว่างสแกนมันต้องกระโดดไปทุกช่อง AP ตั้งค่าเลยหลุดเป็นช่วง ๆ
//   ทางแก้: ① ย้ายไปอยู่ใน task แยก  ② ปิด auto-reconnect ของ driver แล้วจัดการเอง
//   และพักการลองต่อเบื้องหลังทั้งหมดระหว่างที่มีคนกำลังใช้หน้าตั้งค่า
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
#include <esp_idf_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

// บอร์ดที่รับ WiFi มาทาง ESP-NOW ไม่ต้องมีหน้าตั้งค่าของตัวเอง — นิยามค่านี้
// "ก่อน" include ไฟล์นี้ แล้วหน้าเว็บจะไม่ถูกคอมไพล์ลง flash
// (สำคัญ: สเก็ตช์ทั้งสองตัวชนเพดาน flash พอดีอยู่แล้ว)
#ifndef TUG_PORTAL_NO_HTML
  #define TUG_PORTAL_WITH_HTML 1
#else
  #define TUG_PORTAL_WITH_HTML 0
#endif

// DHCP option 114 (RFC 8910) — บอกมือถือตั้งแต่ตอนขอ IP ว่าหน้าตั้งค่าอยู่ที่ไหน
// Android 11+ / iOS 14+ ใช้ค่านี้เปิดหน้าให้เลย ไม่ต้องพึ่งการดัก DNS
// (ช่วยเครื่องที่เปิด Private DNS ไว้ ซึ่งการดัก DNS ใช้ไม่ได้) — มีใน core ที่ใช้ IDF >= 5.4.2
#if defined(ESP_IDF_VERSION_VAL) && ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 4, 2)
  #define TUG_PORTAL_DHCP_URI 1
#else
  #define TUG_PORTAL_DHCP_URI 0
#endif

// 1 = พิมพ์ลง Serial ว่ามีเครื่องต่อ AP / ได้ IP / เรียกหน้าไหนบ้าง — ใช้หาว่าหน้าตั้งค่าไม่เด้งเพราะติดขั้นไหน
// ปิดเป็น 0 ได้เมื่อระบบนิ่งแล้ว (log จะเงียบลงมาก)
#ifndef TUG_PORTAL_DEBUG
  #define TUG_PORTAL_DEBUG 1
#endif

#define TUG_PORTAL_MAX_NETWORKS   5      // จำ WiFi ได้กี่วง
#define TUG_PORTAL_CONNECT_MS     15000  // เวลารอต่อ WiFi ต่อ 1 วง
#define TUG_PORTAL_RETRY_MS       20000  // เว้นระยะก่อนวนลองต่อใหม่รอบถัดไป
#define TUG_PORTAL_RETRY_MAX_MS   60000  // ลองไม่ติดติดกันหลายรอบ ยืดระยะออกได้ถึงเท่านี้
#define TUG_PORTAL_AP_HOLD_MS     45000  // มีคนใช้หน้าตั้งค่าล่าสุดภายในเวลานี้ = พักการลองต่อเบื้องหลัง
#define TUG_PORTAL_SCAN_MS_PER_CH 120    // เวลาฟังต่อช่องตอนสแกน (ค่าเดิมของ core 300) — สั้น = AP หายไปจากช่องตัวเองน้อยลง
#define TUG_PORTAL_FALLBACK_CH    1      // ช่องของ AP ตอนยังไม่ได้ต่อ WiFi
#define TUG_PORTAL_NVS_NS         "tugwifi"
#define TUG_PORTAL_TASK_STACK     8192
#define TUG_PORTAL_TASK_CORE      0      // ลูปหลัก (Arduino) อยู่ core 1 — แยกกันไม่แย่ง CPU
#define TUG_PORTAL_TICK_MS        5

// ============================================================
// หน้าเว็บตั้งค่า — เก็บใน PROGMEM (flash) ไม่กิน RAM
// ห้ามใช้ font/รูป/สคริปต์จากเน็ต: มือถือที่ต่อ AP นี้ไม่มีอินเทอร์เน็ต
// ============================================================
#if TUG_PORTAL_WITH_HTML
static const char TUG_PORTAL_HTML[] PROGMEM = R"HTMLPAGE(
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>ตั้งค่า WiFi</title>
<style>
:root{--ink:#0a0a0a;--mute:#6b7280;--line:#e5e7eb;--soft:#f4f5f7;
  --blue:#1d4ed8;--blue-soft:#eef3ff;--ok:#16a34a;--err:#dc2626}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:#fff}
body{color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",
  "Sarabun","Noto Sans Thai",Roboto,sans-serif;
  padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
.w{max-width:460px;margin:0 auto;padding:32px 20px 40px}
button{font:inherit;cursor:pointer}

header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.mk{width:38px;height:38px;border-radius:10px;background:var(--blue);
  display:grid;place-items:center;flex:none}
h1{font-size:17px;line-height:1.3;margin:0;font-weight:650}
header p{margin:0;font-size:13px;color:var(--mute)}

.st{border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:28px}
.row{display:flex;align-items:center;gap:10px;min-width:0}
.dot{width:8px;height:8px;border-radius:50%;background:#d1d5db;flex:none}
.dot.on{background:var(--ok)}
.dot.off{background:var(--err)}
.dot.busy{background:var(--blue);animation:bl 1s ease-in-out infinite}
@keyframes bl{50%{opacity:.25}}
#stTitle{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:14px 0 0;
  padding-top:14px;border-top:1px solid var(--line);font-size:13px}
dt{color:var(--mute)}
dd{margin:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.tabs{display:flex;background:var(--soft);border-radius:10px;padding:3px;margin-bottom:18px}
.tabs button{flex:1;border:0;background:none;padding:8px 4px;border-radius:8px;
  font-size:13px;font-weight:600;color:var(--mute)}
.tabs button.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}

.hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.hd h2{margin:0;font-size:13px;font-weight:600;color:var(--mute)}
.lnk{border:0;background:none;padding:6px 0;color:var(--blue);font-size:13px;font-weight:600}

.net,.saved{display:flex;align-items:center;gap:12px;padding:13px 2px;
  border-bottom:1px solid var(--line)}
.net{cursor:pointer}
.net:last-child,.saved:last-child{border-bottom:0}
.net.sel .name{color:var(--blue)}
.nm{flex:1;min-width:0}
.name{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{font-size:12px;color:var(--mute)}
.ic{flex:none;color:var(--mute)}
.bars{display:flex;align-items:flex-end;gap:2px;height:12px;flex:none}
.bars i{width:3px;border-radius:1px;background:var(--line)}
.bars i:nth-child(1){height:3px}.bars i:nth-child(2){height:6px}
.bars i:nth-child(3){height:9px}.bars i:nth-child(4){height:12px}
.bars i.on{background:var(--ink)}
.tag{font-size:12px;font-weight:600;color:var(--ok)}

#joinBox{margin-top:6px;padding-top:16px;border-top:1px solid var(--line)}
label{display:block;margin:0 0 6px;font-size:13px;color:var(--mute)}
.f{margin-bottom:12px}
input[type=text],input[type=password]{width:100%;padding:12px;font:inherit;color:var(--ink);
  background:#fff;border:1px solid var(--line);border-radius:10px;outline:0}
input:focus{border-color:var(--blue);box-shadow:0 0 0 3px var(--blue-soft)}
.pw{position:relative}
.pw input{padding-right:64px}
.pw button{position:absolute;right:4px;bottom:5px;border:0;background:none;
  padding:8px 10px;font-size:13px;color:var(--mute)}
.chk{display:flex;align-items:center;gap:8px;margin:4px 0 16px;font-size:13px;
  color:var(--mute);cursor:pointer}
.chk input{width:16px;height:16px;margin:0;accent-color:var(--blue)}
.btn{width:100%;padding:13px;border:0;border-radius:10px;background:var(--blue);
  color:#fff;font-weight:600}
.btn:active{background:#1e40af}
.btn:disabled{opacity:.4;cursor:not-allowed}

.msg{display:none;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:16px}
.msg.show{display:block}
.msg.ok{background:#f0fdf4;color:#166534}
.msg.err{background:#fef2f2;color:#991b1b}
.msg.info{background:var(--blue-soft);color:var(--blue)}
.empty{padding:28px 0;text-align:center;font-size:13px;color:var(--mute)}
.spin{display:inline-block;width:14px;height:14px;vertical-align:-2px;border-radius:50%;
  border:2px solid var(--line);border-top-color:var(--blue);animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.hide{display:none!important}
footer{margin-top:32px;text-align:center;font-size:12px;color:var(--mute)}
footer b{color:var(--ink);font-weight:600}
</style>
</head>
<body>
<div class="w">

  <header>
    <div class="mk">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff"
           stroke-width="2.2" stroke-linecap="round">
        <path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12.2a10 10 0 0 1 13 0"/>
        <path d="M9 15.9a5 5 0 0 1 6 0"/>
        <circle cx="12" cy="19.5" r="1.2" fill="#fff" stroke="none"/>
      </svg>
    </div>
    <div>
      <h1 id="devName">TUG Device</h1>
      <p>ตั้งค่าการเชื่อมต่อ WiFi</p>
    </div>
  </header>

  <section class="st">
    <div class="row">
      <span class="dot" id="dot"></span>
      <span id="stTitle">กำลังตรวจสอบ...</span>
    </div>
    <dl id="meta"></dl>
  </section>

  <div class="tabs">
    <button class="active" data-tab="scan">เครือข่ายที่พบ</button>
    <button data-tab="manual">กรอกเอง</button>
    <button data-tab="saved">ที่บันทึกไว้</button>
  </div>

  <div class="msg" id="msg"></div>

  <section id="tab-scan">
    <div class="hd">
      <h2>เลือกเครือข่าย</h2>
      <button class="lnk" id="rescan">สแกนใหม่</button>
    </div>
    <div id="netlist"><div class="empty"><span class="spin"></span></div></div>
    <div id="joinBox" class="hide">
      <div class="f pw">
        <label>รหัสผ่านของ <b id="joinName"></b></label>
        <input type="password" id="joinPw" placeholder="รหัสผ่าน WiFi" autocomplete="off">
        <button type="button" data-toggle="joinPw">แสดง</button>
      </div>
      <label class="chk"><input type="checkbox" id="joinSave" checked>จดจำเครือข่ายนี้</label>
      <button class="btn" id="joinBtn">เชื่อมต่อ</button>
    </div>
  </section>

  <section id="tab-manual" class="hide">
    <div class="f">
      <label>ชื่อเครือข่าย (SSID)</label>
      <input type="text" id="mSsid" placeholder="เช่น Hospital-WiFi"
             autocomplete="off" autocapitalize="off" spellcheck="false">
    </div>
    <div class="f pw">
      <label>รหัสผ่าน (เว้นว่างถ้าเป็นเครือข่ายเปิด)</label>
      <input type="password" id="mPw" placeholder="รหัสผ่าน WiFi" autocomplete="off">
      <button type="button" data-toggle="mPw">แสดง</button>
    </div>
    <label class="chk"><input type="checkbox" id="mSave" checked>จดจำเครือข่ายนี้</label>
    <button class="btn" id="mBtn">เชื่อมต่อ</button>
  </section>

  <section id="tab-saved" class="hide">
    <div class="hd"><h2>บอร์ดจะลองต่อตามลำดับนี้</h2></div>
    <div id="savedlist"></div>
  </section>

  <footer>รองรับเฉพาะ WiFi 2.4 GHz · เปิดหน้านี้ได้เสมอที่ <b id="apip">192.168.4.1</b></footer>
</div>

<script>
var sel = null, saved = [], busy = false;

function $(id){ return document.getElementById(id); }

function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function msg(text, kind){
  var m = $('msg');
  m.className = text ? 'msg show ' + kind : 'msg';
  m.innerHTML = text || '';
}

/* ขอ JSON จากบอร์ด — มี timeout เพราะตอนบอร์ดสลับช่อง WiFi request อาจค้างเงียบ ๆ */
function api(url, opt){
  return Promise.race([
    fetch(url, opt).then(function(r){ return r.json(); }),
    new Promise(function(_, no){ setTimeout(no, 6000); })
  ]);
}

function bars(rssi){
  var n = rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -78 ? 2 : 1, h = '';
  for(var i = 1; i <= 4; i++) h += '<i' + (i <= n ? ' class="on"' : '') + '></i>';
  return '<span class="bars">' + h + '</span>';
}

var LOCK = '<svg class="ic" width="13" height="13" viewBox="0 0 24 24" fill="none"'
  + ' stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11"'
  + ' rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

/* ---------- แท็บ ---------- */
document.querySelectorAll('.tabs button').forEach(function(b){
  b.onclick = function(){
    document.querySelectorAll('.tabs button').forEach(function(x){
      x.classList.toggle('active', x === b);
    });
    ['scan','manual','saved'].forEach(function(t){
      $('tab-' + t).classList.toggle('hide', t !== b.dataset.tab);
    });
    if(!busy) msg('');
  };
});

document.querySelectorAll('[data-toggle]').forEach(function(b){
  b.onclick = function(){
    var i = $(b.dataset.toggle), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    b.textContent = show ? 'ซ่อน' : 'แสดง';
  };
});

/* ---------- สถานะ ---------- */
function renderStatus(s){
  $('devName').textContent = s.device;
  $('apip').textContent = s.ap_ip;
  saved = s.saved || [];

  var t = $('stTitle');
  if(s.connecting){
    $('dot').className = 'dot busy';
    t.textContent = 'กำลังเชื่อมต่อ ' + s.target + '...';
  } else if(s.connected){
    $('dot').className = 'dot on';
    t.textContent = 'เชื่อมต่อแล้ว · ' + s.ssid;
  } else {
    $('dot').className = 'dot off';
    t.textContent = 'ยังไม่ได้เชื่อมต่อ WiFi';
  }

  var m = s.connected
    ? [['IP ของบอร์ด', s.ip], ['ความแรงสัญญาณ', s.rssi + ' dBm'], ['ช่องสัญญาณ', s.channel]]
    : [['จดจำไว้', saved.length + ' เครือข่าย']];
  m.push(['เครือข่ายตั้งค่า', s.ap_ssid]);
  $('meta').innerHTML = m.map(function(x){
    return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>';
  }).join('');

  if(!busy && s.error) msg(esc(s.error), 'err');
  renderSaved(s);
  busy = !!s.connecting;
  $('joinBtn').disabled = busy;
  $('mBtn').disabled = busy;
}

function renderSaved(s){
  if(!saved.length){
    $('savedlist').innerHTML = '<div class="empty">ยังไม่มีเครือข่ายที่จดจำไว้<br>'
      + 'เชื่อมต่อสำเร็จเมื่อไร บอร์ดจะจำไว้ให้เอง</div>';
    return;
  }
  $('savedlist').innerHTML = saved.map(function(n){
    var on = s.connected && s.ssid === n;
    return '<div class="saved"><span class="dot' + (on ? ' on' : '') + '"></span>'
      + '<span class="nm name">' + esc(n) + '</span>'
      + (on ? '<span class="tag">ใช้งานอยู่</span>' : '')
      + '<button class="lnk" data-forget="' + esc(n) + '">ลบ</button></div>';
  }).join('');
  document.querySelectorAll('[data-forget]').forEach(function(b){
    b.onclick = function(){ forget(b.dataset.forget); };
  });
}

function poll(){ api('/api/status').then(renderStatus).catch(function(){}); }

/* ---------- สแกน ---------- */
function renderNets(d){
  if(d.scanning){
    $('netlist').innerHTML = '<div class="empty"><span class="spin"></span>'
      + '<br><br>กำลังค้นหาเครือข่าย...</div>';
    setTimeout(scan, 1500);
    return;
  }
  if(d.busy){
    $('netlist').innerHTML = '<div class="empty">บอร์ดกำลังจับเวลาการทดสอบ สแกนไม่ได้ชั่วคราว<br>'
      + 'รอสักครู่แล้วกด "สแกนใหม่" หรือใช้แท็บ "กรอกเอง"</div>';
    return;
  }
  if(!d.nets || !d.nets.length){
    $('netlist').innerHTML = '<div class="empty">ไม่พบเครือข่ายในบริเวณนี้<br>'
      + 'กด "สแกนใหม่" เพื่อลองอีกครั้ง</div>';
    return;
  }
  $('netlist').innerHTML = d.nets.map(function(n){
    return '<div class="net" data-ssid="' + esc(n.ssid) + '" data-open="' + (n.open ? 1 : 0) + '">'
      + '<div class="nm"><div class="name">' + esc(n.ssid) + '</div>'
      + '<div class="sub">' + (n.open ? 'เครือข่ายเปิด' : 'ต้องใช้รหัสผ่าน')
      + (saved.indexOf(n.ssid) >= 0 ? ' · จดจำไว้แล้ว' : '') + '</div></div>'
      + (n.open ? '' : LOCK) + bars(n.rssi) + '</div>';
  }).join('');

  document.querySelectorAll('.net').forEach(function(el){
    el.onclick = function(){
      document.querySelectorAll('.net').forEach(function(x){ x.classList.toggle('sel', x === el); });
      sel = { ssid: el.dataset.ssid, open: el.dataset.open === '1' };
      $('joinName').textContent = sel.ssid;
      $('joinBox').classList.remove('hide');
      $('joinPw').value = '';
      $('joinPw').parentElement.classList.toggle('hide', sel.open);
      if(!sel.open) $('joinPw').focus();
    };
  });
}

function scan(refresh){
  api('/api/scan' + (refresh ? '?refresh=1' : '')).then(renderNets).catch(function(){
    $('netlist').innerHTML = '<div class="empty">ติดต่อบอร์ดไม่ได้ กด "สแกนใหม่" อีกครั้ง</div>';
  });
}

$('rescan').onclick = function(){
  $('netlist').innerHTML = '<div class="empty"><span class="spin"></span><br><br>'
    + 'กำลังสแกน... มือถืออาจหลุดจากเครือข่ายนี้ชั่วครู่ ถือเป็นเรื่องปกติ</div>';
  scan(true);
};

/* ---------- เชื่อมต่อ ---------- */
function connect(ssid, pw, save){
  if(!ssid){ msg('กรุณาระบุชื่อเครือข่าย', 'err'); return; }
  busy = true;
  $('joinBtn').disabled = $('mBtn').disabled = true;
  msg('<span class="spin"></span> กำลังเชื่อมต่อ ' + esc(ssid) + '<br>'
    + 'มือถืออาจหลุดจากเครือข่ายตั้งค่าชั่วครู่ ถือเป็นเรื่องปกติ', 'info');
  var body = new URLSearchParams();
  body.append('ssid', ssid);
  body.append('password', pw);
  body.append('save', save ? '1' : '0');
  api('/api/connect', { method: 'POST', body: body })
    .then(function(){ setTimeout(watch, 1500); })
    .catch(function(){ setTimeout(watch, 2500); });
}

/* ตามผลการเชื่อมต่อจนกว่าจะรู้ผล */
function watch(){
  api('/api/status').then(function(s){
    renderStatus(s);
    if(s.connecting){ setTimeout(watch, 1200); return; }
    busy = false;
    if(s.connected){
      msg('เชื่อมต่อ ' + esc(s.ssid) + ' สำเร็จ · IP ' + esc(s.ip), 'ok');
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
  api('/api/forget', { method: 'POST', body: body }).then(function(){
    msg('ลบ ' + esc(ssid) + ' แล้ว', 'ok');
    poll();
  }).catch(function(){});
}

poll();
scan();
setInterval(function(){ if(!busy) poll(); }, 4000);
</script>
</body>
</html>
)HTMLPAGE";
#endif  // TUG_PORTAL_WITH_HTML

// ============================================================
// คลาสหลัก
// ============================================================
class TUGWiFiPortal {
public:
  // เรียกใน setup() — ก่อน esp_now_init() เสมอ เพราะฟังก์ชันนี้ตั้งโหมด WiFi
  //
  // startAp=false → ไม่กระจาย SSID ของตัวเอง (ใช้กับบอร์ดที่รับ WiFi มาทาง ESP-NOW)
  // เปิดทีหลังได้ด้วย enableApNow() ซึ่งเป็นทางกู้เมื่อรับค่าไม่สำเร็จ
  void begin(const char* apSsid, const char* apPass, const char* deviceLabel,
             bool startAp = true) {
    _apSsid = apSsid;
    _apPass = apPass ? apPass : "";
    _device = deviceLabel;
    _mtx    = xSemaphoreCreateRecursiveMutex();

    WiFi.persistent(false);          // เราจัดการ credential เองใน NVS
    // โหมด AP_STA เฉพาะเมื่อจะกระจาย SSID จริง ๆ — ถ้าไม่ ใช้ STA ล้วน
    // เพราะการอยู่โหมด AP จะ "ตรึงช่อง" ไว้ ทำให้ไล่หาช่องของอีกบอร์ดไม่ได้
    WiFi.mode(startAp ? WIFI_AP_STA : WIFI_STA);

    // ปิด auto-reconnect ของ driver — portal นี้ต่อใหม่ให้เองใน _tickConnect()
    // ถ้าเปิดไว้ WiFi ที่จำไว้หายไปเมื่อไร driver จะสแกนหาไม่หยุด AP ตั้งค่าจะหลุดตาม
    // (และการสแกนกลางช่วงทดสอบยังทำให้ ESP-NOW สะดุดด้วย)
    WiFi.setAutoReconnect(false);

    // ปิด modem sleep — ค่า default ของ ESP32 คือ "เปิด" ซึ่งทำให้วิทยุหลับเป็นช่วง ๆ
    // ผลคือ HTTPS ไป Firestore หน่วง/พลาดเป็นระยะ (heartbeat หลุดจนเว็บขึ้น OFFLINE หลอก ๆ)
    // และแพ็กเก็ต ESP-NOW ตกหล่นด้วย ระบบนี้ต้องการความแน่นอนมากกว่าประหยัดไฟ
    WiFi.setSleep(false);

    // มีมือถือต่อเข้า AP = กำลังจะเปิดหน้าตั้งค่า — เริ่มพักการลองต่อเบื้องหลังตั้งแต่ตอนนี้
    // ไม่งั้นช่วงวินาทีแรกที่มือถือเช็ค captive portal วิทยุอาจกำลังสแกนอยู่คนละช่องพอดี
    WiFi.onEvent([this](arduino_event_id_t, arduino_event_info_t info) {
      _touch();
#if TUG_PORTAL_DEBUG
      const uint8_t* m = info.wifi_ap_staconnected.mac;
      Serial.printf("  [Portal] 📱 มีเครื่องต่อเข้า AP (%02X:%02X:%02X:%02X:%02X:%02X)\n",
                    m[0], m[1], m[2], m[3], m[4], m[5]);
#endif
    }, ARDUINO_EVENT_WIFI_AP_STACONNECTED);
#if TUG_PORTAL_DEBUG
    // ได้ IP = DHCP ทำงาน ถ้าเห็น "ต่อเข้า AP" แต่ไม่เห็นบรรทัดนี้ มือถือจะเปิดหน้าอะไรไม่ได้เลย
    WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) {
      Serial.print("  [Portal] 📱 แจก IP ให้เครื่องที่ต่อ AP : ");
      Serial.println(IPAddress(info.wifi_ap_staipassigned.ip.addr));
    }, ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED);
    WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t) {
      Serial.println("  [Portal] 📱 เครื่องหลุดจาก AP");
    }, ARDUINO_EVENT_WIFI_AP_STADISCONNECTED);
#endif

    _routes();
    _server.begin();

    loadSaved();

    Serial.println();
    Serial.println("  ------- WiFi Setup Portal -------");
    if (startAp) _startAp();
    else Serial.println("  [Portal] ไม่กระจาย SSID — รอรับค่า WiFi จากบอร์ดเก้าอี้");
    Serial.print  ("  [Portal] จดจำ WiFi ไว้ "); Serial.print(_savedCount);
    Serial.println(" เครือข่าย");

    // สแกนเก็บไว้ตั้งแต่ตอนบูต ก่อนมีใครต่อ AP — หน้าตั้งค่าจะได้รายการทันทีโดยไม่ต้องสแกนตอนเปิดหน้า
    // (การสแกนพาวิทยุออกจากช่องของ AP ไปหลายวินาที ถ้าเกิดตอนมือถือกำลังเปิดหน้า captive
    //  มือถือจะเห็นเครือข่ายสะดุด แล้วโหลดหน้าซ้ำหรือตัดการเชื่อมต่อทิ้ง — เจอจริงกับ iPhone)
    if (startAp) {
      int n = WiFi.scanNetworks(false, false, false, TUG_PORTAL_SCAN_MS_PER_CH);
      _buildScanCache(n);
      Serial.print("  [Portal] สแกนเครือข่ายรอบบูต : พบ ");
      Serial.print(n > 0 ? n : 0);
      Serial.println(" วง");
    }

    if (_savedCount > 0) _beginAttempt(0);
    else if (startAp) Serial.println("  [Portal] ยังไม่เคยตั้งค่า WiFi — ต่อเข้า AP ด้านบนเพื่อตั้งค่า");

    // เริ่ม task หลังตั้งค่าทุกอย่างเสร็จ — จากนี้ไปหน้าเว็บ/การต่อ WiFi เดินเองโดยไม่ต้องรอลูป
    if (xTaskCreatePinnedToCore(_taskEntry, "tug_portal", TUG_PORTAL_TASK_STACK, this,
                                1, &_task, TUG_PORTAL_TASK_CORE) != pdPASS) {
      _task = nullptr;
      Serial.println("  [Portal] ⚠️  สร้าง task ไม่สำเร็จ — ใช้การเรียก handle() จากลูปแทน");
    }
    Serial.println("  ---------------------------------");
  }

  // เปิด AP ทีหลัง — ใช้เป็นทางกู้เมื่อบอร์ดที่ไม่มี AP รับค่า WiFi ไม่สำเร็จสักที
  // ถ้าไม่มีอันนี้ บอร์ดที่ provision พลาดจะเข้าถึงไม่ได้เลยนอกจากถอดไปแฟลชใหม่
  // (ส่งเป็นคำขอให้ task ทำ — การเปลี่ยนโหมด WiFi ต้องไม่ชนกับการต่อที่ task กำลังทำอยู่)
  void enableApNow() {
    if (_apUp) return;
    _reqAp = true;
  }
  bool apEnabled() const { return _apUp; }

  // เดิมต้องเรียกทุกรอบของ loop() — ตอนนี้ portal เดินใน task ของตัวเองแล้ว
  // ฟังก์ชันนี้จึงไม่ทำอะไร (เก็บไว้เป็นทางสำรองเผื่อสร้าง task ไม่สำเร็จ)
  void handle() {
    if (_task) return;
    _service();
  }

  bool isConnected() const { return WiFi.status() == WL_CONNECTED; }
  // รวมคำขอที่ task ยังไม่ได้หยิบไปทำด้วย — ผู้เรียกจะได้ไม่ไปสลับช่องแทรกในจังหวะนั้น
  bool isConnecting() const { return _connecting || _reqApply; }
  bool hasSaved() const { return _savedCount > 0; }

  // ---------- ใช้กับการส่ง WiFi ข้ามบอร์ดผ่าน ESP-NOW ----------
  // ฝั่งที่ "ให้" เรียกสองตัวนี้เพื่อหยิบค่าที่กำลังใช้อยู่จริงไปส่งต่อ
  String currentSsid() const {
    _Lock lock(_mtx);
    if (isConnected()) return WiFi.SSID();
    return _savedCount ? _ssid[0] : String();
  }
  String currentPass() const {
    _Lock lock(_mtx);
    String s = currentSsid();
    for (uint8_t i = 0; i < _savedCount; i++) if (_ssid[i] == s) return _pass[i];
    return String();
  }

  // ฝั่งที่ "รับ" เรียกตัวนี้ — task จะจำลง NVS แล้วลองต่อทันที
  // เรียกจาก loop() เท่านั้น ห้ามเรียกจาก callback ของ ESP-NOW
  void applyCredentials(const String& ssid, const String& pass) {
    if (ssid.length() == 0) return;
    _Lock lock(_mtx);
    _reqSsid  = ssid;
    _reqPass  = pass;
    _reqApply = true;
  }

  // ระหว่างช่วงที่ต้องการความแม่นยำของเวลา ให้เลื่อนงานหนัก (สแกน/ลองต่อใหม่) ออกไป
  // สแกน WiFi กินเวลาเป็นวินาทีและรบกวน ESP-NOW → ห้ามทำระหว่างจับเวลา
  void setTimingCritical(bool busy) { _timingCritical = busy; }

  String apSSID() const { return _apSsid; }
  IPAddress apIP()  const { return _apIP; }

  // ---------- NVS: รายการ WiFi ที่จดจำไว้ ----------
  void loadSaved() {
    _Lock lock(_mtx);
    _prefs.begin(TUG_PORTAL_NVS_NS, true);
    uint8_t cnt = _prefs.getUChar("cnt", 0);
    if (cnt > TUG_PORTAL_MAX_NETWORKS) cnt = 0;   // ข้อมูลเพี้ยน → ทิ้ง
    for (uint8_t i = 0; i < cnt; i++) {
      _ssid[i] = _prefs.getString(_key("s", i).c_str(), "");
      _pass[i] = _prefs.getString(_key("p", i).c_str(), "");
    }
    _prefs.end();

    // ตัดรายการที่ SSID ว่างทิ้ง (กันข้อมูลเสียหายทำให้วนต่อ WiFi ชื่อว่าง)
    uint8_t w = 0;
    for (uint8_t i = 0; i < cnt; i++) {
      if (_ssid[i].length() == 0) continue;
      _ssid[w] = _ssid[i]; _pass[w] = _pass[i]; w++;
    }
    _savedCount = w;
  }

  void saveAll() {
    _Lock lock(_mtx);
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
    _Lock lock(_mtx);
    // วงเดิมที่อยู่หัวรายการอยู่แล้วด้วยรหัสเดิม — ไม่ต้องเขียน flash ซ้ำ
    // (ต่อติดใหม่ทุกครั้งจะมาเรียกตรงนี้ ถ้าเขียนทุกครั้ง flash จะสึกโดยไม่จำเป็น)
    if (_savedCount > 0 && _ssid[0] == ssid && _pass[0] == pass) return;

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
    _Lock lock(_mtx);
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
  // ใครเป็นคนสั่งให้ลองต่อ — กำหนดว่าจะยอมให้ยกเลิกกลางคันได้ไหม และจะจำไว้หรือเปล่า
  enum class _Kind : uint8_t {
    Background,   // ระบบวนลองรายการที่จำไว้เอง — ยกเลิกได้ถ้ามีคนกำลังใช้หน้าตั้งค่า
    Applied,      // ได้ค่ามาจากบอร์ดเก้าอี้ทาง ESP-NOW
    Manual        // ผู้ใช้กดเชื่อมต่อจากหน้าเว็บ
  };

  // ล็อกแบบ RAII — ข้อมูลรายการ WiFi ถูกอ่านจากลูปหลัก และถูกแก้จาก task ของ portal
  struct _Lock {
    SemaphoreHandle_t m;
    explicit _Lock(SemaphoreHandle_t mm) : m(mm) { if (m) xSemaphoreTakeRecursive(m, portMAX_DELAY); }
    ~_Lock() { if (m) xSemaphoreGiveRecursive(m); }
  };

  WebServer   _server{80};
  DNSServer   _dns;
  Preferences _prefs;

  SemaphoreHandle_t _mtx  = nullptr;
  TaskHandle_t      _task = nullptr;

  String        _apSsid, _apPass, _device;
  IPAddress     _apIP;
  volatile bool _apUp = false;

  String  _ssid[TUG_PORTAL_MAX_NETWORKS];
  String  _pass[TUG_PORTAL_MAX_NETWORKS];
  uint8_t _savedCount = 0;   // ค่า 1 ไบต์ อ่านข้าม task ได้โดยไม่ขาดครึ่ง — แก้เฉพาะภายใต้ _mtx

  // --- คำขอจากลูปหลัก (task เป็นคนทำจริง) ---
  volatile bool _reqApply = false;
  volatile bool _reqAp    = false;
  String        _reqSsid, _reqPass;

  // --- สถานะการเชื่อมต่อ ---
  volatile bool _connecting     = false;
  _Kind         _kind           = _Kind::Background;
  int8_t        _autoIndex      = -1;      // กำลังลองวงไหนของรายการที่จำไว้
  String        _target, _pendingPass, _lastError;
  bool          _pendingSave    = false;
  unsigned long _attemptStart   = 0;
  unsigned long _lastRetry      = 0;
  unsigned long _retryGap       = TUG_PORTAL_RETRY_MS;
  volatile bool _timingCritical = false;

  // --- คนกำลังใช้หน้าตั้งค่าอยู่ไหม ---
  volatile unsigned long _lastApActivity = 0;   // มีเครื่องต่อเข้า AP / มี HTTP request ล่าสุด
  uint8_t       _apClients     = 0;
  unsigned long _apClientsAt   = 0;
  bool          _inUseLogged   = false;

  // --- สถานะการสแกน ---
  bool          _scanning      = false;
  String        _scanCache;
  unsigned long _lastStatusLog = 0;

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

  // ---------- task ----------
  static void _taskEntry(void* arg) {
    TUGWiFiPortal* self = static_cast<TUGWiFiPortal*>(arg);
    for (;;) {
      self->_service();
      vTaskDelay(pdMS_TO_TICKS(TUG_PORTAL_TICK_MS));
    }
  }

  void _service() {
#if TUG_PORTAL_DEBUG
    bool inUse = _apInUse();
    if (inUse != _inUseLogged) {
      _inUseLogged = inUse;
      Serial.println(inUse ? "  [Portal] มีคนใช้หน้าตั้งค่า — พักการลองต่อ WiFi เบื้องหลัง (AP นิ่งอยู่ช่องเดิม)"
                           : "  [Portal] ไม่มีคนใช้หน้าตั้งค่าแล้ว — กลับมาลองต่อ WiFi ตามรอบ");
    }
#endif
    _processRequests();
    if (_apUp) _dns.processNextRequest();   // core 3.x ตอบ DNS เองเบื้องหลังแล้ว (no-op) — core 2.x ต้องเรียก
    _server.handleClient();
    _tickScan();
    _tickConnect();
  }

  void _processRequests() {
    if (_reqAp) {
      _reqAp = false;
      if (!_apUp) {
        WiFi.mode(WIFI_AP_STA);
        _startAp();
      }
    }
    if (_reqApply) {
      String s, p;
      {
        // หยิบคำขอกับปลดธงในล็อกเดียวกัน — ถ้ามีคำขอใหม่ซ้อนเข้ามาหลังจากนี้ ธงจะถูกตั้งใหม่
        // และรอบหน้าจะหยิบไปทำต่อ ไม่หายกลางทาง
        _Lock lock(_mtx);
        s = _reqSsid;
        p = _reqPass;
        _reqSsid = _reqPass = "";
        _connecting = true;                  // ให้ isConnecting() เป็น true ต่อเนื่อง ไม่มีช่องว่าง
        _reqApply   = false;
      }
      rememberNetwork(s, p);
      _retryGap  = TUG_PORTAL_RETRY_MS;
      _autoIndex = 0;                        // ถ้าต่อไม่ติด ให้ไล่วงที่จำไว้วงถัดไปต่อ
      _startConnect(s, p, _Kind::Applied);
    }
  }

  void _startAp() {
    // รหัสผ่านสั้นกว่า 8 ตัว WPA2 ใช้ไม่ได้ → เปิดเป็นเครือข่ายเปิดแทน
    bool openAp = (_apPass.length() < 8);
    WiFi.softAP(_apSsid.c_str(), openAp ? nullptr : _apPass.c_str(), TUG_PORTAL_FALLBACK_CH);
    _apIP = WiFi.softAPIP();
#if TUG_PORTAL_DHCP_URI
    bool dhcpUri = WiFi.AP.enableDhcpCaptivePortal();   // ต้องเรียกหลัง softAP() เท่านั้น
  #if TUG_PORTAL_DEBUG
    Serial.println(dhcpUri ? "  [Portal] DHCP option 114 (captive URI) : ✅"
                           : "  [Portal] DHCP option 114 (captive URI) : ❌ ตั้งไม่สำเร็จ");
  #else
    (void)dhcpUri;
  #endif
#endif
    _dns.setErrorReplyCode(DNSReplyCode::NoError);
    _dns.start(53, "*", _apIP);      // ตอบทุกชื่อโดเมนด้วย IP ของบอร์ด
    _apUp = true;

    Serial.print  ("  [Portal] AP SSID : "); Serial.println(_apSsid);
    Serial.print  ("  [Portal] รหัสผ่าน : ");
    Serial.println(openAp ? "(ไม่มี — เครือข่ายเปิด)" : _apPass);
    Serial.print  ("  [Portal] เปิดหน้าตั้งค่าที่ http://"); Serial.println(_apIP);
  }

  // มีคนกำลังใช้หน้าตั้งค่าอยู่ไหม = มีเครื่องต่อ AP อยู่ และเพิ่งมีความเคลื่อนไหวไม่นาน
  // (ต้องมีเงื่อนไขเวลาด้วย: มือถือบางเครื่องต่อ AP นี้ค้างไว้เฉย ๆ ถ้าดูแค่จำนวนเครื่อง
  //  บอร์ดจะไม่ยอมกลับไปต่อ WiFi จริงอีกเลย)
  bool _apInUse() {
    if (!_apUp) return false;
    unsigned long now = millis();
    if (now - _apClientsAt >= 250) {          // ถามจำนวนเครื่องไม่เกิน 4 ครั้ง/วิ
      _apClientsAt = now;
      _apClients   = WiFi.softAPgetStationNum();
    }
    return _apClients > 0 && (now - _lastApActivity < TUG_PORTAL_AP_HOLD_MS);
  }

  void _touch() { _lastApActivity = millis(); }

  // พิมพ์ request ที่เข้ามา — บอกได้ว่ามือถือเช็ค captive portal แล้วหรือยัง และเปิดหน้าไหน
  void _logReq() {
#if TUG_PORTAL_DEBUG
    Serial.printf("  [Portal/HTTP] %s http://%s%s\n",
                  _server.method() == HTTP_POST ? "POST" : "GET",
                  _server.hostHeader().c_str(), _server.uri().c_str());
#endif
  }

  // ---------- การเชื่อมต่อ (ไม่บล็อก) ----------
  void _beginAttempt(int8_t savedIndex) {
    String s, p;
    {
      _Lock lock(_mtx);
      if (savedIndex < 0 || savedIndex >= (int8_t)_savedCount) return;
      s = _ssid[savedIndex];
      p = _pass[savedIndex];
    }
    _autoIndex = savedIndex;
    _startConnect(s, p, _Kind::Background);
  }

  void _startConnect(const String& ssid, const String& pass, _Kind kind) {
    if (_scanning) { WiFi.scanDelete(); _scanning = false; }

    _target       = ssid;
    _pendingPass  = pass;
    _kind         = kind;
    _connecting   = true;
    _attemptStart = millis();
    _lastError    = "";

    WiFi.disconnect(false, false);
    WiFi.begin(ssid.c_str(), pass.length() ? pass.c_str() : nullptr);

    Serial.print("  [Portal] กำลังเชื่อมต่อ: ");
    Serial.println(ssid);
  }

  // เลิกลองต่อกลางคัน — หยุดการสแกนของวิทยุทันที AP จะกลับมานิ่งที่ช่องเดิม
  void _cancelAttempt() {
    WiFi.disconnect(false, false);
    _connecting = false;
    _autoIndex  = -1;
    _lastRetry  = millis();
  }

  void _tickConnect() {
    if (_connecting) {
      if (WiFi.status() == WL_CONNECTED) {
        _connecting = false;
        _lastError  = "";
        if (_pendingSave || _kind != _Kind::Manual) {
          // วงที่ต่อสำเร็จจะถูกเลื่อนขึ้นหัวรายการเสมอ (รวมถึงวงที่จำไว้อยู่แล้ว)
          rememberNetwork(_target, _pendingPass);
        }
        _pendingSave = false;
        _autoIndex   = -1;
        _retryGap    = TUG_PORTAL_RETRY_MS;

        Serial.println();
        Serial.print("  [Portal] เชื่อมต่อสำเร็จ: "); Serial.println(_target);
        Serial.print("  [Portal] IP: ");   Serial.println(WiFi.localIP());
        Serial.print("  [Portal] Ch: ");   Serial.print(WiFi.channel());
        Serial.print("  RSSI: ");          Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
        return;
      }

      // ระบบกำลังไล่ลองเองอยู่ แต่มีคนเข้ามาใช้หน้าตั้งค่า — ยกเลิกให้ AP นิ่ง
      // (การลองของผู้ใช้เองหรือค่าที่ได้จากเก้าอี้ ปล่อยให้ทำจนจบ)
      if (_kind == _Kind::Background && _apInUse()) {
        _cancelAttempt();
        Serial.println("  [Portal] มีคนใช้หน้าตั้งค่าอยู่ — พักการลองต่อ WiFi เบื้องหลัง");
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
      if (_kind != _Kind::Manual && _autoIndex >= 0 &&
          _autoIndex + 1 < (int8_t)_savedCount) {
        _beginAttempt(_autoIndex + 1);
      } else {
        _autoIndex = -1;
        // ลองครบทุกวงแล้วไม่ติด — ยืดระยะรอบถัดไป (20 → 40 → 60 วิ)
        // สถานที่ใหม่ที่ไม่มีวงไหนอยู่เลย วิทยุจะได้ไม่สแกนถี่จน AP ใช้งานยาก
        if (_kind != _Kind::Manual) {
          _retryGap = min((unsigned long)TUG_PORTAL_RETRY_MAX_MS, _retryGap * 2);
          // ถือโอกาสอัปเดตรายการเครือข่ายตอนนี้ — วิทยุเพิ่งสแกนไล่ช่องไปอยู่แล้ว และยังไม่มีใครใช้หน้าตั้งค่า
          // คนที่ต่อเข้ามาทีหลังจะได้เห็นรายการที่สดโดยไม่ต้องสแกนตอนเปิดหน้า
          if (_apUp && !_apInUse() && !_timingCritical) _startScan();
        }
      }
      return;
    }

    // --- ไม่ได้ต่ออยู่และไม่ได้กำลังต่อ → วนลองรายการที่จำไว้ใหม่เป็นระยะ ---
    // ครั้งแรกหลังหลุดจะลองทันที เพราะ _lastRetry เก่ามากตั้งแต่ตอนที่ยังต่ออยู่
    if (WiFi.status() == WL_CONNECTED || _savedCount == 0) return;
    if (_timingCritical || _apInUse()) return;
    if (millis() - _lastRetry < _retryGap) return;
    _lastRetry = millis();
    _beginAttempt(0);
  }

  // ---------- การสแกน (async) ----------
  void _startScan() {
    if (_scanning || _timingCritical) return;
    if (_connecting) {
      if (_kind != _Kind::Background) return;   // ผู้ใช้กำลังต่ออยู่ ห้ามแทรก
      _cancelAttempt();                         // ผู้ใช้อยากเห็นรายการ สำคัญกว่าการลองเบื้องหลัง
    }
    WiFi.scanDelete();
    WiFi.scanNetworks(true /* async */, false /* ไม่แสดง SSID ที่ซ่อน */, false,
                      TUG_PORTAL_SCAN_MS_PER_CH);
    _scanning = true;
  }

  void _tickScan() {
    if (!_scanning) return;
    int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_RUNNING) return;
    _scanning = false;
    _buildScanCache(n);
  }

  // สร้าง JSON รายการเครือข่ายจากผลสแกนล่าสุด แล้วคืนหน่วยความจำของผลสแกน
  // ผลสแกนเรียงจากสัญญาณแรงสุดอยู่แล้ว — ชื่อซ้ำ (router mesh / หลายตัวปล่อยชื่อเดียวกัน)
  // จึงเก็บไว้แค่ตัวแรกซึ่งแรงที่สุด
  void _buildScanCache(int n) {
    String j = "{\"scanning\":false,\"nets\":[";
    if (n > 0) {
      int shown = 0;
      for (int i = 0; i < n && shown < 25; i++) {
        String s = WiFi.SSID(i);
        if (s.length() == 0) continue;             // ข้าม SSID ที่ซ่อนไว้
        if (s == _apSsid)    continue;             // ไม่ต้องโชว์ AP ของตัวเอง
        String key = "{\"ssid\":\"" + _esc(s) + "\"";
        if (j.indexOf(key) >= 0) continue;         // ชื่อซ้ำ
        if (shown++) j += ',';
        j += key + ",\"rssi\":" + String(WiFi.RSSI(i)) +
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
    _Lock lock(_mtx);
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

  void _noStore() { _server.sendHeader("Cache-Control", "no-store"); }

  void _routes() {
    _server.on("/", HTTP_GET, [this]() {
      _touch();
      _logReq();
      _noStore();
#if TUG_PORTAL_WITH_HTML
      _server.send_P(200, "text/html; charset=utf-8", TUG_PORTAL_HTML);
#else
      // บอร์ดนี้ไม่มีหน้าตั้งค่า (รับ WiFi มาทาง ESP-NOW) — ยังตอบ /api/status ได้ตามปกติ
      _server.send(200, "text/plain; charset=utf-8",
                   "TUG device: WiFi is provisioned from the chair board.");
#endif
    });

    _server.on("/api/status", HTTP_GET, [this]() {
      _touch();
      // หน้าเว็บ poll ทุก 4 วิ — log ห่าง ๆ พอให้รู้ว่าหน้ายังเปิดค้างอยู่บนมือถือ
      if (millis() - _lastStatusLog >= 15000) { _lastStatusLog = millis(); _logReq(); }
      _noStore();
      _server.send(200, "application/json", _statusJson());
    });

    _server.on("/api/scan", HTTP_GET, [this]() {
      _touch();
      _logReq();
      bool refresh = _server.hasArg("refresh");
      // สแกนใหม่เฉพาะเมื่อผู้ใช้กดเอง หรือยังไม่มีผลเลย — ไม่สแกนเองเพียงเพราะผลเก่า
      // เพราะตอนนี้มีมือถือต่อ AP อยู่แน่ ๆ การสแกนจะทำให้มือถือเครื่องนั้นหลุดชั่วครู่
      if (!_scanning && (refresh || _scanCache.length() == 0)) _startScan();

      _noStore();
      if (_scanning) {
        _server.send(200, "application/json", "{\"scanning\":true,\"nets\":[]}");
      } else if (_timingCritical && (refresh || _scanCache.length() == 0)) {
        // บอร์ดกำลังจับเวลาการทดสอบ — สแกนไม่ได้ตอนนี้ บอกหน้าเว็บให้แจ้งผู้ใช้
        _server.send(200, "application/json", "{\"scanning\":false,\"busy\":true,\"nets\":[]}");
      } else if (_scanCache.length()) {
        _server.send(200, "application/json", _scanCache);
      } else {
        _server.send(200, "application/json", "{\"scanning\":false,\"nets\":[]}");
      }
    });

    _server.on("/api/connect", HTTP_POST, [this]() {
      _touch();
      _logReq();
      String ssid = _server.arg("ssid");
      String pw   = _server.arg("password");
      if (ssid.length() == 0) {
        _server.send(400, "application/json",
                     "{\"ok\":false,\"error\":\"missing ssid\"}");
        return;
      }
      _pendingSave = (_server.arg("save") != "0");
      // ตอบกลับก่อน แล้วค่อยเริ่มต่อ — ไม่งั้น client จะค้างรอตอน WiFi สะดุด
      _server.send(200, "application/json", "{\"ok\":true}");
      _autoIndex = -1;
      _retryGap  = TUG_PORTAL_RETRY_MS;
      _startConnect(ssid, pw, _Kind::Manual);
    });

    _server.on("/api/forget", HTTP_POST, [this]() {
      _touch();
      String ssid = _server.arg("ssid");
      forgetNetwork(ssid);
      _server.send(200, "application/json", "{\"ok\":true}");
      Serial.print("  [Portal] ลบเครือข่ายที่จำไว้: "); Serial.println(ssid);
    });

    // ไม่มีไอคอน — ตอบว่างทันที ไม่ต้องเสียรอบ redirect
    _server.on("/favicon.ico", [this]() { _server.send(204); });

    // ---------- Captive portal ----------
    // ระบบปฏิบัติการแต่ละค่ายเช็ค "มีเน็ตไหม" ด้วย URL ต่างกัน
    // ถ้าเราตอบ redirect กลับมาที่หน้าเรา มันจะเด้ง popup ให้เองเหมือน WiFi โรงแรม
    auto redirect = [this]() {
      _touch();
      _logReq();
      _noStore();
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
