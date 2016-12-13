var path = require('path')
var strftime = require('strftime')
var jpeg = require('jpeg-marker-stream')
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
var identify = require('./identify-image-stream')

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
  var r = pump(req, through())
  identify(req, function (err, type) {
    if (err) {
      res.statusCode = 500
      res.end(err + '\n')
    } else {
      onTypeKnown(type)
    }
  })

  function onTypeKnown (type) {
    if (type === 'jpg' || type === 'jpeg') {
      handleJpeg()
    } else {
      writeImage(type, new Date())
    }
  }

  function writeImage (ext, date) {
    var hex = randombytes(4).toString('hex')
    var file = strftime('%F-%H.%M.%S', date) + '-' + hex + '.' + ext
    var w = m.archive.createFileWriteStream(file, { live: false })
    w.on('error', function (err) {
      res.statusCode = 500
      res.end(err + '\n')
    })
    w.once('finish', function () { // doesn't work
      res.end(file + '\n')
    })
    r.pipe(w)
  }

  function handleJpeg () {
    var j = jpeg()
    j.on('error', function () {
      // parsing didn't work, use current time
      end()
    })
    req.pipe(j).pipe(through.obj(write, end))

    var exifFound = false

    function write (marker, enc, next) {
      if (marker.type === 'EXIF') {
        var date = marker.exif.DateTimeOriginal || marker.image.ModifyDate
        if (!exifFound && date) writeImage('jpg', date)
        exifFound = true
      }
      next()
    }
    function end () {
      if (!exifFound) writeImage('jpg', new Date())
    }
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
  return function (req, res) {
    console.log(req.method, req.url)
    var m = router.match(req.method + ' ' + req.url)
    if (m) m.fn(req, res, xtend({ params: m.params }, h))
    else {
      res.statusCode = 404
      res.end('not found\n')
    }
  }
}
