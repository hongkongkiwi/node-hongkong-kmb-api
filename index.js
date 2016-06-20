var Promise = require('bluebird');
var rp = require('request-promise');
var _ = require('underscore');
var moment = require('moment');
var util = require('util');
var parseString = Promise.promisify(require('xml2js').parseString);
var debug = require('debug')('kmbapi');
var LocalCache = require('node-localcache');
var identify = require('sql-query-identifier').identify;
var parse = require('sql-parse').parse;

var KMB = function(options) {
  this.options = _.extendOwn({
    language: 'en',
    enableCaching: true
  }, options);

  this.cache = new LocalCache('.cache/request.json', !this.options.enableCaching);

  if (this.options.language !== KMB.LANGUAGE_ENGLISH && this.options.language !== KMB.LANGUAGE_TRADITIONAL_CHINESE) {
    throw new Error("Invalid Language",this.options.langauge);
  }

  debug("Class Initialized", this.options);
};

// public interface URL {
//     String RELEASE = "http://buseta.alvinhkh.com/release.json";
//     String KMB = "http://www.kmb.hk";
//     String LWB = "http://www.lwb.hk";
//     String PATH_ETA_API = "/ajax/eta_api/prod/";
//     String PATH_ETA_API_V1 = "/ajax/eta_api/index_v2.php";
//     String PATH_ETA_JS = "/js/services/eta/";
//     String ROUTE_AVAILABLE = "http://etadatafeed.kmb.hk:1933/GetData.ashx?type=ETA_R";
//     String ROUTE_INFO = "/ajax/getRouteInfo.php";
//     String ROUTE_INFO_V1 = "/ajax/getRoute_info.php";
//     String ROUTE_MAP = "/ajax/getRouteMapByBusno.php";
//     String ROUTE_NEWS = "/ajax/getnews.php";
//     String ROUTE_NOTICES = KMB + "/tc/news/realtimenews.html?page=";
//     String ROUTE_NOTICES_IMAGE = KMB + "/loadImage.php?page=";
//     String ROUTE_STOP_IMAGE = KMB + "/chi/img.php?file=";
//     String HTML_ETA = KMB + "/tc/services/eta_enquiry.html";
//     String HTML_SEARCH = KMB + "/tc/services/search.html";
//     String ETA_API_HOST = "http://etav2.kmb.hk";
//     String REQUEST_REFERRER = HTML_ETA;
//     String REQUEST_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
//             "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2478.0 Safari/537.36";
//     String STATIC_MAP = "http://maps.google.com/maps/api/staticmap" +
//             "?zoom=16&size=320x320&sensor=false&center=";
// }

KMB.LANGUAGE_ENGLISH = "en";
KMB.LANGUAGE_TRADITIONAL_CHINESE = "tc";
KMB.ETA_BASEURI = "http://etav2.kmb.hk";
KMB.DATA_BASEURI = "http://etadatafeed.kmb.hk:1933";
KMB.POI_BASEURI = 'http://www1.kmb.hk';
KMB.ONE_DAY_MS = (1000*60)*60*24;

KMB.prototype.getBusStopIcon = function(stopId) {
  //http://www.kmb.hk/chi/img.php?file=LA03-N-1225-0
};

KMB.prototype.getBusRoutes = function() {
  var self = this;

  var options = {
    method: 'GET',
    baseUrl: KMB.DATA_BASEURI,
    uri: '/GetData.ashx?type=ETA_R',
    json: true,
    gzip: true,
    headers: {
      'User-Agent': 'KMB/2.9.4 CFNetwork/758.4.3 Darwin/15.5.0',
      'Accept-Language': 'en-us',
      'Host': 'etav2.kmb.hk'
    }
  };

  // { ei: 'N',
  //   eot: 'E',
  //   t: '13:27',
  //   w: 'Y',
  //   ex: '2016-06-20 13:37:21' },
  //t = time
  //ex = expires
  //ei = is scheduled
  //w = has wheelchair

  return rp(options)
    .then(function(routeInfo) {
      return new Promise(function (resolve, reject) {
        resolve({kmb: routeInfo[0].r_no.split(',')});
      });
    });
};

KMB.prototype.getServerTime = function() {
  debug(" -> _getServerTime()");
  //'http://etadatafeed.kmb.hk:1933/GetData.ashx?type=Server_T'
};

