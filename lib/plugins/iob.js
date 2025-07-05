'use strict';

const _ = require('lodash')
const times = require('../times');

function init(ctx) {
  var moment = ctx.moment;
  var translate = ctx.language.translate;
  var utils = require('../utils')(ctx);

  var iob = {
    name: 'iob',
    label: 'Insulin-on-Board',
    pluginType: 'pill-major'
  };

  iob.RECENCY_THRESHOLD = times.mins(30).msecs;

  iob.setProperties = function(sbx) {
    sbx.offerProperty('iob', function() {
      return iob.calcTotal(sbx.data.treatments, sbx.data.devicestatus, sbx.data.profile, sbx.time);
    });
  };

  iob.calcTotal = function(treatments, devicestatus, profile, time, spec_profile) {
    if (time === undefined) {
      time = Date.now();
    }

    var result = iob.lastIOBDeviceStatus(devicestatus, time);
    var treatmentResult = (treatments && treatments.length) ? iob.fromTreatments(treatments, profile, time, spec_profile) : {};

    if (_.isEmpty(result)) {
      result = treatmentResult;
    } else if (treatmentResult.iob) {
      result.treatmentIob = +(Math.round(treatmentResult.iob + "e+3") + "e-3");
    }

    if (result.iob) result.iob = +(Math.round(result.iob + "e+3") + "e-3");
    return addDisplay(result);
  };

  function addDisplay(iob) {
    if (_.isEmpty(iob) || iob.iob === undefined) {
      return {};
    }
    var display = utils.toFixed(iob.iob);
    return _.merge(iob, {
      display: display,
      displayLine: 'IOB: ' + display + 'U'
    });
  }

  iob.lastIOBDeviceStatus = function(devicestatus, time) {
    if (time && time.getTime) {
      time = time.getTime();
    }
    var futureMills = time + times.mins(5).msecs;
    var recentMills = time - iob.RECENCY_THRESHOLD;

    var iobs = _.chain(devicestatus)
      .filter(function(status) {
        return status.mills <= futureMills && status.mills >= recentMills;
      })
      .map(iob.fromDeviceStatus)
      .reject(_.isEmpty)
      .sortBy('mills');

    var loopIOBs = iobs.filter(i => i.source === 'Loop');
    return loopIOBs.last().value() || iobs.last().value();
  };

  iob.fromDeviceStatus = function(entry) {
    var iobOpenAPS = _.get(entry, 'openaps.iob');
    var iobLoop = _.get(entry, 'loop.iob');
    var iobPump = _.get(entry, 'pump.iob');

    if (_.isObject(iobOpenAPS)) {
      iobOpenAPS = _.isArray(iobOpenAPS) ? iobOpenAPS[0] : iobOpenAPS;
      if (_.isEmpty(iobOpenAPS)) return {};
      if (iobOpenAPS.time) iobOpenAPS.timestamp = iobOpenAPS.time;
      return {
        iob: iobOpenAPS.iob,
        basaliob: iobOpenAPS.basaliob,
        activity: iobOpenAPS.activity,
        source: 'OpenAPS',
        device: entry.device,
        mills: moment(iobOpenAPS.timestamp).valueOf()
      };
    } else if (_.isObject(iobLoop)) {
      return {
        iob: iobLoop.iob,
        source: 'Loop',
        device: entry.device,
        mills: moment(iobLoop.timestamp).valueOf()
      };
    } else if (_.isObject(iobPump)) {
      return {
        iob: iobPump.iob || iobPump.bolusiob,
        source: entry.connect !== undefined ? 'MM Connect' : undefined,
        device: entry.device,
        mills: entry.mills
      };
    } else {
      return {};
    }
  };

  iob.fromTreatments = function(treatments, profile, time, spec_profile) {
    var totalIOB = 0, totalActivity = 0, lastBolus = null;

    _.each(treatments, function(treatment) {
      if (treatment.mills <= time) {
        var tIOB = iob.calcTreatment(treatment, profile, time, spec_profile);
        if (tIOB.iobContrib > 0) lastBolus = treatment;
        totalIOB += tIOB.iobContrib;
        totalActivity += tIOB.activityContrib;
      }
    });

    return {
      iob: +(Math.round(totalIOB + "e+3") + "e-3"),
      activity: totalActivity,
      lastBolus: lastBolus,
      source: translate('Care Portal')
    };
  };

  iob.calcTreatment = function(treatment, profile, time, spec_profile) {
    var dia = 3;
    if (profile !== undefined) {
      dia = profile.getDIA(time, spec_profile) || 3;
    }

    var result = { iobContrib: 0, activityContrib: 0 };
    if (!treatment.insulin) return result;

    var bolusTime = treatment.mills;
    var minutesAgo = (time - bolusTime) / 1000 / 60;
    var duration = dia * 60;

    if (minutesAgo >= 0 && minutesAgo <= duration) {
      var remainingFraction = 1 - (minutesAgo / duration);
      result.iobContrib = treatment.insulin * remainingFraction;
    }

    return result;
  };

  return iob;
}

module.exports = init;
