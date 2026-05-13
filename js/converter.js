/**
 * converter.js — VN2000 Web App
 * Engine chuyển đổi tọa độ (dùng proj4.js global)
 */

var WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

function vn2000TM3ToWGS84(x, y, cm) {
  var p4 = getVN2000TM3Proj4(cm);
  var r  = proj4(p4, WGS84, [x, y]);
  return { lat: r[1], lon: r[0] };
}

function wgs84ToVN2000TM3(lat, lon, cm) {
  var p4 = getVN2000TM3Proj4(cm);
  var r  = proj4(WGS84, p4, [lon, lat]);
  return { x: r[0], y: r[1] };
}

function vn2000UTMToWGS84(x, y, utmZone) {
  var p4 = getVN2000UTMProj4(utmZone);
  var r  = proj4(p4, WGS84, [x, y]);
  return { lat: r[1], lon: r[0] };
}

function wgs84ToVN2000UTM(lat, lon, utmZone) {
  var p4 = getVN2000UTMProj4(utmZone);
  var r  = proj4(WGS84, p4, [lon, lat]);
  return { x: r[0], y: r[1] };
}

function dmsToDD(degrees, minutes, seconds, direction) {
  var dd = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  if (direction === 'S' || direction === 'W') dd = -dd;
  return dd;
}

function ddToDMS(dd, type) {
  var neg = dd < 0;
  var abs = Math.abs(dd);
  var deg = Math.floor(abs);
  var mFull = (abs - deg) * 60;
  var min = Math.floor(mFull);
  var sec = (mFull - min) * 60;
  var dir = type === 'lat' ? (neg ? 'S' : 'N') : (neg ? 'W' : 'E');
  return {
    degrees: deg, minutes: min, seconds: sec, direction: dir,
    formatted: deg + '\u00b0' + min + "'" + sec.toFixed(3) + '"' + dir
  };
}

function parseCoordString(str, type) {
  if (!str) return null;
  str = str.trim();
  if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  var m = str.match(/(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["\s]*([NSEWnsew])?/);
  if (m) {
    var dir = m[4] ? m[4].toUpperCase() : (type === 'lat' ? 'N' : 'E');
    return dmsToDD(+m[1], +m[2], parseFloat(m[3]), dir);
  }
  return null;
}

function validateVN2000(x, y) {
  var e = [];
  if (isNaN(x) || x < 100000 || x > 900000) e.push('X phải trong 100,000 – 900,000 m');
  if (isNaN(y) || y < 900000 || y > 2400000) e.push('Y phải trong 900,000 – 2,400,000 m');
  return e;
}

function validateWGS84(lat, lon) {
  var e = [];
  if (isNaN(lat) || lat < 8 || lat > 24) e.push('Lat phải 8° – 24°N (VN)');
  if (isNaN(lon) || lon < 100 || lon > 117) e.push('Lon phải 100° – 117°E (VN)');
  return e;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  var R = 6371000, r = function(d){ return d*Math.PI/180; };
  var dLat = r(lat2-lat1), dLon = r(lon2-lon1);
  var a = Math.sin(dLat/2)**2 + Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatCoordNum(num, dec) {
  dec = dec !== undefined ? dec : 3;
  return num.toLocaleString('vi-VN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
