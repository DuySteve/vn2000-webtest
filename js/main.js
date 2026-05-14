/**
 * main.js — VN2000 Web App
 * Điều phối UI, kết nối tất cả modules (global scope)
 */

var state = {
  mode: 'vn2000-to-wgs84',
  zoneType: 'tm3',
  selectedProvince: null,
  lastLat: null, lastLon: null,
  lastX: null, lastY: null,
  batchResults: [],
  theme: localStorage.getItem('vn2000_theme') || 'light'
};

// Hướng dẫn dùng AI OCR qua Vercel/Cloudflare Serverless Function (Ví dụ dùng Groq Llama 3.2 Vision):
// 1. Deploy code Vercel (thư mục api/) hoặc Cloudflare Worker (thư mục cloudflare-worker/).
// 2. Cấu hình biến môi trường GROQ_API_KEY trên Vercel hoặc Cloudflare Dashboard.
// 3. Đổi OCR_API_URL = '/api/ocr'; (nếu frontend và API cùng host trên Vercel)
//    Hoặc OCR_API_URL = 'https://link-cloudflare-worker-hoac-vercel-cua-ban'; (nếu frontend vẫn ở GitHub Pages)
var OCR_API_URL = 'https://vn2000-webtest.vercel.app/api/ocr'; // Đã nối với Vercel (chạy API từ Mỹ)

function $(id) { return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', function() {
  applyTheme(state.theme);
  populateProvinceSelect();
  bindEvents();
  initMap('map-container', onMapClick);
  document.querySelector('.app-container').classList.add('entrance');
  initMobilePanel();
  // Auto-chọn Quảng Ninh (tỉnh ưu tiên) ngay khi tải trang
  autoSelectProvince('22');
});

/* ── THEME ── */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  var btn = $('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? 'Chế độ sáng' : 'Chế độ tối';
  localStorage.setItem('vn2000_theme', t);
}

