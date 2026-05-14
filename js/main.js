/**
 * main.js — VN2000 Sổ Đỏ
 * Mô phỏng thửa đất từ tọa độ VN2000 trên sổ đỏ/bản đồ địa chính.
 */

var state = {
  selectedProvince: null,
  currentSoDoResult: null,
  theme: localStorage.getItem('vn2000_theme') || 'light'
};

var OCR_API_URL = 'https://vn2000-webtest.vercel.app/api/ocr';

function $(id) { return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', function() {
  applyTheme(state.theme);
  populateProvinceSelect();
  bindEvents();
  initMap('map-container', onMapClick);
  document.querySelector('.app-container').classList.add('entrance');
  initMobilePanel();
  autoSelectProvince('22');
});

/* ── THEME ── */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('vn2000_theme', t);
}

/* ── PROVINCE SELECT ── */
function populateProvinceSelect() {
  var sel = $('sodo-province');
  if (!sel) return;

  var PINNED_CODES = ['22'];
  var regions = {};
  PROVINCES.forEach(function(p) {
    if (!regions[p.region]) regions[p.region] = [];
    regions[p.region].push(p);
  });

  sel.innerHTML = '<option value="">-- Chọn tỉnh/thành (lấy KTT) --</option>';

  var pinnedProvinces = PROVINCES.filter(function(p) { return PINNED_CODES.indexOf(p.code) !== -1; });
  if (pinnedProvinces.length > 0) {
    var pinnedGrp = document.createElement('optgroup');
    pinnedGrp.label = '⭐ Khu vực chính';
    pinnedProvinces.forEach(function(p) {
      var o = document.createElement('option');
      o.value = p.code; o.dataset.cm = p.cm; o.dataset.utmZone = p.utmZone;
      o.textContent = p.fullName + ' (•' + p.cm + '°)';
      pinnedGrp.appendChild(o);
    });
    sel.appendChild(pinnedGrp);
  }

  Object.keys(regions).forEach(function(region) {
    var grp = document.createElement('optgroup');
    grp.label = region;
    regions[region].forEach(function(p) {
      var o = document.createElement('option');
      o.value = p.code; o.dataset.cm = p.cm; o.dataset.utmZone = p.utmZone;
      o.textContent = p.fullName + ' (•' + p.cm + '°)';
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  });
}

function autoSelectProvince(code) {
  var sel = $('sodo-province');
  if (sel) { sel.value = code; onSoDoProvinceChange(); }
}

/* ── EVENTS ── */
function bindEvents() {
  /* Sổ Đỏ */
  initSoDo();
  $('sodo-add-point') && $('sodo-add-point').addEventListener('click', function() { addSoDoPoint(); });
  $('sodo-ocr-btn')   && $('sodo-ocr-btn').addEventListener('click', function() { $('sodo-ocr-input').click(); });
  $('sodo-ocr-input') && $('sodo-ocr-input').addEventListener('change', onSoDoOcrUpload);
  $('sodo-draw-btn')  && $('sodo-draw-btn').addEventListener('click', drawSoDo);
  $('sodo-clear-btn') && $('sodo-clear-btn').addEventListener('click', function(){ clearSoDo(); showToast('Đã xóa thửa đất', 'info'); });
  $('sodo-copy-btn')  && $('sodo-copy-btn').addEventListener('click', copySoDoResult);
  $('sodo-kml-btn')   && $('sodo-kml-btn').addEventListener('click', onKmlExportSodo);
  $('sodo-province')  && $('sodo-province').addEventListener('change', onSoDoProvinceChange);
}

/* ── MAP CLICK (no-op for this mode, just show toast) ── */
function onMapClick(lat, lon) {
  showToast('Tọa độ: ' + lat.toFixed(5) + ', ' + lon.toFixed(5), 'success');
}

/* ── KML EXPORT: SỔ ĐỎ ── */
function onKmlExportSodo() {
  if (!state.currentSoDoResult || !state.currentSoDoResult.points || state.currentSoDoResult.points.length < 3) {
    showToast('Vui lòng vẽ thửa đất (tối thiểu 3 điểm) trước', 'warning');
    return;
  }
  var r = state.currentSoDoResult;
  var label = $('sodo-label') ? ($('sodo-label').value || 'Thửa đất') : 'Thửa đất';
  var features = [];

  features.push({
    type: 'polygon',
    points: r.points.map(function(p){ return { lat: p.lat, lon: p.lon }; }),
    name: label,
    desc: 'Diện tích: ' + r.area.toFixed(2) + ' m²<br>Chu vi: ' + r.perimeter.toFixed(2) + ' m'
  });

  r.points.forEach(function(p, i) {
    features.push({ type: 'point', lat: p.lat, lon: p.lon, name: 'Điểm ' + (i + 1), desc: 'X: ' + p.x + '<br>Y: ' + p.y });
  });

  exportKML(features, 'vn2000_sodo.kml');
}

/* ═══════════════════════════════════════════════
   SỔ ĐỎ — LAND PLOT TOOL
   ═══════════════════════════════════════════════ */
var _soDoPointCount = 0;

function initSoDo() {
  var list = $('sodo-points-list'); if (!list) return;
  list.innerHTML = '';
  _soDoPointCount = 0;
  for (var i = 0; i < 4; i++) addSoDoPoint();
}

function addSoDoPoint(xVal, yVal) {
  _soDoPointCount++;
  var n = _soDoPointCount;
  var list = $('sodo-points-list'); if (!list) return;
  var row = document.createElement('div');
  row.className = 'sodo-point-row';
  row.dataset.idx = n;
  row.innerHTML =
    '<div class="sodo-point-label">P' + n + '</div>' +
    '<div class="sodo-point-inputs">' +
      '<input type="text" class="input-field input-mono sodo-x" placeholder="X (Northing)" title="X = Northing, VD: 2363228" value="' + (xVal || '') + '" />' +
      '<input type="text" class="input-field input-mono sodo-y" placeholder="Y (Easting)"  title="Y = Easting,  VD: 520031"  value="' + (yVal || '') + '" />' +
    '</div>' +
    '<button class="sodo-remove-btn" title="Xóa điểm">✕</button>';
  list.appendChild(row);
  row.querySelector('.sodo-remove-btn').addEventListener('click', function(){ row.remove(); });
  row.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var inputs = list.querySelectorAll('input');
        var cur = Array.from(inputs).indexOf(inp);
        if (cur < inputs.length - 1) inputs[cur + 1].focus();
        else drawSoDo();
      }
    });
  });
}

