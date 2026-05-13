/**
 * provinces.js — VN2000 Web App
 * 34 tỉnh/thành Việt Nam (19/2025/QĐ-TTg, hiệu lực 01/07/2025)
 * Nguồn: thanglequoc/vietnamese-provinces-database
 * towgs84: Cục Đo đạc và Bản đồ Việt Nam
 */

/* global */
var TOWGS84 = "-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278";

/**
 * Tạo chuỗi proj4 cho hệ VN2000 Múi 3° (TM-3)
 * @param {number} lon0 - Kinh tuyến trục (độ thập phân)
 */
function makeVN2000TM3Proj4(lon0) {
  return '+proj=tmerc +lat_0=0 +lon_0=' + lon0 + ' +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=' + TOWGS84 + ' +units=m +no_defs';
}

/**
 * Tạo chuỗi proj4 cho hệ VN2000 UTM (Múi 6°)
 * @param {number} zone - UTM zone number
 */
function makeVN2000UTMProj4(zone) {
  return '+proj=utm +zone=' + zone + ' +ellps=WGS84 +towgs84=' + TOWGS84 + ' +units=m +no_defs';
}

/**
 * Danh sách 34 tỉnh/thành phố Việt Nam (sau sáp nhập 01/07/2025)
 * code: mã hành chính chính thức
 * name: tên tỉnh/thành
 * type: 'city' | 'province'
 * cm: kinh tuyến trục (central meridian) chính cho TM-3
 * utmZone: UTM zone (48 hoặc 49) cho múi 6°
 * mergedFrom: các tỉnh cũ được sáp nhập vào (tham khảo)
 * center: [lat, lon] trung tâm tỉnh (tham chiếu hiển thị bản đồ)
 */