KMB.prototype.getBusETA = function(route, direction, stopId) {
  debug(" -> getBusETA('%s', '%s', '%s')");

  var self = this;

  var now_timestamp = Math.floor(Date.now() / 1000);

  var options = {
    method: 'GET',
    baseUrl: KMB.ETA_BASEURI,
    uri: util.format('/?action=geteta&lang=%s&route=%s&bound=%s&stop=%s&stop_seq=%s&updated=%s', this.options.language, route, direction, stopId, 6, now_timestamp),
    json: true,
    gzip: true,
    headers: {
      'User-Agent': 'KMB/2.9.4 CFNetwork/758.4.3 Darwin/15.5.0',
      'Accept-Language': 'en-us',
      'Host': 'etav2.kmb.hk'
    }
  };

  return rp(options)
    .then(function(response) {
      return new Promise(function (resolve, reject) {
        if (response.responsecode !== 0) {
          reject(response);
        } else {
          resolve(response.response);
        }
      });
    }).then(function(etaInfo) {
      // Cleanup the results
      return _.map(etaInfo, function(obj) {
        obj.eta = obj.t.split("　 ")[0];
        obj.isDelayed = obj.length > 24 && obj.t.substr(0,24) === "Journey is delayed from " ? true : false;
        obj.expires = obj.ex;
        obj.hasWheelchair = obj.w === 'Y' ? true : false;
        obj.isScheduled = obj.ei === 'Y' ? true : false;
        delete obj.t;
        delete obj.ex;
        delete obj.w;
        delete obj.ei;
        return obj;
      });
    }).then(function(cleanRouteInfo) {
      return cleanRouteInfo;
    });
};

KMB.prototype.createETADatabase = function(stopId) {

};

KMB.prototype.downloadPOIXml = function() {
  debug(" -> downloadPOIXml()");

  var self = this;
  var YEAR_MONTH_DAY = moment().format("YYYYMMDD");

  var options = {
    method: 'GET',
    baseUrl: KMB.POI_BASEURI,
    uri: util.format('/apps/%s_poi.xml', YEAR_MONTH_DAY),
    json: true,
    gzip: true,
    headers: {
      'User-Agent': 'KMB/2.9.4 CFNetwork/758.4.3 Darwin/15.5.0',
      'Accept-Language': 'en-us',
      'Host': 'www1.kmb.hk'
    }
  };

  var cachedResult = self.cache.getItem(YEAR_MONTH_DAY + '_poi');

  if (self.options.enableCaching && cachedResult) {
    debug("Using Cached Result for downloadPOIXml()");
    return new Promise(function (resolve, reject) {
      resolve(cachedResult);
    });
  } else {
    return rp(options).then(function(poi) {
      return parseString(poi);
    }).then(function(result) {
      if (self.options.enableCaching) {
        debug("Saving Result to Cache");
        self.cache.setItem(YEAR_MONTH_DAY + '_poi', result);
      }
      return result;
    });
  }
};

module.exports = KMB;