/* ── PROVINCE SELECT ── */
function populateProvinceSelect() {
  var targets = [$('province-select'), $('sodo-province')];
  // Danh sách tỉnh ghim lên đầu (phục vụ chính tại Quảng Ninh)
  var PINNED_CODES = ['22'];
  var regions = {};
  PROVINCES.forEach(function(p) {
    if (!regions[p.region]) regions[p.region] = [];
    regions[p.region].push(p);
  });
  targets.forEach(function(sel) {
    if (!sel) return;
    sel.innerHTML = '<option value="">' + (sel.id==='sodo-province' ? '-- Chọn tỉnh/thành (lấy KTT) --' : '-- Chọn tỉnh/thành phố --') + '</option>';

    // Nhóm ưu tiên (ghim đầu)
    var pinnedProvinces = PROVINCES.filter(function(p) { return PINNED_CODES.indexOf(p.code) !== -1; });
    if (pinnedProvinces.length > 0) {
      var pinnedGrp = document.createElement('optgroup');
      pinnedGrp.label = '⭐ Khu vực chính';
      pinnedProvinces.forEach(function(p) {
        var o = document.createElement('option');
        o.value = p.code;
        o.dataset.cm = p.cm;
        o.dataset.utmZone = p.utmZone;
        o.textContent = p.fullName + ' (•' + p.cm + '°)';
        pinnedGrp.appendChild(o);
      });
      sel.appendChild(pinnedGrp);
    }

    // Các nhóm vùng miền còn lại
    Object.keys(regions).forEach(function(region) {
      var grp = document.createElement('optgroup');
      grp.label = region;
      regions[region].forEach(function(p) {
        var o = document.createElement('option');
        o.value = p.code;
        o.dataset.cm = p.cm;
        o.dataset.utmZone = p.utmZone;
        o.textContent = p.fullName + ' (•' + p.cm + '°)';
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
  });
}

/** Tự động chọn tỉnh theo code và kích hoạt các side-effect */
function autoSelectProvince(code) {
  var selMain = $('province-select');
  var selSodo = $('sodo-province');
  if (selMain) { selMain.value = code; onProvinceChange(); }
  if (selSodo) { selSodo.value = code; onSoDoProvinceChange(); }
}

/* ── EVENTS ── */
function bindEvents() {
  $('theme-toggle') && $('theme-toggle').addEventListener('click', function(){
    state.theme = state.theme==='dark'?'light':'dark'; applyTheme(state.theme);
  });

  $('swap-btn') && $('swap-btn').addEventListener('click', swapMode);
  $('convert-btn') && $('convert-btn').addEventListener('click', doConvert);
  $('province-select') && $('province-select').addEventListener('change', onProvinceChange);

  document.querySelectorAll('[name="zone-type"]').forEach(function(r) {
    r.addEventListener('change', function(e) {
      state.zoneType = e.target.value;
      $('tm3-options').style.display = e.target.value==='tm3'?'block':'none';
      $('utm-options').style.display  = e.target.value==='utm'?'block':'none';
    });
  });

  ['x-input','y-input','lat-input','lon-input'].forEach(function(id) {
    $(id) && $(id).addEventListener('keydown', function(e){ if(e.key==='Enter') doConvert(); });
  });

  $('copy-wgs84-btn') && $('copy-wgs84-btn').addEventListener('click', function(){
    if(state.lastLat===null){showToast('Chưa có kết quả','warning');return;}
    copyToClipboard(state.lastLat.toFixed(7)+', '+state.lastLon.toFixed(7),'Đã sao chép WGS84');
  });
  $('copy-vn2000-btn') && $('copy-vn2000-btn').addEventListener('click', function(){
    if(state.lastX===null){showToast('Chưa có kết quả','warning');return;}
    copyToClipboard('X: '+formatCoordNum(state.lastX,3)+', Y: '+formatCoordNum(state.lastY,3),'Đã sao chép VN2000');
  });

  $('locate-btn') && $('locate-btn').addEventListener('click', function(){
    showToast('Đang xác định GPS...','info');
    locateUser(function(lat,lon){ $('lat-input').value=lat.toFixed(7); $('lon-input').value=lon.toFixed(7); });
  });

  $('import-csv-btn') && $('import-csv-btn').addEventListener('click', function(){ $('csv-file-input').click(); });
  $('csv-file-input') && $('csv-file-input').addEventListener('change', onCSVImport);
  $('export-csv-btn') && $('export-csv-btn').addEventListener('click', onCSVExport);
  $('export-kml-batch-btn') && $('export-kml-batch-btn').addEventListener('click', onKmlExportBatch);
  $('download-template-btn') && $('download-template-btn').addEventListener('click', downloadCSVTemplate);

  document.querySelectorAll('[data-tab]').forEach(function(btn){
    btn.addEventListener('click', function(){ switchTab(btn.dataset.tab); });
  });

  /* Sổ Đỏ events */
  initSoDo();
  $('sodo-add-point')  && $('sodo-add-point').addEventListener('click', function() { addSoDoPoint(); });
  $('sodo-ocr-btn')    && $('sodo-ocr-btn').addEventListener('click', function() { $('sodo-ocr-input').click(); });
  $('sodo-ocr-input')  && $('sodo-ocr-input').addEventListener('change', onSoDoOcrUpload);
  $('sodo-draw-btn')   && $('sodo-draw-btn').addEventListener('click', drawSoDo);
  $('sodo-clear-btn')  && $('sodo-clear-btn').addEventListener('click', function(){ clearSoDo(); showToast('Đã xóa thửa đất','info'); });
  $('sodo-copy-btn')   && $('sodo-copy-btn').addEventListener('click', copySoDoResult);
  $('sodo-kml-btn')    && $('sodo-kml-btn').addEventListener('click', onKmlExportSodo);
  $('sodo-province')   && $('sodo-province').addEventListener('change', onSoDoProvinceChange);
  /* Sync province selection: main ↔ sodo (hai chiều) */
  $('province-select') && $('province-select').addEventListener('change', function() {
    var sel = $('province-select'), sp = $('sodo-province');
    if (sel && sp && sel.value) sp.value = sel.value;
    onSoDoProvinceChange();
  });
  $('sodo-province') && $('sodo-province').addEventListener('change', function() {
    var sel = $('province-select'), sp = $('sodo-province');
    if (sel && sp && sp.value) sel.value = sp.value;
    onProvinceChange();
  });
}

/* ── PROVINCE CHANGE ── */
function onProvinceChange() {
  var sel = $('province-select');
  var opt = sel && sel.selectedOptions[0];
  if (!opt || !opt.value) return;
  state.selectedProvince = getProvinceByCode(opt.value);
  var cm = parseFloat(opt.dataset.cm);
  if ($('cm-input')) $('cm-input').value = cm;
  var disp = $('cm-display');
  if (disp) { disp.textContent = '🎯 Kinh tuyến trục: ' + cm + '°'; disp.style.display='flex'; }
  if (state.selectedProvince && state.selectedProvince.center) {
    flyToLocation(state.selectedProvince.center[0], state.selectedProvince.center[1], 9);
  }
}

/* ── SWAP ── */
function swapMode() {
  state.mode = state.mode==='vn2000-to-wgs84' ? 'wgs84-to-vn2000' : 'vn2000-to-wgs84';
  var lbl = $('mode-label');
  if (lbl) lbl.textContent = state.mode==='vn2000-to-wgs84' ? 'VN2000 → WGS84' : 'WGS84 → VN2000';
  $('vn2000-input-section') && $('vn2000-input-section').classList.toggle('hidden', state.mode!=='vn2000-to-wgs84');
  $('wgs84-input-section')  && $('wgs84-input-section').classList.toggle('hidden',  state.mode!=='wgs84-to-vn2000');
  $('result-section') && $('result-section').classList.add('hidden');
  showToast(state.mode==='vn2000-to-wgs84'?'VN2000 → WGS84':'WGS84 → VN2000','info');
}

/* ── CONVERT ── */
function doConvert() {
  clearErrors();
  var cm = parseFloat($('cm-input') && $('cm-input').value);
  var utmZone = state.selectedProvince ? state.selectedProvince.utmZone : 48;

  try {
    if (state.mode === 'vn2000-to-wgs84') {
      var xRaw = ($('x-input').value||'').trim().replace(/\s/g,'');
      var yRaw = ($('y-input').value||'').trim().replace(/\s/g,'');
      var x = parseFloat(xRaw), y = parseFloat(yRaw);
      var errs = validateVN2000(x, y);
      if (errs.length) { showFieldError('vn2000-error', errs.join('; ')); return; }
      var res;
      if (state.zoneType==='tm3') {
        if (isNaN(cm)) { showFieldError('vn2000-error','Vui lòng chọn tỉnh/thành hoặc nhập KTT'); return; }
        res = vn2000TM3ToWGS84(x, y, cm);
      } else {
        res = vn2000UTMToWGS84(x, y, utmZone);
      }
      showWGS84Result(res.lat, res.lon);
    } else {
      var lat = parseCoordString($('lat-input').value, 'lat');
      var lon = parseCoordString($('lon-input').value, 'lon');
      if (lat===null||lon===null) { showFieldError('wgs84-error','Không đọc được tọa độ'); return; }
      var errs2 = validateWGS84(lat, lon);
      if (errs2.length) { showFieldError('wgs84-error', errs2.join('; ')); return; }
      var res2;
      if (state.zoneType==='tm3') {
        if (isNaN(cm)) { showFieldError('wgs84-error','Vui lòng chọn tỉnh/thành hoặc nhập KTT'); return; }
        res2 = wgs84ToVN2000TM3(lat, lon, cm);
      } else {
        res2 = wgs84ToVN2000UTM(lat, lon, utmZone);
      }
      showVN2000Result(res2.x, res2.y);
      updateMap(lat, lon, cm);
    }
  } catch(e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

function showWGS84Result(lat, lon) {
  state.lastLat=lat; state.lastLon=lon;
  var latDMS=ddToDMS(lat,'lat'), lonDMS=ddToDMS(lon,'lon');
  setText('result-lat-dd', lat.toFixed(7));
  setText('result-lon-dd', lon.toFixed(7));
  setText('result-lat-dms', latDMS.formatted);
  setText('result-lon-dms', lonDMS.formatted);
  $('wgs84-result-card') && $('wgs84-result-card').classList.remove('hidden');
  $('vn2000-result-card') && $('vn2000-result-card').classList.add('hidden');
  $('result-section') && $('result-section').classList.remove('hidden');
  var gml = $('google-maps-link');
  if (gml) { gml.href='https://www.google.com/maps?q='+lat+','+lon; gml.classList.remove('hidden'); }
  var cm = parseFloat($('cm-input').value);
  updateMap(lat, lon, isNaN(cm)?null:cm);
}

function showVN2000Result(x, y) {
  state.lastX=x; state.lastY=y;
  setText('result-x', formatCoordNum(x,3)+' m');
  setText('result-y', formatCoordNum(y,3)+' m');
  $('vn2000-result-card') && $('vn2000-result-card').classList.remove('hidden');
  $('wgs84-result-card') && $('wgs84-result-card').classList.add('hidden');
  $('result-section') && $('result-section').classList.remove('hidden');
}

function setText(id, v) { var el=$(id); if(el) el.textContent=v; }

function updateMap(lat, lon, cm) {
  placeMapMarker(lat, lon, cm, state.selectedProvince ? state.selectedProvince.name : null);
  flyToLocation(lat, lon, 13);
}

/* ── MAP CLICK ── */
function onMapClick(lat, lon) {
  if ($('lat-input')) $('lat-input').value = lat.toFixed(7);
  if ($('lon-input')) $('lon-input').value = lon.toFixed(7);
  showToast('Tọa độ: '+lat.toFixed(5)+', '+lon.toFixed(5),'success');
}

/* ── CSV ── */
function onCSVImport(e) {
  var file = e.target && e.target.files && e.target.files[0]; if(!file) return;
  var cm = parseFloat($('cm-input') && $('cm-input').value);
  if(isNaN(cm)){ showToast('Vui lòng chọn tỉnh/thành trước','warning'); e.target.value=''; return; }
  showToast('Đang xử lý CSV...','info');
  parseCSVFile(file, function(err, rows){
    if(err){ showToast('Lỗi đọc file: '+err.message,'error'); return; }
    if(!rows.length){ showToast('File không hợp lệ','error'); return; }
    var results=[], pts=[];
    rows.forEach(function(r,i){
      try {
        if(!isNaN(r.x)&&!isNaN(r.y)){
          var c=vn2000TM3ToWGS84(r.x,r.y,cm);
          results.push(Object.assign({},r,{lat:c.lat,lon:c.lon,cm:cm,province:state.selectedProvince&&state.selectedProvince.name}));
          pts.push({lat:c.lat,lon:c.lon,label:r.note||'Điểm '+(i+1)});
        } else if(!isNaN(r.lat)&&!isNaN(r.lon)){
          var c2=wgs84ToVN2000TM3(r.lat,r.lon,cm);
          results.push(Object.assign({},r,{x:c2.x,y:c2.y,cm:cm,province:state.selectedProvince&&state.selectedProvince.name}));
          pts.push({lat:r.lat,lon:r.lon,label:r.note||'Điểm '+(i+1)});
        }
      } catch(ex){}
    });
    state.batchResults = results;
    addBatchMarkers(pts);
    renderBatchTable(results);
    switchTab('batch');
    showToast('Đã xử lý '+results.length+'/'+rows.length+' điểm','success');
    e.target.value='';
  });
}

function renderBatchTable(rows) {
  var tbody = $('batch-table') && $('batch-table').querySelector('tbody'); if(!tbody) return;
  if(!rows.length){ tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">Không có dữ liệu</td></tr>'; return; }
  tbody.innerHTML = rows.map(function(r,i){
    return '<tr><td>'+(i+1)+'</td><td>'+formatCoordNum(r.x||0,3)+'</td><td>'+formatCoordNum(r.y||0,3)+'</td>'+
      '<td>'+(r.lat||0).toFixed(7)+'</td><td>'+(r.lon||0).toFixed(7)+'</td><td>'+(r.note||'')+'</td></tr>';
  }).join('');
}

function onCSVExport() {
  if(!state.batchResults.length){ showToast('Chưa có dữ liệu batch','warning'); return; }
  exportCSV(state.batchResults, 'vn2000_ket_qua.csv');
}

function onKmlExportBatch() {
  if (!state.batchResults || !state.batchResults.length) {
    showToast('Không có dữ liệu để xuất KML', 'warning');
    return;
  }
  var features = state.batchResults.map(function(r, i) {
    return {
      type: 'point',
      lat: r.lat,
      lon: r.lon,
      name: r.note || ('Điểm ' + (i+1)),
      desc: 'VN2000 X: ' + (r.x||'') + '<br>VN2000 Y: ' + (r.y||'')
    };
  });
  exportKML(features, 'vn2000_points.kml');
}

function onKmlExportSodo() {
  if (!state.currentSoDoResult || !state.currentSoDoResult.points || state.currentSoDoResult.points.length < 3) {
    showToast('Vui lòng vẽ thửa đất (tối thiểu 3 điểm) trước', 'warning');
    return;
  }
  var r = state.currentSoDoResult;
  var features = [];
  
  // 1. Add polygon
  features.push({
    type: 'polygon',
    points: r.points.map(function(p){ return {lat: p.lat, lon: p.lon}; }),
    name: $('sodo-label') ? ($('sodo-label').value || 'Thửa đất') : 'Thửa đất',
    desc: 'Diện tích: ' + r.area.toFixed(2) + ' m²<br>Chu vi: ' + r.perimeter.toFixed(2) + ' m'
  });
  
  // 2. Add individual points
  r.points.forEach(function(p, i) {
    features.push({
      type: 'point',
      lat: p.lat,
      lon: p.lon,
      name: 'Điểm ' + (i+1),
      desc: 'X: ' + p.x + '<br>Y: ' + p.y
    });
  });
  
  exportKML(features, 'vn2000_sodo.kml');
}

/* ── SỔ ĐỎ (LAND PLOT) ── */
function switchTab(id) {
  document.querySelectorAll('.tab-content').forEach(function(el){ el.classList.remove('active'); });
  document.querySelectorAll('[data-tab]').forEach(function(btn){ btn.classList.remove('active'); });
  $('tab-'+id) && $('tab-'+id).classList.add('active');
  var tb=document.querySelector('[data-tab="'+id+'"]');
  if(tb) tb.classList.add('active');
}

/* ── SHARE URL ── */
function handleShareURL() {
  var sh = readShareURL(); if(!sh) return;
  if($('lat-input')) $('lat-input').value = sh.lat.toFixed(7);
  if($('lon-input')) $('lon-input').value = sh.lon.toFixed(7);
  if(sh.cm && $('cm-input')) $('cm-input').value = sh.cm;
  if(state.mode!=='wgs84-to-vn2000') swapMode();
  setTimeout(function(){ flyToLocation(sh.lat,sh.lon,13); placeMapMarker(sh.lat,sh.lon,sh.cm,null); }, 800);
  showToast('📎 Đã tải tọa độ từ link chia sẻ','info');
}

/* ── HELPERS ── */
function clearErrors() {
  document.querySelectorAll('.field-error').forEach(function(el){ el.textContent=''; el.classList.remove('visible'); });
}
function showFieldError(id, msg) {
  var el=$(id); if(el){ el.textContent=msg; el.classList.add('visible'); }
  showToast(msg,'error');
}

/* ═══════════════════════════════════════════════
   SỔ ĐỎ — LAND PLOT TOOL
   ═══════════════════════════════════════════════ */
var _soDoPointCount = 0;
var _soDoResult = null;

function initSoDo() {
  var list = $('sodo-points-list'); if(!list) return;
  list.innerHTML = '';
  _soDoPointCount = 0;
  /* Add 4 default points (minimum for a parcel) */
  for(var i=0;i<4;i++) addSoDoPoint();
}

function addSoDoPoint(xVal, yVal) {
  _soDoPointCount++;
  var n = _soDoPointCount;
  var list = $('sodo-points-list'); if(!list) return;
  var row = document.createElement('div');
  row.className = 'sodo-point-row';
  row.dataset.idx = n;
  row.innerHTML =
    '<div class="sodo-point-label">P'+n+'</div>'+
    '<div class="sodo-point-inputs">'+
      '<input type="text" class="input-field input-mono sodo-x" placeholder="X (Northing)" title="X = Northing, VD: 2363228" value="'+(xVal||'')+'" />'+
      '<input type="text" class="input-field input-mono sodo-y" placeholder="Y (Easting)"  title="Y = Easting,  VD: 520031" value="'+(yVal||'')+'" />'+
    '</div>'+
    '<button class="sodo-remove-btn" title="Xóa điểm">✕</button>';
  list.appendChild(row);
  row.querySelector('.sodo-remove-btn').addEventListener('click', function(){
    row.remove();
  });
  /* Enter to jump to next field */
  row.querySelectorAll('input').forEach(function(inp,i){
    inp.addEventListener('keydown', function(e){
      if(e.key==='Enter'){
        var inputs=list.querySelectorAll('input');
        var cur=Array.from(inputs).indexOf(inp);
        if(cur<inputs.length-1) inputs[cur+1].focus();
        else drawSoDo();
      }
    });
  });
}

/* ── SỔ ĐỎ OCR ── */

/* ── Tesseract Worker Singleton ── */
var _ocrWorker = null;
var _ocrWorkerReady = false;

async function getOcrWorker() {
  if (_ocrWorker && _ocrWorkerReady) return _ocrWorker;
  if (!window.Tesseract) throw new Error('Thư viện OCR chưa tải xong, vui lòng thử lại!');
  _ocrWorker = await Tesseract.createWorker('eng');
  _ocrWorkerReady = true;
  return _ocrWorker;
}

/* Tiền khởi tạo worker sau 2s khi trang load */
window.addEventListener('load', function() {
  setTimeout(function() { getOcrWorker().catch(function(){}); }, 2000);
});

/**
 * Phát hiện góc nghiêng của tài liệu bằng Horizontal Projection Profile.
 * Sử dụng ảnh đã binarize (mảng gray), subsample 1/4 để chạy nhanh trên mobile.
 */
function detectSkewAngle(gray, w, h) {
  var step = 4; // subsample mỗi 4 pixel để tăng tốc ~16x
  var testAngles = [-8, -6, -4, -2, -1, 0, 1, 2, 4, 6, 8];
  var cx = w >> 1, cy = h >> 1;
  var bestAngle = 0, bestScore = -1;

  testAngles.forEach(function(deg) {
    var rad = deg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var sh = Math.ceil(h / step);
    var proj = new Int32Array(sh);

    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        // Xoay ngược chiều để "thử thẳng" ảnh
        var rx = Math.round((x - cx) * cos + (y - cy) * sin + cx);
        var ry = Math.round(-(x - cx) * sin + (y - cy) * cos + cy);
        if (rx >= 0 && rx < w && ry >= 0 && ry < h) {
          if (gray[ry * w + rx] < 128) proj[Math.floor(y / step)]++;
        }
      }
    }

    // Tính variance của horizontal projection — góc đúng tạo ra variance cao nhất
    var mean = 0, i;
    for (i = 0; i < sh; i++) mean += proj[i];
    mean /= sh;
    var score = 0;
    for (i = 0; i < sh; i++) score += (proj[i] - mean) * (proj[i] - mean);

    if (score > bestScore) { bestScore = score; bestAngle = deg; }
  });

  return bestAngle;
}

/**
 * Adaptive Binarization + Deskew
 * 1. Scale ảnh lên 2000px
 * 2. Grayscale
 * 3. Bradley-Roth adaptive threshold
 * 4. Phát hiện và chỉnh góc nghiêng
 */
function preprocessImageForOCR(file) {
  return new Promise(function(resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(url);
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');

      var targetW = 2000;
      var scale = img.width < targetW ? (targetW / img.width) : 1;
      if (img.width * scale > 3000) scale = 3000 / img.width;

      canvas.width  = Math.floor(img.width  * scale);
      canvas.height = Math.floor(img.height * scale);

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var data = imageData.data;
      var w = canvas.width, h = canvas.height;

      // ── B1: Phát hiện màu nền ──
      // Sample toàn bộ VIỀN ảnh (không chỉ 4 góc) để chống sai khi ảnh bị cắt,
      // khiến góc ảnh là ô trắng của bảng chứ không phải nền thực.
      var EDGE = Math.max(30, Math.floor(Math.min(w, h) * 0.04));
      var chromaSum = 0, chromaN = 0;
      // Duyệt 4 cạnh (step=4 để nhanh)
      for(var y=0;y<h;y+=4){
        for(var ex=0;ex<EDGE;ex++){
          var pl=(y*w+ex)*4, pr=(y*w+(w-1-ex))*4;
          chromaSum += Math.max(data[pl],data[pl+1],data[pl+2]) - Math.min(data[pl],data[pl+1],data[pl+2]);
          chromaSum += Math.max(data[pr],data[pr+1],data[pr+2]) - Math.min(data[pr],data[pr+1],data[pr+2]);
          chromaN += 2;
        }
      }
      for(var x=0;x<w;x+=4){
        for(var ey=0;ey<EDGE;ey++){
          var pt=(ey*w+x)*4, pb=((h-1-ey)*w+x)*4;
          chromaSum += Math.max(data[pt],data[pt+1],data[pt+2]) - Math.min(data[pt],data[pt+1],data[pt+2]);
          chromaSum += Math.max(data[pb],data[pb+1],data[pb+2]) - Math.min(data[pb],data[pb+1],data[pb+2]);
          chromaN += 2;
        }
      }
      var isColoredBg = (chromaSum / chromaN) > 12; // avg chroma trên viền > 12 = nền có màu

      // ── B2: Grayscale ──
      // Nền màu → min(R,G,B): loại tông màu, giữ độ đậm của mực in
      // Nền trắng → luminance chuẩn
      var gray = new Uint8Array(w * h);
      for(var i=0;i<data.length;i+=4){
        var px=i>>2;
        gray[px] = isColoredBg
          ? Math.min(data[i], data[i+1], data[i+2])
          : Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2]);
      }

      // ── B3: Fast 5-tap cross median (loại nhiễu mà không sort 9 phần tử) ──
      // Nhanh gấp 2-3x so với 3×3 full median, đủ tốt cho nhiễu điểm ảnh lẻ
      var blurred = new Uint8Array(w * h);
      for(var y=0;y<h;y++){
        for(var x=0;x<w;x++){
          var c=y*w+x;
          var v=[gray[c],
            gray[Math.max(0,y-1)*w+x], gray[Math.min(h-1,y+1)*w+x],
            gray[y*w+Math.max(0,x-1)], gray[y*w+Math.min(w-1,x+1)]];
          v.sort(function(a,b){return a-b;});
          blurred[c]=v[2]; // median of 5
        }
      }

      // ── B4: Thresholding ──
      var binGray = new Uint8Array(w * h);

      if(isColoredBg){
        // Otsu global threshold: tìm ngưỡng tối ưu từ histogram (O(n) + O(256))
        // Cực kỳ hiệu quả cho tài liệu có nền màu (phân bố 2 đỉnh rõ ràng)
        var hist=new Int32Array(256), totalPx=w*h, sumAll=0;
        for(var i=0;i<totalPx;i++) hist[blurred[i]]++;
        for(var i=0;i<256;i++) sumAll+=i*hist[i];
        var sumB=0,wB=0,maxVar=0,otsuT=128;
        for(var i=0;i<256;i++){
          wB+=hist[i]; if(!wB) continue;
          var wF=totalPx-wB; if(!wF) break;
          sumB+=i*hist[i];
          var mB=sumB/wB, mF=(sumAll-sumB)/wF;
          var vv=wB*wF*(mB-mF)*(mB-mF);
          if(vv>maxVar){maxVar=vv;otsuT=i;}
        }
        for(var i=0;i<totalPx;i++){
          var v=blurred[i]<=otsuT?0:255;
          binGray[i]=v;
          data[i*4]=data[i*4+1]=data[i*4+2]=v; data[i*4+3]=255;
        }
      } else {
        // Bradley-Roth adaptive: tốt hơn cho tài liệu nền trắng bị ánh sáng không đều
        var integral=new Float64Array(w*h);
        for(var y=0;y<h;y++) for(var x=0;x<w;x++){
          var idx=y*w+x;
          integral[idx]=blurred[idx]+(x>0?integral[idx-1]:0)+(y>0?integral[idx-w]:0)-(x>0&&y>0?integral[idx-w-1]:0);
        }
        var s=Math.max(20,Math.floor(w/6)), t=0.10;
        for(var y=0;y<h;y++) for(var x=0;x<w;x++){
          var idx=y*w+x;
          var x1=Math.max(0,x-s),y1=Math.max(0,y-s),x2=Math.min(w-1,x+s),y2=Math.min(h-1,y+s);
          var cnt=(x2-x1)*(y2-y1);
          var sm=integral[y2*w+x2]-(x1>0?integral[y2*w+x1-1]:0)-(y1>0?integral[(y1-1)*w+x2]:0)+(x1>0&&y1>0?integral[(y1-1)*w+x1-1]:0);
          var v=blurred[idx]*cnt<=sm*(1-t)?0:255;
          binGray[idx]=v;
          data[idx*4]=data[idx*4+1]=data[idx*4+2]=v; data[idx*4+3]=255;
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // ── B4b: Morphological Opening (Erosion → Dilation) ──
      // Xóa các điểm nhiễu đơn lẻ từ họa tiết nền còn sót sau Otsu.
      // Chỉ áp dụng cho nền màu (nền trắng không cần).
      if(isColoredBg){
        var eroded = new Uint8Array(w*h);
        for(var y=0;y<h;y++) for(var x=0;x<w;x++){
          var c=y*w+x;
          if(binGray[c]===0){
            // Erosion: pixel đen chỉ giữ nếu ít nhất 3/4 láng giềng cũng đen
            var nb4 = (binGray[Math.max(0,y-1)*w+x]===0?1:0)
                    + (binGray[Math.min(h-1,y+1)*w+x]===0?1:0)
                    + (binGray[y*w+Math.max(0,x-1)]===0?1:0)
                    + (binGray[y*w+Math.min(w-1,x+1)]===0?1:0);
            eroded[c] = nb4>=2 ? 0 : 255; // giữ nếu có >=2 hàng xóm đen
          } else { eroded[c]=255; }
        }
        // Dilation: khôi phục phần text đã bị erosion làm mỏng
        for(var y=0;y<h;y++) for(var x=0;x<w;x++){
          var c=y*w+x;
          if(eroded[c]===0){
            binGray[c]=0;
            binGray[Math.max(0,y-1)*w+x]=0;
            binGray[Math.min(h-1,y+1)*w+x]=0;
            binGray[y*w+Math.max(0,x-1)]=0;
            binGray[y*w+Math.min(w-1,x+1)]=0;
          }
        }
        // Cập nhật lại imageData
        for(var i=0;i<w*h;i++){
          data[i*4]=data[i*4+1]=data[i*4+2]=binGray[i]; data[i*4+3]=255;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      // ── B5: Tạo ảnh phụ (nền màu → dùng luminance + Bradley-Roth để retry) ──
      // Nếu Otsu bỏ sót một số điểm, ảnh phụ sẽ được dùng để bù vào.
      var secondaryDataUrl = null;
      if(isColoredBg){
        var c2=document.createElement('canvas'); c2.width=w; c2.height=h;
        var ctx2=c2.getContext('2d');
        ctx2.drawImage(img, 0, 0, w, h);
        var id2=ctx2.getImageData(0,0,w,h); var d2=id2.data;
        var g2=new Uint8Array(w*h);
        for(var i=0;i<d2.length;i+=4) g2[i>>2]=Math.round(0.299*d2[i]+0.587*d2[i+1]+0.114*d2[i+2]);
        // Bradley-Roth với window nhỏ (w/10, t=0.12) trên luminance
        var int2=new Float64Array(w*h);
        for(var y=0;y<h;y++) for(var x=0;x<w;x++){
          var idx=y*w+x;
          int2[idx]=g2[idx]+(x>0?int2[idx-1]:0)+(y>0?int2[idx-w]:0)-(x>0&&y>0?int2[idx-w-1]:0);
        }
        var s2=Math.max(15,Math.floor(w/10)), t2=0.12;
        for(var y=0;y<h;y++) for(var x=0;x<w;x++){
          var idx=y*w+x;
          var x1=Math.max(0,x-s2),y1=Math.max(0,y-s2),x2=Math.min(w-1,x+s2),y2=Math.min(h-1,y+s2);
          var cnt=(x2-x1)*(y2-y1);
          var sm=int2[y2*w+x2]-(x1>0?int2[y2*w+x1-1]:0)-(y1>0?int2[(y1-1)*w+x2]:0)+(x1>0&&y1>0?int2[(y1-1)*w+x1-1]:0);
          var v=g2[idx]*cnt<=sm*(1-t2)?0:255;
          d2[idx*4]=d2[idx*4+1]=d2[idx*4+2]=v; d2[idx*4+3]=255;
        }
        ctx2.putImageData(id2,0,0);
        secondaryDataUrl=c2.toDataURL('image/png');
      }

      // ── B6: Deskew ──
      var skew = detectSkewAngle(binGray, w, h);
      var primaryDataUrl;
      if(Math.abs(skew)>=1.0){
        var rotCanvas=document.createElement('canvas'); rotCanvas.width=w; rotCanvas.height=h;
        var rotCtx=rotCanvas.getContext('2d');
        rotCtx.fillStyle='#fff'; rotCtx.fillRect(0,0,w,h);
        rotCtx.translate(w/2,h/2); rotCtx.rotate(-skew*Math.PI/180);
        rotCtx.drawImage(canvas,-w/2,-h/2);
        primaryDataUrl=rotCanvas.toDataURL('image/png');
      } else {
        primaryDataUrl=canvas.toDataURL('image/png');
      }
      resolve({primary:primaryDataUrl, secondary:secondaryDataUrl, isColoredBg:isColoredBg});

    };
    img.onerror = reject;
    img.src = url;
  });
}

async function onSoDoOcrUpload(e) {
  var file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  var btnText = $('sodo-ocr-text');
  var btn = $('sodo-ocr-btn');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = '⏳ Đang quét...';

  try {
    var [processedImage, worker] = await Promise.all([
      preprocessImageForOCR(file),
      OCR_API_URL ? Promise.resolve(null) : getOcrWorker()
    ]);

    if (OCR_API_URL) {
      showToast('Đang gửi ảnh lên AI Server...', 'info', 4000);
      var response = await fetch(OCR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: processedImage.primary })
      });
      var result = await response.json();
      if (!result.success) throw new Error(result.error);
      var points = result.data;
      if (!points || points.length === 0) throw new Error('AI không tìm thấy tọa độ nào hợp lệ.');
      showToast('AI đã nhận diện ' + points.length + ' điểm!', 'success', 5000);
      var list = $('sodo-points-list');
      if (list) list.innerHTML = '';
      _soDoPointCount = 0;
      points.forEach(function(p) { addSoDoPoint(p.x, p.y); });
      drawSoDo();

    } else {
      showToast('Đang nhận dạng tọa độ...', 'info', 4000);

      var primaryImg   = processedImage.primary;
      var secondaryImg = processedImage.secondary; // null nếu nền trắng

      // ── Lần 1: PSM 6 trên ảnh chính ──
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', tessedit_char_whitelist: '0123456789., ' });
      var res1 = await worker.recognize(primaryImg);
      var rawText1 = res1.data.text;
      var expectedCount = detectExpectedRowCount(rawText1);
      var bestPts = extractPointsFromOcrText(rawText1);

      if (expectedCount > 0 && bestPts.length >= expectedCount) {
        renderOcrPoints(bestPts); return;
      }

      // ── Retry với các PSM khác nhau trên ảnh chính ──
      var strategies = [
        { img: primaryImg,   psm: '4',  wl: '0123456789., ' },
        { img: primaryImg,   psm: '11', wl: '0123456789., ' },
        { img: primaryImg,   psm: '6',  wl: '' },
        // Nếu có ảnh phụ (nền màu): thử cả PSM 6 và PSM 11 trên ảnh phụ
        { img: secondaryImg, psm: '6',  wl: '0123456789., ' },
        { img: secondaryImg, psm: '11', wl: '0123456789., ' },
      ];

      for (var si = 0; si < strategies.length; si++) {
        if (expectedCount > 0 && bestPts.length >= expectedCount) break;
        if (expectedCount === 0 && bestPts.length >= 3) break;

        var strat = strategies[si];
        if (!strat.img) continue; // bỏ qua nếu không có ảnh phụ

        showToast('Đang thử lại (chiến lược ' + (si + 2) + ')...', 'info', 2000);
        var params = { tessedit_pageseg_mode: strat.psm, preserve_interword_spaces: '1' };
        if (strat.wl) params.tessedit_char_whitelist = strat.wl;
        await worker.setParameters(params);

        var res = await worker.recognize(strat.img);
        var rawN = res.data.text;
        var ptsN = extractPointsFromOcrText(rawN);
        if (expectedCount === 0) expectedCount = detectExpectedRowCount(rawN);

        // Merge theo chỉ số hàng (không chỉ lấy bên nhiều điểm hơn)
        bestPts = mergeOcrResults(bestPts, ptsN);
      }

      // Khôi phục PSM mặc định
      await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789., ' });

      if (expectedCount > 0 && bestPts.length < expectedCount) {
        showToast('⚠️ Chỉ nhận được ' + bestPts.length + '/' + expectedCount + ' điểm. Hãy chụp thẳng và rõ hơn!', 'warning', 8000);
        if (bestPts.length > 0) renderOcrPoints(bestPts);
      } else {
        renderOcrPoints(bestPts);
      }

    }

  } catch (err) {
    console.error(err);
    if (_ocrWorker) { _ocrWorker.terminate().catch(function(){}); }
    _ocrWorker = null; _ocrWorkerReady = false;
    showToast('Lỗi đọc ảnh: ' + err.message, 'error', 6000);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = '📷 Quét ảnh';
  }
}

/**
 * Phát hiện số lượng tọa độ kỳ vọng từ cột "Điểm" trong bảng OCR,
 * HOẶC dự đoán dựa trên số lượng dòng chứa tọa độ (nếu cột Điểm bị cắt mất).
 */
function detectExpectedRowCount(text) {
  var lines = text.split('\n');
  var indices = {};
  var maxIndex = 0;
  var linesWithCoords = 0;

  lines.forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed) return;

    // Chuẩn hóa nhẹ trước khi kiểm tra
    var cleanLine = trimmed.replace(/[oO]/g, '0').replace(/[lI|]/g, '1')
                           .replace(/(\d),(\d)/g, '$1.$2')
                           .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');

    // Cố gắng tìm cột "Điểm" (số nhỏ đứng đầu, theo sau là tọa độ)
    var m = cleanLine.match(/^(\d{1,2})\s+(\d{6,10})/);
    if (m) {
      var idx = parseInt(m[1]);
      var coord = parseInt(m[2]);
      if (idx >= 1 && idx <= 50 && coord >= 100000) {
        indices[idx] = true;
        if (idx > maxIndex) maxIndex = idx;
      }
    }

    // Đếm xem dòng này có chứa số nào dài từ 6-10 chữ số (đặc trưng của X, Y) không
    var hasNum = false;
    var words = cleanLine.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/[^0-9]/g, '');
      if (w.length >= 6 && w.length <= 11) {
        hasNum = true; break;
      }
    }
    if (hasNum) linesWithCoords++;
  });

  // Ưu tiên 1: Dựa vào cột Điểm (nếu có đủ rõ ràng)
  var uniqueCount = Object.keys(indices).length;
  if (uniqueCount >= 2 && maxIndex >= 2) {
    return maxIndex;
  }

  // Ưu tiên 2: Nếu bị mất cột Điểm, dùng số lượng dòng chứa tọa độ làm mốc kỳ vọng.
  // Trừ 1 vì bảng VN2000 thường có hàng cuối lặp lại điểm đầu (điểm đóng vòng).
  // Tối thiểu là 2 để tránh false-positive khi chỉ có 1-2 số tọa độ lẻ.
  if (linesWithCoords >= 3) return linesWithCoords - 1;
  return 0;
}