/* ── SỔ ĐỎ OCR ── */
function preprocessImageForOCR(file) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function() {
      try {
        URL.revokeObjectURL(url);
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var maxDim = 1600;
        var scale = 1.0;
        if (img.width > maxDim || img.height > maxDim) {
          scale = maxDim / Math.max(img.width, img.height);
        }
        canvas.width = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ primary: canvas.toDataURL('image/jpeg', 0.85) });
      } catch(e) { reject(e); }
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
    var processedImage = await preprocessImageForOCR(file);
    showToast('Đang gửi ảnh lên AI Server...', 'info', 4000);
    var response = await fetch(OCR_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: processedImage.primary, model: 'meta-llama/llama-4-scout-17b-16e-instruct' })
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
    setTimeout(drawSoDo, 50); // Run after DOM updates
  } catch(e) {
    showToast('Lỗi đọc ảnh: ' + (e.message || e), 'error', 6000);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = '📷 Quét ảnh';
  }
}

function drawSoDo() {
  var sel = $('sodo-province');
  var opt = sel && sel.selectedOptions[0];
  var cm = opt ? parseFloat(opt.dataset.cm) : NaN;
  if (isNaN(cm)) { showToast('Vui lòng chọn tỉnh/thành phố để lấy KTT', 'warning'); return; }

  var rows = document.querySelectorAll('.sodo-point-row');
  var pts = [];
  rows.forEach(function(row) {
    var x = parseVNCoord(row.querySelector('.sodo-x').value);
    var y = parseVNCoord(row.querySelector('.sodo-y').value);
    if (!isNaN(x) && !isNaN(y) && x > 0 && y > 0) pts.push({ x: x, y: y });
  });

  if (pts.length < 3) { showToast('Cần ít nhất 3 điểm hợp lệ để vẽ thửa đất', 'warning'); return; }

  var latLons = pts.map(function(p) {
    // Trong sổ đỏ VN: X = Northing (7 chữ số), Y = Easting (6 chữ số)
    // proj4 TM nhận [Easting, Northing] = [Y, X]
    try { return vn2000TM3ToWGS84(p.y, p.x, cm); } catch(e) { return null; }
  }).filter(Boolean);

  if (latLons.length < 3) { showToast('Tọa độ không hợp lệ, kiểm tra lại X/Y và tỉnh/thành', 'error'); return; }

  var fullPts = pts.slice(0, latLons.length).map(function(p, i) {
    return { x: p.x, y: p.y, lat: latLons[i].lat, lon: latLons[i].lon };
  });

  var label = ($('sodo-label') && $('sodo-label').value) || 'Thửa đất';
  var result = drawLandPlot(fullPts, label);  // fullPts has {x,y,lat,lon} needed by popup
  var area = result ? result.area : 0;
  var perimeter = result ? result.perimeter : 0;
  var edges = result ? result.edgeLengths : [];  // map.js returns edgeLengths, not edges

  state.currentSoDoResult = { points: fullPts, area: area, perimeter: perimeter };

  setText('sodo-area', formatArea(area));
  setText('sodo-perimeter', formatLength(perimeter));

  var edgesEl = $('sodo-edges');
  if (edgesEl && edges.length) {
    edgesEl.innerHTML = edges.map(function(e, i) {
      return '<div>Cạnh ' + (i + 1) + ': <b>' + formatLength(e) + '</b></div>';
    }).join('');
  }

  $('sodo-result') && $('sodo-result').classList.remove('hidden');
  if (window.innerWidth <= 600 && window._setMobilePanelExpanded) {
    window._setMobilePanelExpanded(false);
  }
  showToast('Đã vẽ thửa ' + pts.length + ' đỉnh — ' + formatArea(area), 'success', 5000);
}

