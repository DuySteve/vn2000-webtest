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

// Gemini API free tier chưa khả dụng tại VN (quota=0 cho mọi model 2.0)
// Dùng Tesseract.js Offline — miễn phí, không giới hạn, đã được tối ưu PSM 6
var OCR_API_URL = '';

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

/* ── Tesseract Worker Singleton: khởi tạo 1 lần, tái dùng cho tất cả lần quét ── */
var _ocrWorker = null;
var _ocrWorkerReady = false;

async function getOcrWorker() {
  if (_ocrWorker && _ocrWorkerReady) return _ocrWorker;
  if (!window.Tesseract) throw new Error('Thư viện OCR chưa tải xong, vui lòng thử lại!');
  
  _ocrWorker = await Tesseract.createWorker('eng');
  await _ocrWorker.setParameters({
    tessedit_pageseg_mode: '6',      // Đọc khối văn bản đơn, tốt nhất cho bảng số
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: '0123456789., '  // Chỉ nhận số, dấu chấm, dấu cách
  });
  _ocrWorkerReady = true;
  return _ocrWorker;
}

/* Tiền khởi tạo worker ngay khi trang load (ẩn thời gian chờ khỏi người dùng) */
window.addEventListener('load', function() {
  setTimeout(function() { getOcrWorker().catch(function(){}); }, 2000);
});

/**
 * Adaptive Binarization: chuyển ảnh về trắng/đen chuẩn dựa trên ngưỡng cục bộ.
 * Tốt hơn CSS filter rất nhiều vì xử lý từng vùng thay vì toàn cục,
 * giúp giữ chữ tốt ngay cả khi ảnh có bóng, chói, hoặc nền không đều.
 */