/* Trích xuất điểm từ text OCR, kết hợp chỉ số hàng để đảm bảo thứ tự đúng.
 * Trả về {indexed: {rowNum: {x,y}}, ordered: [{x,y}...]}
 * - indexed: điểm đã biết vị trí hàng (từ cột "Số hiệu đỉnh thửa")
 * - ordered: danh sách cuối đã sort theo chỉ số hàng
 */
function extractPointsFromOcrText(text) {
  // ── Bước 0: Chuẩn hoá ──
  var rawLines = text.split('\n').map(function(line) {
    return line
      .replace(/[oO]/g, '0').replace(/[lI|]/g, '1')
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');
  }).map(function(line) {
    line = line.replace(/\b(\d{7}),(\d{3})\b/g, '$1.$2');
    line = line.replace(/\b(\d{6}),(\d{3})\b/g, function(m,a,b){ return (parseFloat(a)>=100000&&parseFloat(a)<=900000)?a+'.'+b:m; });
    line = line.replace(/\b(\d{7})\s+(\d{3})\b/g, '$1.$2');
    line = line.replace(/\b(\d{6})\s+(\d{3})\b/g, function(m,a,b){ return (parseFloat(a)>=100000&&parseFloat(a)<=900000)?a+'.'+b:m; });
    return line;
  });

  // ── Helpers ──
  var numRx = /\b(\d{5,8}(?:\.\d{1,4})?|\d{9,11})\b/g;
  function fixDec(raw) {
    if (raw.indexOf('.') !== -1) return parseFloat(raw);
    var s = raw;
    if (s.length === 10 && s[0] === '2') return parseFloat(s.slice(0,7)+'.'+s.slice(7));
    if (s.length === 9) return parseFloat(s.slice(0,6)+'.'+s.slice(6));
    return parseFloat(raw);
  }
  function cls(v) {
    if (v >= 800000 && v <= 3000000) return 'X';
    if (v >= 100000 && v <= 900000)  return 'Y';
    return null;
  }
  function extractHits(line) {
    var hits = [], m2; numRx.lastIndex = 0;
    while ((m2 = numRx.exec(line)) !== null) {
      var v = fixDec(m2[1]), c = cls(v);
      if (c) hits.push({val:v, cls:c});
    }
    return hits;
  }

  // ── Bước 0b: Gộp dòng bị vỡ ──
  var lines = [];
  for (var li = 0; li < rawLines.length; li++) {
    var cur = rawLines[li].trim(); if (!cur) { lines.push(''); continue; }
    var tmpH = extractHits(cur);
    var hasX = tmpH.some(function(h){return h.cls==='X';}),
        hasY = tmpH.some(function(h){return h.cls==='Y';});
    if ((hasX && !hasY) || (!hasX && hasY)) {
      var next = li+1 < rawLines.length ? rawLines[li+1].trim() : '';
      if (next) {
        var nH = extractHits(next);
        var nHX = nH.some(function(h){return h.cls==='X';}),
            nHY = nH.some(function(h){return h.cls==='Y';});
        if ((hasX&&!hasY&&!nHX&&nHY)||(!hasX&&hasY&&nHX&&!nHY)) {
          lines.push(cur+' '+next); li++; continue;
        }
      }
    }
    lines.push(cur);
  }

  // ── Bước 1: Parse có chỉ số hàng ──
  var indexed = {}; // {rowNum: {x,y}} — từ cột "Số hiệu"
  var unindexed = []; // không có chỉ số
  var allX = [], allY = [];

  lines.forEach(function(line) {
    var hits = extractHits(line);
    var xs = hits.filter(function(h){return h.cls==='X';}),
        ys = hits.filter(function(h){return h.cls==='Y';});
    xs.forEach(function(h){allX.push(h.val);});
    ys.forEach(function(h){allY.push(h.val);});

    if (xs.length===1 && ys.length===1) {
      // Cố trích chỉ số hàng (1-2 chữ số đứng đầu dòng)
      var m = line.trim().match(/^(\d{1,2})[\s\.]/);
      var rowIdx = m ? parseInt(m[1]) : null;
      if (rowIdx !== null && rowIdx >= 1 && rowIdx <= 50) {
        // Đánh ưu tiên: nếu đã có, giữ cả hai (lần này có thể là closing row)
        if (!indexed[rowIdx]) {
          indexed[rowIdx] = {x:xs[0].val, y:ys[0].val};
        } else {
          unindexed.push({x:xs[0].val, y:ys[0].val});
        }
      } else {
        unindexed.push({x:xs[0].val, y:ys[0].val});
      }
    } else if (xs.length>0 && xs.length===ys.length) {
      for (var i=0;i<xs.length;i++) unindexed.push({x:xs[i].val, y:ys[i].val});
    }
  });

  // ── Bước 2: Xây dựng kết quả có thứ tự ──
  var keys = Object.keys(indexed).map(Number).sort(function(a,b){return a-b;});
  var found = keys.map(function(k){return indexed[k];});

  if (found.length === 0) {
    // Fallback: không có chỉ số hàng → dùng unindexed hoặc allX/allY
    if (unindexed.length > 0) {
      found = unindexed;
    } else {
      var cnt = Math.min(allX.length, allY.length);
      for (var j=0; j<cnt; j++) found.push({x:allX[j], y:allY[j]});
    }
  } else {
    // Thêm unindexed vào cuối nếu chưa có trong indexed
    unindexed.forEach(function(p) {
      if (!found.some(function(r){return Math.abs(r.x-p.x)<5 && Math.abs(r.y-p.y)<5;})) {
        found.push(p);
      }
    });
  }

  // ── Bước 3: Loại trùng liên tiếp ──
  var uniq = [];
  found.forEach(function(p){
    var last=uniq[uniq.length-1];
    if(!last||Math.abs(last.x-p.x)>1||Math.abs(last.y-p.y)>1) uniq.push(p);
  });

  // Trả về cả indexed để dùng cho merge
  uniq._indexed = indexed;
  return uniq;
}