const PROVINCES = [
  // ───── THÀNH PHỐ TRỰC THUỘC TRUNG ƯƠNG (6) ─────
  {
    code: "01",
    name: "Hà Nội",
    fullName: "Thành phố Hà Nội",
    type: "city",
    cm: 105.0,
    utmZone: 48,
    mergedFrom: ["Hà Nội"],
    center: [21.0285, 105.8542],
    region: "Đồng bằng sông Hồng"
  },
  {
    code: "31",
    name: "Hải Phòng",
    fullName: "Thành phố Hải Phòng",
    type: "city",
    cm: 105.75,
    utmZone: 48,
    mergedFrom: ["Hải Phòng", "Hải Dương"],
    center: [20.8449, 106.6881],
    region: "Đồng bằng sông Hồng"
  },
  {
    code: "26",
    name: "Huế",
    fullName: "Thành phố Huế",
    type: "city",
    cm: 107.0,
    utmZone: 49,
    mergedFrom: ["Huế"],
    center: [16.4637, 107.5909],
    region: "Bắc Trung Bộ"
  },
  {
    code: "48",
    name: "Đà Nẵng",
    fullName: "Thành phố Đà Nẵng",
    type: "city",
    cm: 107.75,
    utmZone: 49,
    mergedFrom: ["Đà Nẵng", "Quảng Nam"],
    center: [16.0544, 108.2022],
    region: "Nam Trung Bộ"
  },
  {
    code: "92",
    name: "Cần Thơ",
    fullName: "Thành phố Cần Thơ",
    type: "city",
    cm: 105.0,
    utmZone: 48,
    mergedFrom: ["Cần Thơ"],
    center: [10.0452, 105.7469],
    region: "Đồng bằng sông Cửu Long"
  },
  {
    code: "79",
    name: "Hồ Chí Minh",
    fullName: "Thành phố Hồ Chí Minh",
    type: "city",
    cm: 105.75,
    utmZone: 48,
    mergedFrom: ["Hồ Chí Minh", "Bình Dương", "Bà Rịa – Vũng Tàu"],
    center: [10.8231, 106.6297],
    region: "Đông Nam Bộ"
  },

  // ───── TỈNH (28) ─────
  {
    code: "12",
    name: "Lai Châu",
    fullName: "Tỉnh Lai Châu",
    type: "province",
    cm: 103.0,
    utmZone: 48,
    mergedFrom: ["Lai Châu"],
    center: [22.3862, 103.4700],
    region: "Tây Bắc Bộ"
  },
  {
    code: "11",
    name: "Điện Biên",
    fullName: "Tỉnh Điện Biên",
    type: "province",
    cm: 103.0,
    utmZone: 48,
    mergedFrom: ["Điện Biên"],
    center: [21.3860, 103.0160],
    region: "Tây Bắc Bộ"
  },
  {
    code: "14",
    name: "Sơn La",
    fullName: "Tỉnh Sơn La",
    type: "province",
    cm: 104.0,
    utmZone: 48,
    mergedFrom: ["Sơn La"],
    center: [21.1022, 103.7289],
    region: "Tây Bắc Bộ"
  },
  {
    code: "06",
    name: "Cao Bằng",
    fullName: "Tỉnh Cao Bằng",
    type: "province",
    cm: 105.75,
    utmZone: 48,
    mergedFrom: ["Cao Bằng"],
    center: [22.6657, 105.9986],
    region: "Đông Bắc Bộ"
  },
  {
    code: "20",
    name: "Lạng Sơn",
    fullName: "Tỉnh Lạng Sơn",
    type: "province",
    cm: 107.0,
    utmZone: 49,
    mergedFrom: ["Lạng Sơn"],
    center: [21.8537, 106.7613],
    region: "Đông Bắc Bộ"
  },
  {
    code: "22",
    name: "Quảng Ninh",
    fullName: "Tỉnh Quảng Ninh",
    type: "province",
    cm: 107.75,
    utmZone: 49,
    mergedFrom: ["Quảng Ninh"],
    center: [21.0064, 107.2925],
    region: "Đông Bắc Bộ"
  },
  {
    code: "08",
    name: "Tuyên Quang",
    fullName: "Tỉnh Tuyên Quang",
    type: "province",
    cm: 106.0,
    utmZone: 48,
    mergedFrom: ["Tuyên Quang", "Hà Giang"],
    center: [22.1330, 105.2172],
    region: "Đông Bắc Bộ"
  },
  {
    code: "10",
    name: "Lào Cai",
    fullName: "Tỉnh Lào Cai",
    type: "province",
    cm: 104.75,
    utmZone: 48,
    mergedFrom: ["Lào Cai", "Yên Bái"],
    center: [22.3356, 104.1472],
    region: "Tây Bắc Bộ"
  },
  {
    code: "19",
    name: "Thái Nguyên",
    fullName: "Tỉnh Thái Nguyên",
    type: "province",
    cm: 106.0,
    utmZone: 48,
    mergedFrom: ["Thái Nguyên", "Bắc Kạn"],
    center: [21.5942, 105.8412],
    region: "Đông Bắc Bộ"
  },
  {
    code: "25",
    name: "Phú Thọ",
    fullName: "Tỉnh Phú Thọ",
    type: "province",
    cm: 104.75,
    utmZone: 48,
    mergedFrom: ["Phú Thọ", "Vĩnh Phúc", "Hòa Bình"],
    center: [21.3432, 105.2023],
    region: "Đồng bằng sông Hồng"
  },
  {
    code: "27",
    name: "Bắc Ninh",
    fullName: "Tỉnh Bắc Ninh",
    type: "province",
    cm: 107.0,
    utmZone: 49,
    mergedFrom: ["Bắc Ninh", "Bắc Giang"],
    center: [21.1861, 106.0763],
    region: "Đồng bằng sông Hồng"
  },
  {
    code: "33",
    name: "Hưng Yên",
    fullName: "Tỉnh Hưng Yên",
    type: "province",
    cm: 105.5,
    utmZone: 48,
    mergedFrom: ["Hưng Yên", "Thái Bình"],
    center: [20.8526, 106.0169],
    region: "Đồng bằng sông Hồng"
  },
  {
    code: "58",
    name: "Ninh Bình",
    fullName: "Tỉnh Ninh Bình",
    type: "province",
    cm: 105.0,
    utmZone: 48,
    mergedFrom: ["Ninh Bình", "Nam Định", "Hà Nam"],
    center: [20.2536, 105.9745],
    region: "Đồng bằng sông Hồng"
  },
  {
    code: "38",
    name: "Thanh Hóa",
    fullName: "Tỉnh Thanh Hóa",
    type: "province",
    cm: 105.0,
    utmZone: 48,
    mergedFrom: ["Thanh Hóa"],
    center: [20.1283, 105.4404],
    region: "Bắc Trung Bộ"
  },
  {
    code: "40",
    name: "Nghệ An",
    fullName: "Tỉnh Nghệ An",
    type: "province",
    cm: 104.75,
    utmZone: 48,
    mergedFrom: ["Nghệ An"],
    center: [19.2342, 104.9200],
    region: "Bắc Trung Bộ"
  },
  {
    code: "42",
    name: "Hà Tĩnh",
    fullName: "Tỉnh Hà Tĩnh",
    type: "province",
    cm: 105.5,
    utmZone: 48,
    mergedFrom: ["Hà Tĩnh"],
    center: [18.3560, 105.8877],
    region: "Bắc Trung Bộ"
  },
  {
    code: "44",
    name: "Quảng Trị",
    fullName: "Tỉnh Quảng Trị",
    type: "province",
    cm: 106.0,
    utmZone: 49,
    mergedFrom: ["Quảng Trị", "Quảng Bình"],
    center: [16.8163, 107.1017],
    region: "Bắc Trung Bộ"
  },
  {
    code: "51",
    name: "Quảng Ngãi",
    fullName: "Tỉnh Quảng Ngãi",
    type: "province",
    cm: 108.0,
    utmZone: 49,
    mergedFrom: ["Quảng Ngãi", "Kon Tum"],
    center: [15.1214, 108.8007],
    region: "Nam Trung Bộ"
  },
  {
    code: "64",
    name: "Gia Lai",
    fullName: "Tỉnh Gia Lai",
    type: "province",
    cm: 108.25,
    utmZone: 49,
    mergedFrom: ["Gia Lai"],
    center: [13.8079, 108.1094],
    region: "Tây Nguyên"
  },
  {
    code: "56",
    name: "Khánh Hòa",
    fullName: "Tỉnh Khánh Hòa",
    type: "province",
    cm: 108.25,
    utmZone: 49,
    mergedFrom: ["Khánh Hòa"],
    center: [12.2388, 109.1967],
    region: "Nam Trung Bộ"
  },
  {
    code: "68",
    name: "Lâm Đồng",
    fullName: "Tỉnh Lâm Đồng",
    type: "province",
    cm: 107.75,
    utmZone: 49,
    mergedFrom: ["Lâm Đồng"],
    center: [11.9404, 108.4585],
    region: "Tây Nguyên"
  },
  {
    code: "66",
    name: "Đắk Lắk",
    fullName: "Tỉnh Đắk Lắk",
    type: "province",
    cm: 108.5,
    utmZone: 49,
    mergedFrom: ["Đắk Lắk", "Phú Yên"],
    center: [12.7100, 108.2378],
    region: "Tây Nguyên"
  },
  {
    code: "75",
    name: "Đồng Nai",
    fullName: "Tỉnh Đồng Nai",
    type: "province",
    cm: 107.75,
    utmZone: 49,
    mergedFrom: ["Đồng Nai", "Bình Phước"],
    center: [11.0686, 107.1676],
    region: "Đông Nam Bộ"
  },
  {
    code: "72",
    name: "Tây Ninh",
    fullName: "Tỉnh Tây Ninh",
    type: "province",
    cm: 105.75,
    utmZone: 48,
    mergedFrom: ["Tây Ninh"],
    center: [11.3351, 106.0985],
    region: "Đông Nam Bộ"
  },
  {
    code: "86",
    name: "Vĩnh Long",
    fullName: "Tỉnh Vĩnh Long",
    type: "province",
    cm: 105.5,
    utmZone: 48,
    mergedFrom: ["Vĩnh Long", "Bến Tre", "Trà Vinh"],
    center: [10.2397, 106.0500],
    region: "Đồng bằng sông Cửu Long"
  },
  {
    code: "87",
    name: "Đồng Tháp",
    fullName: "Tỉnh Đồng Tháp",
    type: "province",
    cm: 105.0,
    utmZone: 48,
    mergedFrom: ["Đồng Tháp", "Tiền Giang"],
    center: [10.4938, 105.6882],
    region: "Đồng bằng sông Cửu Long"
  },
  {
    code: "96",
    name: "Cà Mau",
    fullName: "Tỉnh Cà Mau",
    type: "province",
    cm: 105.0,
    utmZone: 48,
    mergedFrom: ["Cà Mau"],
    center: [9.1769, 105.1500],
    region: "Đồng bằng sông Cửu Long"
  },
  {
    code: "89",
    name: "An Giang",
    fullName: "Tỉnh An Giang",
    type: "province",
    cm: 104.75,
    utmZone: 48,
    mergedFrom: ["An Giang"],
    center: [10.5215, 105.1259],
    region: "Đồng bằng sông Cửu Long"
  }
];