function preprocessImageForOCR(file) {
  return new Promise(function(resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(url);
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');

      // Scale lên ~2000px chiều ngang (Tesseract đọc tốt nhất ở ngưỡng này)
      var targetW = 2000;
      var scale = img.width < targetW ? (targetW / img.width) : 1;
      // Không scale quá 3000px để tránh tràn RAM trên mobile
      if (img.width * scale > 3000) scale = 3000 / img.width;

      canvas.width  = Math.floor(img.width  * scale);
      canvas.height = Math.floor(img.height * scale);

      // Bước 1: Vẽ gốc lên canvas để lấy pixel data
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var data = imageData.data;
      var w = canvas.width, h = canvas.height;

      // Bước 2: Chuyển sang Grayscale
      var gray = new Uint8Array(w * h);
      for (var i = 0; i < data.length; i += 4) {
        var px = i / 4;
        gray[px] = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
      }

      // Bước 3: Adaptive Thresholding (Bradley–Roth local binarization)
      // Tính tổng tích lũy (integral image) để lấy ngưỡng cục bộ nhanh O(n)
      var integral = new Float64Array(w * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = y * w + x;
          integral[idx] = gray[idx]
            + (x > 0 ? integral[idx - 1] : 0)
            + (y > 0 ? integral[idx - w] : 0)
            - (x > 0 && y > 0 ? integral[idx - w - 1] : 0);
        }
      }

      // Kích thước cửa sổ: ~1/8 chiều rộng, tối thiểu 15px
      var s = Math.max(15, Math.floor(w / 8));
      var t = 0.15; // Ngưỡng độ nhạy (15%): pixel tối hơn 15% so với trung bình vùng → in đen

      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = y * w + x;
          var x1 = Math.max(0, x - s), y1 = Math.max(0, y - s);
          var x2 = Math.min(w - 1, x + s), y2 = Math.min(h - 1, y + s);
          var count = (x2 - x1) * (y2 - y1);
          var sum = integral[y2 * w + x2]
            - (x1 > 0 ? integral[y2 * w + x1 - 1] : 0)
            - (y1 > 0 ? integral[(y1 - 1) * w + x2] : 0)
            + (x1 > 0 && y1 > 0 ? integral[(y1 - 1) * w + x1 - 1] : 0);
          var val = gray[idx] * count <= sum * (1 - t) ? 0 : 255;
          // Ghi lại pixel đen/trắng vào ImageData gốc
          data[idx * 4]     = val;
          data[idx * 4 + 1] = val;
          data[idx * 4 + 2] = val;
          data[idx * 4 + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      // Xuất PNG lossless để giữ nguyên nét
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function onSoDoOcrUpload(e) {
  var file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset

  var btnText = $('sodo-ocr-text');
  var btn = $('sodo-ocr-btn');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = '⏳ Đang quét...';

  try {
    // Tiền xử lý ảnh và lấy OCR worker song song (tiết kiệm thời gian)
    var [processedImage, worker] = await Promise.all([
      preprocessImageForOCR(file),
      OCR_API_URL ? Promise.resolve(null) : getOcrWorker()
    ]);

    if (OCR_API_URL) {
      showToast('Đang gửi ảnh lên AI Server để phân tích...', 'info', 4000);
      var response = await fetch(OCR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: processedImage })
      });
      var result = await response.json();
      if (!result.success) throw new Error(result.error);
      var points = result.data;
      if (!points || points.length === 0) throw new Error('AI không tìm thấy tọa độ nào hợp lệ.');
      showToast('AI đã nhận diện thành công ' + points.length + ' điểm tọa độ!', 'success', 5000);
      var list = $('sodo-points-list');
      if (list) list.innerHTML = '';
      _soDoPointCount = 0;
      points.forEach(function(p) { addSoDoPoint(p.x, p.y); });
      drawSoDo();

    } else {
      showToast('Đang nhận dạng tọa độ...', 'info', 4000);
      var res = await worker.recognize(processedImage);
      parseOcrText(res.data.text);
    }
  } catch (err) {
    console.error(err);
    // Worker lỗi → reset để lần sau tạo lại
    if (_ocrWorker) { _ocrWorker.terminate().catch(function(){}); }
    _ocrWorker = null;
    _ocrWorkerReady = false;
    showToast('Lỗi đọc ảnh: ' + err.message, 'error', 6000);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = '📷 Quét ảnh';
  }
}