function onSoDoProvinceChange() {
  var sel = $('sodo-province');
  var opt = sel && sel.selectedOptions[0];
  if (!opt || !opt.value) return;
  state.selectedProvince = getProvinceByCode(opt.value);
  var cm = parseFloat(opt.dataset.cm);
  var disp = $('sodo-ktt-display'), txt = $('sodo-ktt-text');
  if (disp) disp.style.display = 'flex';
  if (txt) txt.textContent = 'KTT: ' + cm + '°';
  if (state.selectedProvince && state.selectedProvince.center) {
    flyToLocation(state.selectedProvince.center[0], state.selectedProvince.center[1], 9);
  }
}

function clearSoDo() {
  initSoDo();
  clearLandPlot();
  state.currentSoDoResult = null;
  $('sodo-result') && $('sodo-result').classList.add('hidden');
  $('sodo-label') && ($('sodo-label').value = '');
}

function copySoDoResult() {
  if (!state.currentSoDoResult) { showToast('Chưa có kết quả', 'warning'); return; }
  var r = state.currentSoDoResult;
  var label = ($('sodo-label') && $('sodo-label').value) || 'Thửa đất';
  var txt = label + '\nDiện tích: ' + formatArea(r.area) + '\nChu vi: ' + formatLength(r.perimeter) + '\n\nCác đỉnh:\n';
  txt += r.points.map(function(p, i) {
    return 'P' + (i + 1) + ': X=' + p.x + ', Y=' + p.y;
  }).join('\n');
  copyToClipboard(txt, 'Đã sao chép kết quả thửa đất');
}

/* ── HELPERS ── */

/**
 * Parse VN2000 coordinate strings flexibly:
 * - "2.363.228"   → 2363228   (dots = thousand separators)
 * - "520031"      → 520031    (plain integer)
 * - "520031.5"    → 520031.5  (single dot = decimal)
 * - "520,031"     → 520031    (comma = thousand separator)
 * - "520031,5"    → 520031.5  (comma = decimal)
 */
function parseVNCoord(raw) {
  var s = (raw || '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  var dotCount = (s.match(/\./g) || []).length;
  var commaCount = (s.match(/,/g) || []).length;

  if (commaCount > 0) {
    // Comma present: remove dots (thousand separators), replace comma with decimal
    return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  if (dotCount > 1) {
    // Multiple dots → all are thousand separators
    return parseFloat(s.replace(/\./g, ''));
  }
  // Zero or single dot → standard decimal, parse directly
  return parseFloat(s);
}

function setText(id, v) { var el = $(id); if (el) el.textContent = v; }

function formatArea(m2) {
  if (m2 >= 10000) return (m2 / 10000).toFixed(4) + ' ha (' + formatCoordNum(m2, 2) + ' m²)';
  return formatCoordNum(m2, 2) + ' m²';
}

function formatLength(m) {
  if (m >= 1000) return (m / 1000).toFixed(3) + ' km';
  return m.toFixed(2) + ' m';
}

/* ── MOBILE PANEL ── */
function initMobilePanel() {
  var panel = $('control-panel');
  var handle = $('panel-handle');
  var fab = $('fab-panel-btn');
  var fabIcon = $('fab-icon');
  if (!panel) return;

  var isExpanded = false;
  window._setMobilePanelExpanded = function(v) {
    isExpanded = v;
    panel.style.transition = ''; // Ensure transition is enabled
    panel.style.height = ''; // Clear inline height so CSS classes take over
    panel.classList.toggle('expanded', v);
    if (fab) fab.classList.toggle('active', v);
    if (fabIcon) fabIcon.textContent = v ? '✕' : '📋';
  };

  if (fab) fab.addEventListener('click', function() { window._setMobilePanelExpanded(!isExpanded); });

  if (handle) {
    var startY = 0, currentY = 0, isDragging = false;
    handle.addEventListener('touchstart', function(e) { 
      startY = e.touches[0].clientY; 
      isDragging = true;
      panel.style.transition = 'none'; // Disable transition during drag for smoothness
    }, { passive: true });
    
    handle.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      var dy = currentY - startY;
      
      // Add slight resistance when dragging up if already expanded, or down if collapsed
      if (isExpanded && dy < 0) dy = dy * 0.2;
      if (!isExpanded && dy > 0) dy = dy * 0.2;
      
      var baseHeight = isExpanded ? (window.innerHeight * 0.88) : 108;
      var newHeight = baseHeight - dy;
      panel.style.height = newHeight + 'px';
    }, { passive: true });
    
    handle.addEventListener('touchend', function(e) {
      if (!isDragging) return;
      isDragging = false;
      panel.style.transition = ''; // Restore transition
      panel.style.height = ''; // Remove inline style so class takes over
      
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dy) > 40) { // Threshold to toggle
        window._setMobilePanelExpanded(dy < 0);
      } else if (Math.abs(dy) < 5) { // Treat small movement as a tap/click
        window._setMobilePanelExpanded(!isExpanded);
      }
    }, { passive: true });
  }
}