/**
 * Merge kết quả từ nhiều lần chạy OCR.
 * Dùng indexed (chỉ số hàng) để merge chính xác theo thứ tự bảng.
 * Với chỉ số hàng bị thiếu ở lần 1 nhưng có ở lần 2 → điền vào.
 */
function mergeOcrResults(primary, secondary) {
  var mergedIdx = {};
  // Lấy indexed từ primary
  if (primary._indexed) {
    Object.keys(primary._indexed).forEach(function(k){ mergedIdx[k] = primary._indexed[k]; });
  }
  // Bổ sung từ secondary
  if (secondary && secondary._indexed) {
    Object.keys(secondary._indexed).forEach(function(k){
      if (!mergedIdx[k]) mergedIdx[k] = secondary._indexed[k];
    });
  }

  // Nếu cả 2 không có indexed, chỉ lấy bên nhiều điểm hơn
  if (Object.keys(mergedIdx).length === 0) {
    return primary.length >= (secondary ? secondary.length : 0) ? primary : secondary;
  }

  // Xây dựng kết quả cuối theo thứ tự chỉ số hàng
  var keys = Object.keys(mergedIdx).map(Number).sort(function(a,b){return a-b;});
  var merged = keys.map(function(k){return mergedIdx[k];});

  // Thêm các điểm unindexed không có trong merged (từ cả 2)
  [primary, secondary].forEach(function(pts){
    if (!pts) return;
    pts.forEach(function(p){
      if (!merged.some(function(r){return Math.abs(r.x-p.x)<5&&Math.abs(r.y-p.y)<5;})){
        merged.push(p);
      }
    });
  });

  // Dedup liên tiếp
  var uniq = [];
  merged.forEach(function(p){
    var last=uniq[uniq.length-1];
    if(!last||Math.abs(last.x-p.x)>1||Math.abs(last.y-p.y)>1) uniq.push(p);
  });
  return uniq;
}


