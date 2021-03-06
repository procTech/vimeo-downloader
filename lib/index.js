var PassThrough = require('stream').PassThrough;
var request     = require('./request');
var youtubedl   = require('youtube-dl');
var util        = require('./util');
var cache       = require('./cache');


/**
 * @param {String} link
 * @param {!Object} options
 * @return {ReadableStream}
 */
var vidl = module.exports = function vidl(link, options) {
  options = options || {};
  var stream = new PassThrough();
  stream.destroy = function() { stream._isDestroyed = true; };

  youtubedl.getInfo(link, function(err, info) {
    if (err) {
      stream.emit('error', err);
      return stream;
    }

    downloadFromInfoCallback(stream, info, options);
  });

  return stream;
};


vidl.getInfo = youtubedl.getInfo;
vidl.cache = cache;


/**
 * Chooses a format to download.
 *
 * @param {stream.Readable} stream
 * @param {Object} info
 * @param {Object} options
 */
function downloadFromInfoCallback(stream, info, options) {
  var format = util.chooseFormat(info.formats, options);
  if (format instanceof Error) {
    // The caller expects this function to be async.
    setImmediate(function() {
      stream.emit('error', format);
    });
    return;
  }
  stream.emit('info', info, format);

  var url = format.url;
  

  if (options.range) {
    url += '&range=' + options.range;
  }

  doDownload(stream, url, options, 3);
}


var redirectCodes = new Set([301, 302, 303, 307]);

/**
 * Tries to download the video. Youtube might respond with a redirect
 * status code. In which case, this function will call itself again.
 *
 * @param {stream.Readable} stream
 * @param {String} url
 * @param {Object} options
 * @param {Number} tryCount Prevent infinite redirects.
 */
function doDownload(stream, url, options, tryCount) {
  if (stream._isDestroyed) { return; }
  if (tryCount === 0) {
    stream.emit('error', new Error('Too many redirects'));
    return;
  }

  // Start downloading the video.
  var myrequest = options.request || request;
  var req = myrequest(url, options.requestOptions);
  var myres;
  stream.destroy = function() {
    req.abort();
    stream.emit('abort');
    if (myres) {
      myres.destroy();
      myres.unpipe();
    }
  };

  req.on('error', function(err) {
    stream.emit('error', err);
  });

  req.on('response', function(res) {
    myres = res;
    if (stream._isDestroyed) { return; }
    // Support for Streaming 206 status videos
    if (res.statusCode !== 200 && res.statusCode !== 206) {
      if (redirectCodes.has(res.statusCode)) {
        // Redirection header.
        doDownload(stream, res.headers.location, options, tryCount - 1);
        return;
      }
      stream.emit('response', res);
      stream.emit('error', new Error('Status code ' + res.statusCode));
      return;
    }

    res.pipe(stream);
    stream.emit('response', res);
  });
}