/**
 * Bản đồ kinh tuyến trục → proj4 string (cache)
 * Tránh tạo lại chuỗi nhiều lần
 */
const _proj4Cache = {};

/**
 * Lấy proj4 string cho VN2000 TM-3 theo kinh tuyến trục
 * @param {number} cm - Kinh tuyến trục
 */
function getVN2000TM3Proj4(cm) {
  if (!_proj4Cache[cm]) {
    _proj4Cache[cm] = makeVN2000TM3Proj4(cm);
  }
  return _proj4Cache[cm];
}

/**
 * Lấy proj4 string cho VN2000 UTM theo zone
 * @param {number} zone - UTM zone
 */
function getVN2000UTMProj4(zone) {
  const key = `utm${zone}`;
  if (!_proj4Cache[key]) {
    _proj4Cache[key] = makeVN2000UTMProj4(zone);
  }
  return _proj4Cache[key];
}

/**
 * Lấy tỉnh theo code
 * @param {string} code
 */
function getProvinceByCode(code) {
  return PROVINCES.find(p => p.code === code) || null;
}

/**
 * Danh sách unique kinh tuyến trục TM-3 đang dùng
 */
const UNIQUE_MERIDIANS = [...new Set(PROVINCES.map(p => p.cm))].sort((a, b) => a - b);

// No ES module exports — globals used directly