function parseOcrText(text) {
  /* ── Bước 1: Chuẩn hóa text OCR ── */
  var clean = text
    // Thay ký tự bị nhầm thành số (chỉ thay trong ngữ cảnh số)
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    // Chuẩn hóa dấu phân cách thập phân: dấu phẩy giữa số → dấu chấm
    .replace(/(\d),(\d)/g, '$1.$2')
    // Xóa dấu chấm phân cách hàng nghìn (VD: 2.363.228 → 2363228)
    .replace(/(\d)\.(\d{3})\./g, '$1$2.')
    .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2')
    // Khoảng trắng quanh dấu thập phân
    .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');

  /* ── Bước 2: Nối số bị OCR cắt ra bởi khoảng trắng trong cùng 1 dòng ── */
  // Xử lý từng dòng để tránh nối nhầm giữa các dòng
  var lines = clean.split('\n').map(function(line) {
    // Nối: "2 363 228" → "2363228", "523 456" → "523456"
    // Chỉ nối khi tổng chữ số có vẻ là một số tọa độ hợp lệ (6-10 chữ số)
    return line.replace(/\b(\d{1,4})\s+(\d{3})\s+(\d{3}(?:\.\d+)?)\b/g, '$1$2$3')
               .replace(/\b(\d{1,3})\s+(\d{3}(?:\.\d+)?)\b/g, function(m, a, b) {
                 var joined = a + b.replace('.', '');
                 // Chỉ nối nếu kết quả là tọa độ hợp lệ
                 return (joined.length >= 6 && joined.length <= 8) ? a + b : m;
               });
  });

  /* ── Bước 3: Trích xuất tất cả số hợp lệ từng dòng ── */
  // Regex khớp: số nguyên 5-8 chữ số (có thể có thập phân), hoặc số dính liền 9-11 chữ số
  var numRx = /\b(\d{5,8}(?:\.\d{1,4})?|\d{9,11})\b/g;

  function fixMissingDecimal(raw) {
    var s = raw.replace('.', '');
    if (raw.indexOf('.') !== -1) return parseFloat(raw); // Đã có dấu thập phân
    // Không có dấu thập phân và số dài bất thường → thử khôi phục
    if (s.length === 10 || (s.length === 11 && s.startsWith('2'))) {
      return parseFloat(s.substring(0, 7) + '.' + s.substring(7));
    }
    if (s.length === 9 || (s.length === 10 && !s.startsWith('2'))) {
      return parseFloat(s.substring(0, 6) + '.' + s.substring(6));
    }
    return parseFloat(raw);
  }

  function classify(val) {
    if (val >= 800000 && val <= 3000000) return 'X'; // Northing
    if (val >= 100000 && val <= 900000)  return 'Y'; // Easting
    return null;
  }

  /* ── Bước 4: Parse từng dòng thành cặp (X, Y) ── */
  var pairedByLine = [];
  var allX = [], allY = [];

  lines.forEach(function(line) {
    var matches = [], m;
    numRx.lastIndex = 0;
    while ((m = numRx.exec(line)) !== null) {
      var val = fixMissingDecimal(m[1]);
      var cls = classify(val);
      if (cls) matches.push({ val: val, cls: cls });
    }

    var xs = matches.filter(function(v) { return v.cls === 'X'; });
    var ys = matches.filter(function(v) { return v.cls === 'Y'; });

    // Thu gom vào pool toàn cục để fallback
    xs.forEach(function(v) { allX.push(v.val); });
    ys.forEach(function(v) { allY.push(v.val); });

    // Cặp chuẩn: 1 dòng có đúng 1 X và 1 Y
    if (xs.length === 1 && ys.length === 1) {
      pairedByLine.push({ x: xs[0].val, y: ys[0].val });
    }
    // Nhiều cặp trên 1 dòng (bảng nhiều cột)
    else if (xs.length > 0 && xs.length === ys.length) {
      for (var i = 0; i < xs.length; i++) {
        pairedByLine.push({ x: xs[i].val, y: ys[i].val });
      }
    }
  });

  /* ── Bước 5: Quyết định kết quả ── */
  var foundPoints = [];

  if (pairedByLine.length > 0) {
    // Ưu tiên kết quả ghép theo dòng (chính xác nhất)
    foundPoints = pairedByLine;
  } else if (allX.length > 0 && allY.length > 0) {
    // Fallback: ghép theo thứ tự nếu số X = số Y
    var count = Math.min(allX.length, allY.length);
    for (var j = 0; j < count; j++) {
      foundPoints.push({ x: allX[j], y: allY[j] });
    }
  }

  /* ── Bước 6: Loại trùng lặp liên tiếp (tolerance 1m) ── */
  var uniquePoints = [];
  foundPoints.forEach(function(p) {
    var last = uniquePoints[uniquePoints.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1 || Math.abs(last.y - p.y) > 1) {
      uniquePoints.push(p);
    }
  });

  /* ── Bước 7: Hiển thị kết quả ── */
  if (uniquePoints.length === 0) {
    showToast('Không quét được tọa độ hợp lệ. Hãy chụp rõ nét, tránh bị chói!', 'warning', 7000);
  } else {
    showToast('Đã nhận diện ' + uniquePoints.length + ' điểm tọa độ!', 'success', 5000);
    var list = $('sodo-points-list');
    if (list) list.innerHTML = '';
    _soDoPointCount = 0;
    uniquePoints.forEach(function(p) { addSoDoPoint(p.x, p.y); });
    drawSoDo();
  }
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