function renderOcrPoints(pts) {
  if (pts.length === 0) {
    showToast('Không quét được tọa độ hợp lệ. Hãy chụp thẳng, rõ nét!', 'warning', 7000);
    return;
  }
  showToast('Đã nhận diện ' + pts.length + ' điểm tọa độ!', 'success', 5000);
  var list = $('sodo-points-list');
  if (list) list.innerHTML = '';
  _soDoPointCount = 0;
  pts.forEach(function(p) { addSoDoPoint(p.x, p.y); });
  drawSoDo();
}
function drawSoDo() {
  var sel = $('sodo-province');
  var opt = sel && sel.selectedOptions[0];
  var cm = opt ? parseFloat(opt.dataset.cm) : NaN;
  /* fallback to main tab province */
  if (isNaN(cm)) {
    var mainOpt = $('province-select') && $('province-select').selectedOptions[0];
    cm = mainOpt ? parseFloat(mainOpt.dataset.cm) : NaN;
  }
  if(isNaN(cm)){ showToast('Vui lòng chọn tỉnh/thành phố để lấy KTT','warning'); return; }

  var rows = document.querySelectorAll('.sodo-point-row');
  var wgs84Pts = [];
  var errors = [];

  rows.forEach(function(row, i){
    var xStr = row.querySelector('.sodo-x').value.trim();
    var yStr = row.querySelector('.sodo-y').value.trim();
    if(!xStr && !yStr) return; /* skip empty rows */
    /* Sổ đỏ convention: X = Northing (~2.3tr), Y = Easting (~500k)
       proj4 convention:  x = Easting,             y = Northing
       => swap khi gọi hàm convert */
    var xSoDo = parseFloat(xStr.replace(/,/g,'.')); /* X sổ đỏ = Northing */
    var ySoDo = parseFloat(yStr.replace(/,/g,'.')); /* Y sổ đỏ = Easting  */
    /* Validate đúng theo vai trò thực */
    var errs = [];
    if (isNaN(ySoDo) || ySoDo < 100000 || ySoDo > 900000)
      errs.push('Y (Easting) phải trong 100,000 – 900,000 m');
    if (isNaN(xSoDo) || xSoDo < 900000 || xSoDo > 2600000)
      errs.push('X (Northing) phải trong 900,000 – 2,600,000 m');
    if(errs.length){ errors.push('P'+(i+1)+': '+errs[0]); return; }
    try {
      /* proj4: easting=ySoDo, northing=xSoDo */
      var wgs = vn2000TM3ToWGS84(ySoDo, xSoDo, cm);
      wgs84Pts.push({ x:xSoDo, y:ySoDo, lat:wgs.lat, lon:wgs.lon });
    } catch(e){ errors.push('P'+(i+1)+': Lỗi chuyển đổi'); }
  });

  if(errors.length){ showToast(errors[0],'error'); return; }
  if(wgs84Pts.length < 1){ showToast('Chưa có điểm hợp lệ nào để hiển thị','warning'); return; }

  var label = ($('sodo-label') && $('sodo-label').value.trim()) || 'Thửa đất';
  var info = drawLandPlot(wgs84Pts, label);
  if(!info) return;

  _soDoResult = { label:label, cm:cm, points:wgs84Pts, area:info.area, perimeter:info.perimeter, edges:info.edgeLengths };

  /* Show results */
  var areaM2 = info.area.toFixed(2);
  var areaHa = (info.area/10000).toFixed(6);
  setText('sodo-area', areaM2+' m² ('+(info.area/10000<0.001?areaM2:areaHa)+' ha)');
  setText('sodo-perimeter', formatCoordNum(info.perimeter,2)+' m');

  var edgeHtml = info.edgeLengths.map(function(d,i){
    var next=(i+1)%wgs84Pts.length;
    return '<div style="padding:3px 0;border-bottom:1px solid var(--border)">'+
      '<b>P'+(i+1)+'→P'+(next+1)+':</b> '+formatCoordNum(d,2)+' m</div>';
  }).join('');
  var ed=$('sodo-edges'); if(ed) ed.innerHTML=edgeHtml;

  $('sodo-result') && $('sodo-result').classList.remove('hidden');
  switchTab('sodo');
  showToast('✅ Đã vẽ thửa đất — '+areaM2+' m²','success');
}

