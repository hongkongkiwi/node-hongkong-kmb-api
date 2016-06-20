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
    'kmb_specialnote': {}
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
    if (types.indexOf('INSERT') > -1) {
      console.log(types);
      console.log(types,  parsed, parsed.values);
    } else if (types.indexOf('DELETE') > -1) {
      //console.log(types,parsed.where[0].column, parsed.where[0].values);
    } else {
      console.log(parsed);
    }
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

  for (var key in records) {
    var value = records[key].trim();
    var types = identify(value);
    var parsed = parse(value);
    var tableName = parsed.source.name;
    if (tableName === 'kmb_RS_stopinfo') {
      process_kmb_rs_stop_info(tables.kmb_RS_stopinfo,types,parsed);
    } else if (tableName === 'kmb_areafile') {
      //process_kmb_areafile(tables.kmb_areafile,types,parsed);
    } else if (tableName === 'kmb_routestopfile') {

    } else if (tableName === 'kmb_routemaster') {

    } else if (tableName === 'kmb_routefreqfile') {

    } else if (tableName === 'kmb_routeboundmaster') {
      
    } else if (tableName === 'kmb_businfo') {

    } else if (tableName === 'kmb_areasearchfile') {

    } else if (tableName === 'kmb_specialnote') {
      process_kmb_specialnote(tables.kmb_specialnote,types,parsed);
    }
  }
  //console.log(tables);

  //console.log(JSON.stringify(result.plist.array[0],null,2));
}, function(reason) {
  console.log('rejected',reason);
}).catch(function(err) {
  console.error('Error', err);
});