var transport = new KMB();
// transport.getBusETA(2,2,'LA03S14500').then(function(etaInfo) {
//   console.log(etaInfo);
// }).catch(function(err) {
//   console.error('Error', err);
// });
// transport.getBusRoutes().then(function(routes) {
//   console.log(routes);
// }).catch(function(err) {
//   console.error('Error', err);
// });
transport.downloadPOIXml().then(function(result) {
  // INSERT
  // UPDATE
  // DELETE
  // SELECT
  // TRUNCATE
  // CREATE_TABLE
  // CREATE_DATABASE
  // DROP_TABLE
  // DROP_DATABASE

  var records = result.plist.array[0].string;

  var tables = {
    'kmb_RS_stopinfo': {},
    'kmb_areafile': {},
    'kmb_routemaster': {},
    'kmb_specialnote': {},
    'kmb_routestopfile': []
  };

  function process_kmb_rs_stop_info(table, types, parsed) {
    if (types.indexOf('INSERT') > -1) {
      var values = parsed.values[0];
      var stop_code = values[0].text;
      table[stop_code] = {
        'stop_code': stop_code,
        'route_no': values[1].text,
        'eng_loc': values[2].text,
        'chi_loc': values[3].text,
        'cn_loc': values[4].text,
        'stop_name': values[5].text,
        'stop_name_chi': values[6].text,
        'lat': values[7].text,
        'lng': values[8].text
      };
    } else if (types.indexOf('DELETE') > -1) {
      var column_name = parsed.where[0].column.text;
      if (column_name === 'stop_code') {
        var column_value = parsed.where[0].values[0][0].text;
        delete table[column_value];
      } else {
        console.log(JSON.stringify(parsed,null,2));
      }
    } else {
      console.log(parsed);
    }
  }

  function process_kmb_areafile(table,types,parsed) {
    /** Havn't figured out what this table is for **/
  }

  function process_kmb_specialnote(table,types,parsed) {
    if (types.indexOf('INSERT') > -1) {
      //console.log(types);
      //console.log(types,  parsed, parsed.values);
      var values = parsed.values[0];
      var stop_code = values[0].text;
      table[stop_code] = {
        'stop_code': stop_code,
        'en': values[1].text,
        'tc': values[2].text,
      };
    } else if (types.indexOf('DELETE') > -1) {
      var column_name = parsed.where[0].column.text;
      if (column_name === 'route') {
         var column_value = parsed.where[0].values[0][0].text;
         delete table[column_value];
      } else {
         console.log(JSON.stringify(parsed,null,2));
      }
    } else {
      console.log(parsed);
    }
  }

  function process_kmb_routemaster(table,types,parsed) {
    //console.log(types,JSON.stringify(parsed,null,2));
    if (types.indexOf('INSERT') > -1) {
      // [ { text: '91R', type: 3 }, // Bus Route
      //   { text: '0.00', type: 3 }, // Always zero
      //   { text: '10.50', type: 3 }, // Route Cost
      //   { text: '11.00', type: 3 }, // Route Length
      //   { text: '50', type: 3 }, / Total Route Time
      //   { text: 'R', type: 3 }, // Route type A,N,R,C // Bus Type (a=daytime,n=night,r=recreational,c=racecourse)
      //   { text: '91R', type: 3 } ] // Always same as bus route

      // https://en.wikipedia.org/wiki/Hong_Kong_bus_route_numbering#Alphabet_suffix
      // Alphabet prefix[edit]
      // Prefix A: Airport deluxe bus routes[1][2] (except MTR Feeder Bus route A73, which was an auxiliary route, now canceled)
      // Prefix B: Border routes
      // Prefix E: North Lantau external bus routes[3][2]
      // Prefix H: New World First Bus Rickshaw Sightseeing Bus routes
      // Prefix K: MTR Feeder Bus (formerly KCR Feeder Bus) routes
      // Prefix M: Some bus routes that are terminated at an Airport Express station
      // Prefix N: Overnight bus routes
      // Prefix NA: Overnight Airport deluxe bus routes
      // Prefix P: North Lantau peak-hour only routes: P12, P21 and P22 (all canceled)
      // Prefix R: North Lantau recreational bus routes (for Hong Kong Disneyland)
      // Prefix S: Airport shuttle bus routes[4][2]
      // Prefix T: Recreational bus routes (T stands for tourists)
      // Prefix X: Express routes for special services
      // Alphabet suffix[edit]
      // Suffix A, B, C, D, E, F: Conventional routes
      // Suffix K: Mainly connecting to East Rail Line (formerly KCR East Rail) stations of MTR
      // Suffix M: Mainly connecting to the stations of Kwun Tong Line, Island Line, Tsuen Wan Line and Tseung Kwan O Line of MTR
      // Suffix P: Peak-hour only routes (except KMB 8P, 276P, NWFB 8P, 18P, Citybus A29P, Long Win Bus A41P and New Lantau Bus B2P, which are for whole day service)
      // Suffix R: Recreational bus routes
      // Suffix S: Peak-hour only routes or special services
      // Suffix X: Express services

      var route = parsed.values[0][0].text;
      var prefix = isNaN(parseInt(route.substring(0,1))) ? route.substring(0,1) : null;
      var suffix = isNaN(parseInt(route.slice(-1))) ? route.slice(-1) : null;
      table[route] = {
        route_no: route,
        cost: parsed.values[0][2].text,
        length_km: parsed.values[0][3].text,
        time_mins: parsed.values[0][4].text,
        type: parsed.values[0][5].text,
        prefix: prefix,
        suffx: suffix
      };
    } else if (types.indexOf('DELETE') > -1) {
      var column_name = parsed.where[0].column.text;
      if (column_name === 'route_no') {
         var column_value = parsed.where[0].values[0][0].text;
         delete table[column_value];
      } else {
         console.log(JSON.stringify(parsed,null,2));
      }
    } else {
      console.log(JSON.stringify(parsed,null,2));
    }
  }

  count = 0;
  function kmb_routestopfile(table,types,parsed,value) {
    if (types.indexOf('INSERT') > -1) {
      //console.log(types);
      //console.log(types, parsed, parsed.values);

      /**
      { text: '978A', type: 3 }, // Bus Route
      { text: '1', type: 3 },
      { text: '0', type: 3 },
      { text: '09A', type: 3 },
      { text: '0.00', type: 3 },
      { text: '24.30', type: 3 },
      { text: 'LUEN WO HUI B/T', type: 3 }, // English Stop Name
      { text: '', type: 3 },
      { text: '', type: 3 },
      { text: '', type: 3 },
      { text: '聯和墟總站', type: 3 }, // Traditional Chinese Stop Name
      { text: '', type: 3 },
      { text: '', type: 3 },
      { text: '联和墟总站', type: 3 }, // Simplified Chinese Stop Name
      { text: '', type: 3 },
      { text: '', type: 3 },
      { text: 'LU02-T-1300-0', type: 3 }, // Bus Stop Id
      { text: 'LUEN WO HUI BUS TERMINUS', type: 3 }, // English Stop Name
      { text: '聯和墟總站', type: 3 }, // Traditional Chinese Stop Name
      { text: '联和墟总站', type: 3 }, // Simplified Chinese Stop Name
      { text: '09', type: 3 }

      0. { text: 'B1', type: 3 }, // Route Number
      1. { text: '2', type: 3 }, // Route Direction
      2. { text: '1', type: 3 }, // Stop Number
      3. { text: '14E', type: 3 }, // Area Code
      4. { text: '0.00', type: 3 }, // Always Zero (?)
      5. { text: '13.20', type: 3 }, // Fare Price
      6. { text: 'LOK MA CHAU ROAD', type: 3 }, // English Road Name
      7. { text: 'HA WAN TSUEN', type: 3 }, // English Area Name
      8. { text: 'L/P BD0975', type: 3 }, Lamp Post English
      9. { text: '', type: 3 }, // Closest Landmark
      10. { text: '落馬洲路', type: 3 }, // TC Road Name
      11. { text: '下灣村', type: 3 }, // TC Area Name
      12. { text: '燈柱BD0975', type: 3 }, // TC Lamp Post
      13. { text: '落马洲路', type: 3 }, // SC Road Name
      14. { text: '下湾村', type: 3 }, // SC Area Name
      15. { text: '灯柱BD0975', type: 3 },  // SC Lamp Post
      16. { text: 'LO08-S-0950-0', type: 3 }, // Bus Stop ID
      17. { text: 'HA WAN TSUEN', type: 3 }, // English Bus Stop Name
      18. { text: '下灣村', type: 3 }, // TC Bus Stop Name
      19. { text: '下湾村', type: 3 }, // SC Bus Stop Name
      20. { text: '14', type: 3 } // District Code*/

      if (parsed.values[0].length === 23) {
        table.push({
          route_no: parsed.values[0][0].text,
          bound: parsed.values[0][1].text,
          stop_seq: parsed.values[0][2].text,
          area: parsed.values[0][3].text,
          price: parsed.values[0][5].text,
          en_road: parsed.values[0][6].text,
          en_district: parsed.values[0][7].text,
          en_lampost: parsed.values[0][8].text,
          en_landmark: parsed.values[0][9].text,
          tc_road: parsed.values[0][10].text,
          tc_district: parsed.values[0][11].text,
          tc_lampost: parsed.values[0][12].text,
          tc_landmark: parsed.values[0][13].text,
          sc_road: parsed.values[0][14].text,
          sc_district: parsed.values[0][15].text,
          sc_lampost: parsed.values[0][16].text,
          sc_landmark: parsed.values[0][17].text,
          stop_id: parsed.values[0][18].text,
          en_stop_name: parsed.values[0][19].text,
          tc_stop_name: parsed.values[0][20].text,
          sc_stop_name: parsed.values[0][21].text,
          district: parsed.values[0][22].text,
        });
        //console.log(parsed.source.column);
      } else if (parsed.values[0].length === 22) {
        console.log(value);
      }
      // if (parsed.source.column.length > 0) {
      //   console.log(parsed.source.column, parsed.values);
      // }
    //
    // } else if (parsed.values[0].length === 22) {
    //   console.log(parsed.values);

      //console.log('insert',parsed.values[0][0].text + '_' + parsed.values[0][1].text + '_' + parsed.values[0][2].text);

      /*{ text: '66X', type: 3 },
      { text: '1', type: 3 },
      { text: '19', type: 3 },
      { text: '01H', type: 3 },
      { text: '0.00', type: 3 },
      { text: '5.10', type: 3 },
      { text: 'CHERRY ST', type: 3 },
      { text: 'OUTSIDE CENTRAL PARK', type: 3 },
      { text: '', type: 3 },
      { text: '', type: 3 },
      { text: '櫻桃街帝柏海灣對出', type: 3 },
      { text: '', type: 3 },
      { text: '', type: 3 },
      { text: '樱桃街帝柏海湾对出', type: 3 },
      { text: '', type: 3 },
      { text: '', type: 3 },
      { text: 'CH09-W-1250-0', type: 3 },
      { text: 'CENTRAL PARK', type: 3 },
      { text: '帝柏海灣', type: 3 },
      { text: '帝柏海湾', type: 3 },
      { text: '01', type: 3 }
      **/
      //if (!parsed.source.column && parsed.values[0][4].text !== '0.00') {
        //console.log(parsed.source.column,parsed.values,parsed);
      //}
      // if (parsed.values[0] && parsed.values[0][8].text !== '')
      //   console.log(parsed.values[0],parsed.values[0][8].text);

      // if ((parsed.values[0].length === 23 || parsed.values[0].length === 22) && parsed.source.column.length === 0) {
      //   //console.log(parsed.values[0][8].text + parsed.values[0][9].text,parsed.values[0].length);
      //   //console.log(parsed.values[0].length, parsed.values[0]);
      //
      //   count++;
      // }
    } else if (types.indexOf('DELETE') > -1) {
      var column_name = parsed.where[0].column.text;
      if (parsed.where.length === 3 && (parsed.where[0].column.text === 'route_no' && parsed.where[1].column.text === 'bound' && parsed.where[2].column.text === 'stop_seq')) {
        var route_no = parsed.where[0].values[0][0].text;
        var bound = parsed.where[1].values[0][0].text;
        var stop_seq = parsed.where[2].values[0][0].text;
        //var item = table[route_no]
        console.log('**** delete',route_no,bound,stop_seq);
      }
      if (column_name === 'route') {
         var column_value = parsed.where[0].values[0][0].text;
         delete table[column_value];
      } else {
         //console.log(JSON.stringify(parsed,null,2));
      }
    } else {
      console.log(parsed);
    }
  }

  for (var key in records) {
    var value = records[key].trim();
    var types = identify(value);
    var parsed = parse(value);
    var tableName = parsed.source.name;
    if (tableName === 'kmb_RS_stopinfo') {
      process_kmb_rs_stop_info(tables.kmb_RS_stopinfo,types,parsed);
    } else if (tableName === 'kmb_areafile') {
      process_kmb_areafile(tables.kmb_areafile,types,parsed);
    } else if (tableName === 'kmb_routestopfile') {
      kmb_routestopfile(tables.kmb_routestopfile,types,parsed,value);
    } else if (tableName === 'kmb_routemaster') {
      process_kmb_routemaster(tables.kmb_routemaster,types,parsed);
    } else if (tableName === 'kmb_routefreqfile') {
      //console.log(types,JSON.stringify(value,null,2));
    } else if (tableName === 'kmb_routeboundmaster') {
      //console.log(types,JSON.stringify(value,null,2));
    } else if (tableName === 'kmb_businfo') {
      //console.log(types,JSON.stringify(value,null,2));
    } else if (tableName === 'kmb_areasearchfile') {
      //console.log(types,JSON.stringify(value,null,2));
    } else if (tableName === 'kmb_specialnote') {
      process_kmb_specialnote(tables.kmb_specialnote,types,parsed);
    }
  }
  //console.log(tables.kmb_routemaster[1]);
  console.log(count);

  //console.log(JSON.stringify(result.plist.array[0],null,2));
}, function(reason) {
  console.log('rejected',reason);
}).catch(function(err) {
  console.error('Error', err);
});

// Get Bus Stop Map
// Map View - http://www.kmb.hk/chi/map.php?file=LO08-S-0950-0
// Street View - http://www.kmb.hk/chi/streetview.php?file=LO08-S-0950-0
//                http://www.kmb.hk/chi/img.php?file=CA04-S-1025-0