function clearSoDo() {
  clearLandPlot();
  $('sodo-result') && $('sodo-result').classList.add('hidden');
  _soDoResult = null;
  initSoDo();
}

function onSoDoProvinceChange() {
  var sel = $('sodo-province');
  var opt = sel && sel.selectedOptions[0];
  if (!opt || !opt.value) return;
  var cm = parseFloat(opt.dataset.cm);
  var prov = getProvinceByCode(opt.value);
  var disp = $('sodo-ktt-display'), txt = $('sodo-ktt-text');
  if (disp) disp.style.display = 'flex';
  if (txt) txt.textContent = 'KTT: ' + cm + '° — ' + (prov ? prov.fullName : '');
  /* Also fly map to province center */
  if (prov && prov.center) flyToLocation(prov.center[0], prov.center[1], 9);
  /* Sync to main tab if not already selected */
  var mainSel = $('province-select');
  if (mainSel && !mainSel.value) mainSel.value = opt.value;
}

function copySoDoResult() {
  if(!_soDoResult){ showToast('Chưa có kết quả','warning'); return; }
  var r=_soDoResult;
  var lines=[
    '=== '+r.label+' ===',
    'KTT: '+r.cm+'° | Số điểm: '+r.points.length,
    'Diện tích: '+r.area.toFixed(2)+' m² = '+(r.area/10000).toFixed(6)+' ha',
    'Chu vi: '+r.perimeter.toFixed(2)+' m',
    '--- Điểm góc (VN2000) ---'
  ];
  r.points.forEach(function(p,i){
    lines.push('P'+(i+1)+': X='+formatCoordNum(p.x,3)+' Y='+formatCoordNum(p.y,3)+
      ' | Lat='+p.lat.toFixed(7)+' Lon='+p.lon.toFixed(7));
  });
  r.edges.forEach(function(d,i){
    var next=(i+1)%r.points.length;
    lines.push('P'+(i+1)+'-P'+(next+1)+': '+d.toFixed(2)+' m');
  });
  copyToClipboard(lines.join('\n'),'📋 Đã sao chép thông tin thửa đất');
}

