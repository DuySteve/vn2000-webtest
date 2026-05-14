/**
 * map.js — VN2000 Web App
 * Google Maps tiles (hl=vi), Vietnamese island overlays, Land plot tool
 */

var _map = null, _marker = null, _measurePoints = [], _measureLayer = null, _measuring = false;
var _plotLayer = null, _plotMarkers = [];

/* ─── INIT MAP ─────────────────────────────────────────── */
function initMap(containerId, onMapClick) {
  _map = L.map(containerId, { center:[16,106], zoom:6, zoomControl:true });

  /* Google Maps layers (hl=vi = Vietnamese labels) */
  var gRoad = L.tileLayer(
    'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=vi&gl=VN',
    { subdomains:['0','1','2','3'], attribution:'© Google Maps', maxZoom:22, maxNativeZoom:21 }
  );
  var gSat = L.tileLayer(
    'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&hl=vi&gl=VN',
    { subdomains:['0','1','2','3'], attribution:'© Google Maps', maxZoom:22, maxNativeZoom:21 }
  );
  var gHybrid = L.tileLayer(
    'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi&gl=VN',
    { subdomains:['0','1','2','3'], attribution:'© Google Maps', maxZoom:22, maxNativeZoom:21 }
  );
  var gTerrain = L.tileLayer(
    'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&hl=vi&gl=VN',
    { subdomains:['0','1','2','3'], attribution:'© Google Maps', maxZoom:22, maxNativeZoom:21 }
  );
  var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'© OpenStreetMap', maxZoom:22, maxNativeZoom:19
  });

  gHybrid.addTo(_map);

  L.control.layers({
    '🗺️ Google - Đường phố': gRoad,
    '🛰️ Google - Vệ tinh':   gSat,
    '🌍 Google - Hỗn hợp':   gHybrid,
    '⛰️ Google - Địa hình':  gTerrain,
    '🌐 OpenStreetMap':       osm
  }, {}, { position:'topright' }).addTo(_map);

  L.control.scale({ imperial:false }).addTo(_map);

  _map.on('click', function(e) {
    if (_measuring) { _addMeasurePoint(e.latlng.lat, e.latlng.lng); return; }
    if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
    placeMapMarker(e.latlng.lat, e.latlng.lng, null, null);
  });

  /* Tự động báo cho Leaflet biết khi khung chứa bị thay đổi kích thước (Flex/Grid) */
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function() {
      if (_map) _map.invalidateSize();
    });
    var el = document.getElementById(containerId);
    if (el) ro.observe(el);
  }

  return _map;
}

/* ─── MARKER ────────────────────────────────────────────── */
function _makeIcon(color) {
  return L.divIcon({
    className: '',
    html: '<div style="width:24px;height:24px;background:'+color+';border:3px solid #fff;'+
          'border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>',
    iconSize:[24,24], iconAnchor:[12,24], popupAnchor:[0,-26]
  });
}

function placeMapMarker(lat, lon, cm, label) {
  if (_marker) _map.removeLayer(_marker);
  _marker = L.marker([lat,lon], {icon:_makeIcon('#A6192E')});
  var latDMS=ddToDMS(lat,'lat'), lonDMS=ddToDMS(lon,'lon');
  var vn2000Info='';
  if (cm!==null && !isNaN(cm)) {
    try {
      var vn=wgs84ToVN2000TM3(lat,lon,cm);
      vn2000Info='<div style="margin-top:8px;padding-top:6px;border-top:1px solid #333;color:#D4AF37;font-size:11px">'+
        '⚡ VN2000 KTT '+cm+'°<br>X: <b>'+formatCoordNum(vn.x,3)+'m</b><br>Y: <b>'+formatCoordNum(vn.y,3)+'m</b></div>';
    }catch(e){}
  }
  var html='<div style="font-family:Inter,sans-serif;color:#e0e0e0;min-width:180px;font-size:12px">'+
    (label?'<div style="font-weight:700;color:#D4AF37;margin-bottom:4px">'+label+'</div>':'')+
    '<div>🌐 WGS84</div>Lat: <b>'+lat.toFixed(7)+'</b><br>Lon: <b>'+lon.toFixed(7)+'</b>'+
    '<br><span style="font-size:10px;color:#aaa">'+latDMS.formatted+' / '+lonDMS.formatted+'</span>'+
    vn2000Info+'</div>';
  _marker.bindPopup(html,{className:'vn2000-popup',maxWidth:280}).addTo(_map).openPopup();
  return _marker;
}

function flyToLocation(lat,lon,zoom) { _map.flyTo([lat,lon],zoom||14,{animate:true,duration:1.2}); }

/* ─── MEASURE ───────────────────────────────────────────── */
function setMeasureMode(on) {
  _measuring=!!on;
  if (!on) {
    _measurePoints=[];
    if (_measureLayer){_map.removeLayer(_measureLayer);_measureLayer=null;}
    _map.closePopup();
  }
}

