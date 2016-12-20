var path = require('path')
var strftime = require('strftime')
var through = require('through2')
var randombytes = require('randombytes')
var mkdirp = require('mkdirp')
var xtend = require('xtend')
var level = require('level')
var osmdb = require('osm-p2p')
var osmobs = require('osm-p2p-observations')
var mime = require('mime')
var pump = require('pump')
var drive = require('./lib/drive.js')
var body = require('body/any')
var typeDetector = require('./identify-image-stream')

var router = require('routes')()
router.addRoute('GET /media/list', function (req, res, m) {
  res.setHeader('content-type', 'text/plain')
  pump(m.archive.list({ live: false }),
    through.obj(write), res, done)
  function done (err) {
    if (err) {
      res.statusCode = 500
      res.end(err + '\n')
    }
  }
  function write (row, enc, next) {
    next(null, row.name + '\n')
  }
})
router.addRoute('GET /media/:file', function (req, res, m) {
  var r = m.archive.createFileReadStream(m.params.file)
  r.once('error', function (err) {
    res.setHeader('content-type', 'text/plain')
    res.statusCode = 404
    res.end(err + '\n')
  })
  res.setHeader('content-type', mime.lookup(m.params.file))
  r.pipe(res)
})

router.addRoute('POST /media/create', function (req, res, m) {
  // shared state between parser + writer
  var file
  var error
  var dst
  var bufferedChunks = []

  var writeStream = through(function (chunk, enc, next) {
    if (file == null && error == null) {
      bufferedChunks.push(chunk)
      return next()
    }

    if (file != null && dst == null) {
      dst = m.archive.createFileWriteStream(file, { live: false })
      this.pipe(dst)

      bufferedChunks.forEach(function (x) {
        this.push(x)
      }, this)
      bufferedChunks = null
    }

    next(error, chunk)
  })
  var parseStream = typeDetector()

  // buffer request so that it can be sent to an appropriate stream once one is determined
  // pipe the request into 2 streams:
  // 1) writeStream - custom stream that will block / queue until a filename has been set
  // 2) a chain of metadata streams that determine the input type and extract dates if available
  // Note: these are not connected using pump(), as all parsing errors would cause the
  // writeStream to error out (e.g. unknown code), resulting in canceled / partial writes

  req.pipe(writeStream)
  req.pipe(parseStream).pipe(through.obj((marker, enc, next) => {
    if (marker.type === 'EXIF') {
      var date = marker.exif.DateTimeOriginal || marker.image.ModifyDate
      if (date) file = getFilename('jpg', date)
    }
    next()
  }, () => {
    file = file || getFilename('jpg')
  }))

  writeStream.on('error', (err) => {
    res.statusCode = 500
    res.end(err + '\n')
  })

  writeStream.on('finish', () => {
    res.end(file)
  })

  parseStream.on('error', err => {
    if (err.message.startsWith('unknown code')) {
      return
    }

    // propagate the error to bufferedStream (to prevent writes / abort)
    error = err
  })

  function getFilename (ext, date) {
    date = date || new Date()
    var hex = randombytes(4).toString('hex')
    return strftime('%F-%H.%M.%S', date) + '-' + hex + '.' + ext
  }
})
router.addRoute('POST /obs/create', function (req, res, m) {
  body(req, res, function (err, doc) {
    if (err) {
      res.statusCode = 400
      return res.end(err + '\n')
    } else if (!doc || !/^observation(|-link)$/.test(doc.type)) {
      res.statusCode = 400
      return res.end('type must be observation or observation-link\n')
    }
    m.osm.create(doc, function (err, key, node) {
      if (err) {
        res.statusCode = 500
        res.end(err + '\n')
      } else {
        res.end(key + '\n')
      }
    })
  })
})
router.addRoute('GET /obs/links/:id', function (req, res, m) {
  pump(m.obs.links(m.params.id), through.obj(write), res, done)
  function write (row, enc, next) {
    next(null, JSON.stringify(row) + '\n')
  }
  function done (err) {
    if (err) {
      res.statusCode = 500
      res.end(err + '\n')
    }
  }
})
router.addRoute('GET /obs/list', function (req, res, m) {
  pump(m.osm.log.createReadStream(), through.obj(write), res, done)
  function write (row, enc, next) {
    var v = row.value && row.value.v || {}
    if (v.type === 'observation') {
      next(null, JSON.stringify(xtend({ id: row.value.k }, v)) + '\n')
    } else next()
  }
  function done (err) {
    if (err) {
      res.statusCode = 500
      res.end(err + '\n')
    }
  }
})

module.exports = function (osmdir) {
  var mediadir = path.join(osmdir, 'media')
  mkdirp.sync(mediadir)
  var obsdb = level(path.join(osmdir, 'obsdb'))
  var drivedb = level(path.join(osmdir, 'drivedb'))
  var osm = osmdb(osmdir)
  var h = {
    osm: osm,
    archive: drive(drivedb, { dir: mediadir }),
    obs: osmobs({ db: obsdb, log: osm.log })
  }
  var handler = function (req, res) {
    console.log(req.method, req.url)
    var m = router.match(req.method + ' ' + req.url)
    if (m) m.fn(req, res, xtend({ params: m.params }, h))
    else {
      res.statusCode = 404
      res.end('not found\n')
    }
  }
  handler.log = osm.log
  return handler
}
