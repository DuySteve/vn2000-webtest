/**
 * utils.js — VN2000 Web App
 * Tiện ích: clipboard, history, CSV, toast, share URL
 */

/* ── TOAST ── */
function showToast(msg, type, dur) {
  type = type || 'info'; dur = dur || 2800;
  var c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(c);
  }
  var colors = { success:'#00C896', error:'#FF4757', info:'#4ECDC4', warning:'#FFD700' };
  var icons  = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
  var t = document.createElement('div');
  t.style.cssText = 'background:#1a2035;border:1px solid '+colors[type]+'55;border-left:4px solid '+colors[type]+
    ';color:#e0e0e0;padding:12px 16px;border-radius:8px;font-family:Inter,sans-serif;font-size:14px;'+
    'max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:8px;animation:slideInRight .3s ease;transition:opacity .3s';
  t.innerHTML = '<span>'+icons[type]+'</span><span>'+msg+'</span>';
  c.appendChild(t);
  setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove(); },300); }, dur);
}

/* ── CLIPBOARD ── */
function copyToClipboard(text, msg) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function(){ showToast(msg||'Đã sao chép!','success'); });
  } else {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); showToast(msg||'Đã sao chép!','success');
  }
}

/* ── SHARE URL ── */
function buildShareURL(lat, lon, cm) {
  var url = new URL(window.location.href);
  url.searchParams.set('lat', lat.toFixed(7));
  url.searchParams.set('lon', lon.toFixed(7));
  if (cm) url.searchParams.set('cm', cm);
  return url.toString();
}

function readShareURL() {
  var p = new URLSearchParams(window.location.search);
  var lat = parseFloat(p.get('lat')), lon = parseFloat(p.get('lon')), cm = parseFloat(p.get('cm'));
  if (!isNaN(lat) && !isNaN(lon)) return { lat:lat, lon:lon, cm: isNaN(cm)?null:cm };
  return null;
}

/* ── HISTORY ── */
var HISTORY_KEY = 'vn2000_history';
var MAX_HISTORY = 20;

function saveHistory(entry) {
  var h = loadHistory();
  h.unshift(Object.assign({}, entry, { timestamp: new Date().toISOString(), id: Date.now() }));
  if (h.length > MAX_HISTORY) h.splice(MAX_HISTORY);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch(e){}
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch(e){ return []; }
}

function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch(e){}
}

function deleteHistoryItem(id) {
  var h = loadHistory().filter(function(x){ return x.id !== id; });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch(e){}
}

/* ── CSV EXPORT ── */
function exportCSV(rows, filename) {
  filename = filename || 'vn2000_export.csv';
  if (!rows || !rows.length) { showToast('Không có dữ liệu','error'); return; }
  var bom = '\uFEFF';
  var lines = ['STT,Tỉnh/Thành,Kinh tuyến trục,X (m),Y (m),Lat (WGS84),Lon (WGS84),Ghi chú'];
  rows.forEach(function(r,i){
    lines.push([i+1,'"'+(r.province||'')+'"',r.cm||'',r.x||'',r.y||'',r.lat||'',r.lon||'','"'+(r.note||'')+'"'].join(','));
  });
  var blob = new Blob([bom+lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Đã xuất '+rows.length+' bản ghi','success');
}

/* ── CSV IMPORT (PapaParse) ── */
function parseCSVFile(file, callback) {
  Papa.parse(file, {
    header: true, skipEmptyLines: true, encoding: 'UTF-8',
    complete: function(res) {
      var rows = res.data.map(function(row){
        var n = {};
        Object.keys(row).forEach(function(k){ n[k.toLowerCase().trim()] = (row[k]||'').trim(); });
        return {
          x:   parseFloat(n['x'] || n['easting'] || ''),
          y:   parseFloat(n['y'] || n['northing'] || ''),
          lat: parseFloat(n['lat'] || n['latitude'] || ''),
          lon: parseFloat(n['lon'] || n['longitude'] || ''),
          note: n['ghi chú'] || n['note'] || n['label'] || ''
        };
      }).filter(function(r){ return (!isNaN(r.x)&&!isNaN(r.y)) || (!isNaN(r.lat)&&!isNaN(r.lon)); });
      callback(null, rows);
    },
    error: function(e){ callback(e); }
  });
}

function downloadCSVTemplate() {
  var bom = '\uFEFF';
  var content = 'X,Y,Ghi chú\n588848.123,2321456.789,Điểm mốc A\n591234.567,2319876.543,Điểm mốc B';
  var blob = new Blob([bom+content], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url; a.download='mau_toa_do.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── DEBOUNCE ── */
function debounce(fn, delay) {
  var t; return function(){
    var args = arguments; clearTimeout(t);
    t = setTimeout(function(){ fn.apply(null,args); }, delay);
  };
}

/* ── FORMAT TIMESTAMP ── */
function formatTimestamp(iso) {
  return new Date(iso).toLocaleString('vi-VN', {
    day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
  });
}
