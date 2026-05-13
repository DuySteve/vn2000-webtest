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
  var t = document.createElement('div');
  t.style.cssText = 'background:#1a2035;border:1px solid '+colors[type]+'55;border-left:4px solid '+colors[type]+
    ';color:#e0e0e0;padding:12px 16px;border-radius:8px;font-family:Inter,sans-serif;font-size:14px;'+
    'max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:8px;animation:slideInRight .3s ease;transition:opacity .3s';
  t.innerHTML = '<span>'+msg+'</span>';
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

/* ── KML EXPORT ── */
function exportKML(features, filename) {
  filename = filename || 'vn2000_export.kml';
  var kml = ['<?xml version="1.0" encoding="UTF-8"?>'];
  kml.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  kml.push('  <Document>');
  kml.push('    <name>'+filename+'</name>');
  
  features.forEach(function(f, i) {
    kml.push('    <Placemark>');
    kml.push('      <name>'+(f.name || 'Điểm ' + (i+1))+'</name>');
    if (f.desc) kml.push('      <description><![CDATA['+f.desc+']]></description>');
    
    if (f.type === 'polygon' && f.points && f.points.length >= 3) {
      kml.push('      <Polygon><outerBoundaryIs><LinearRing><coordinates>');
      var coords = f.points.map(function(p){ return p.lon+','+p.lat+',0'; }).join(' ');
      // Close polygon
      coords += ' ' + f.points[0].lon+','+f.points[0].lat+',0';
      kml.push('        ' + coords);
      kml.push('      </coordinates></LinearRing></outerBoundaryIs></Polygon>');
    } else {
      kml.push('      <Point><coordinates>'+f.lon+','+f.lat+',0</coordinates></Point>');
    }
    kml.push('    </Placemark>');
  });
  
  kml.push('  </Document>');
  kml.push('</kml>');
  
  var blob = new Blob([kml.join('\n')], {type:'application/vnd.google-earth.kml+xml;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Đã xuất file KML','success');
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