/* ═══════════════════════════════════════════════
   MOBILE BOTTOM SHEET
   ═══════════════════════════════════════════════ */
function initMobilePanel() {
  var panel  = $('control-panel');
  var handle = $('panel-handle');
  var fab    = $('fab-panel-btn');
  var fabIcon = $('fab-icon');
  if (!panel) return;

  var _expanded = false;

  function setExpanded(v, smooth) {
    _expanded = v;
    if (v) {
      panel.classList.add('expanded');
    } else {
      panel.classList.remove('expanded');
    }
    if (fabIcon) fabIcon.textContent = v ? '🗺️' : '📋';
  }

  /* FAB click: toggle */
  if (fab) {
    fab.addEventListener('click', function(e) {
      e.stopPropagation();
      setExpanded(!_expanded);
    });
  }

  /* Handle click: toggle */
  if (handle) {
    handle.addEventListener('click', function() {
      setExpanded(!_expanded);
    });
  }

  /* Swipe up / down on handle or tabs (wider touch area) */
  var _touchStartY = 0;
  var swipeZone = document.querySelector('.panel-tabs') || handle;
  if (swipeZone) {
    swipeZone.addEventListener('touchstart', function(e) {
      _touchStartY = e.touches[0].clientY;
    }, { passive: true });

    swipeZone.addEventListener('touchend', function(e) {
      var dy = _touchStartY - e.changedTouches[0].clientY;
      // If we are scrolling horizontally inside tabs, don't trigger expand/collapse
      var dx = Math.abs(e.changedTouches[0].clientX - e.touches[0]?.clientX || 0);
      if (Math.abs(dy) > 30 && Math.abs(dy) > dx) {
        if (dy > 30)  setExpanded(true);   /* swipe up → expand */
        if (dy < -30) setExpanded(false);  /* swipe down → collapse */
      }
    }, { passive: true });
  }

  /* Map click → collapse panel (only on mobile) */
  var origOnMapClick = onMapClick;
  onMapClick = function(lat, lon) {
    if (window.innerWidth <= 600) setExpanded(false);
    origOnMapClick(lat, lon);
  };

  /* After convert → auto-expand to show result */
  var origDoConvert = doConvert;
  doConvert = function() {
    origDoConvert();
    if (window.innerWidth <= 600) setExpanded(true);
  };
}