function _addMeasurePoint(lat,lon) {
  _measurePoints.push([lat,lon]);
  if (_measureLayer) _map.removeLayer(_measureLayer);
  if (_measurePoints.length>=2) {
    _measureLayer=L.polyline(_measurePoints,{color:'#FFD700',weight:2,dashArray:'6,4'}).addTo(_map);
    var total=0;
    for(var i=1;i<_measurePoints.length;i++)
      total+=haversineDistance(_measurePoints[i-1][0],_measurePoints[i-1][1],_measurePoints[i][0],_measurePoints[i][1]);
    var dist=total<1000?formatCoordNum(total,1)+' m':formatCoordNum(total/1000,3)+' km';
    var areaStr='';
    if(typeof turf!=='undefined'&&_measurePoints.length>=3){
      var cc=_measurePoints.map(function(p){return[p[1],p[0]];});cc.push(cc[0]);
      try{var area=turf.area(turf.polygon([cc]));areaStr='<br>📐 '+(area<10000?formatCoordNum(area,1)+' m²':formatCoordNum(area/10000,4)+' ha');}catch(e){}
    }
    var last=_measurePoints[_measurePoints.length-1];
    L.popup({className:'vn2000-popup'}).setLatLng(last)
      .setContent('<div style="font-family:Inter,sans-serif;color:#e0e0e0">📏 <b>'+dist+'</b>'+areaStr+'<br><small style="color:#888">'+_measurePoints.length+' điểm</small></div>')
      .openOn(_map);
  }
  L.circleMarker([lat,lon],{radius:4,color:'#FFD700',fillColor:'#FFD700',fillOpacity:1}).addTo(_map);
}

/* ─── LAND PLOT (SỔ ĐỎ) ────────────────────────────────── */
function drawLandPlot(wgs84Points, label) {
  clearLandPlot();
  if (wgs84Points.length === 0) { showToast('Cần ít nhất 1 điểm để hiển thị trên bản đồ','warning'); return null; }

  var latlngs = wgs84Points.map(function(p){return [p.lat,p.lon];});

  /* Vẽ hình (Polygon / Polyline / None) */
  if (wgs84Points.length >= 3) {
    _plotLayer = L.polygon(latlngs, {
      color:'#FF6B35', weight:2.5, opacity:1,
      fillColor:'#FF6B35', fillOpacity:0.15
    }).addTo(_map);
  } else if (wgs84Points.length === 2) {
    _plotLayer = L.polyline(latlngs, {
      color:'#FF6B35', weight:2.5, opacity:1
    }).addTo(_map);
  }

  /* Corner markers */
  wgs84Points.forEach(function(p,i){
    var icon=L.divIcon({
      className:'',
      html:'<div style="background:#FF6B35;color:#fff;width:22px;height:22px;border-radius:50%;'+
           'display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;'+
           'border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5)">P'+(i+1)+'</div>',
      iconSize:[22,22],iconAnchor:[11,11]
    });
    var m=L.marker([p.lat,p.lon],{icon:icon})
      .bindPopup('<div style="font-family:Inter,sans-serif;color:#e0e0e0;font-size:12px">'+
        '<b>Điểm P'+(i+1)+'</b><br>'+
        'X VN2000: <b>'+formatCoordNum(p.x,3)+'</b><br>'+
        'Y VN2000: <b>'+formatCoordNum(p.y,3)+'</b><br>'+
        'Lat: '+p.lat.toFixed(7)+'<br>Lon: '+p.lon.toFixed(7)+'</div>',
        {className:'vn2000-popup'})
      .addTo(_map);
    _plotMarkers.push(m);
  });

  /* Area & perimeter */
  var area=0, perimeter=0, edgeLengths=[];
  
  if (wgs84Points.length >= 2) {
    for(var i=0; i<wgs84Points.length; i++){
      if (wgs84Points.length === 2 && i === 1) break; // Chỉ có 1 cạnh nếu 2 điểm
      var next = (i+1) % wgs84Points.length;
      var d = haversineDistance(wgs84Points[i].lat, wgs84Points[i].lon, wgs84Points[next].lat, wgs84Points[next].lon);
      perimeter += d; 
      edgeLengths.push(d);
    }
  }

  if (wgs84Points.length >= 3 && typeof turf !== 'undefined') {
    var coords = wgs84Points.map(function(p){return[p.lon,p.lat];}); 
    coords.push(coords[0]);
    try { area = turf.area(turf.polygon([coords])); } catch(e){}
    
    /* Removed centroid label to avoid obscuring the map on mobile */
  }

  // Zoom fit map
  if (_plotLayer) {
    _map.fitBounds(_plotLayer.getBounds().pad(0.1));
  } else if (_plotMarkers.length > 0) {
    _map.flyTo(_plotMarkers[0].getLatLng(), 16);
  }
  
  return { area:area, perimeter:perimeter, edgeLengths:edgeLengths };
}

function clearLandPlot() {
  if (_plotLayer){_map.removeLayer(_plotLayer);_plotLayer=null;}
  _plotMarkers.forEach(function(m){_map.removeLayer(m);}); _plotMarkers=[];
}

/* ─── BATCH MARKERS ─────────────────────────────────────── */
function addBatchMarkers(points) {
  var grp=L.layerGroup().addTo(_map);
  points.forEach(function(pt,i){
    L.marker([pt.lat,pt.lon],{icon:_makeIcon('#4ECDC4')})
      .bindPopup('<b>'+(pt.label||('Điểm '+(i+1)))+'</b><br>'+pt.lat.toFixed(6)+', '+pt.lon.toFixed(6),{className:'vn2000-popup'})
      .addTo(grp);
  });
  if(points.length){try{_map.fitBounds(grp.getBounds().pad(0.1));}catch(e){}}
  return grp;
}

/* ─── GEOCODE ───────────────────────────────────────────── */
async function geocodeSearch(q) {
  var r=await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q)+'&countrycodes=vn&format=json&limit=5',
    {headers:{'Accept-Language':'vi'}});
  if(!r.ok) throw new Error('Geocoding lỗi');
  return r.json();
}

function locateUser(onLoc) {
  if(!navigator.geolocation){showToast('Không hỗ trợ GPS','error');return;}
  _map.locate({setView:true,maxZoom:16});
  _map.once('locationfound',function(e){placeMapMarker(e.latlng.lat,e.latlng.lng,null,'📍 Vị trí của bạn');if(onLoc)onLoc(e.latlng.lat,e.latlng.lng);});
  _map.once('locationerror',function(e){showToast(e.message,'error');});
}
