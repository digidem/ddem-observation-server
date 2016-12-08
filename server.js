var http = require('http')
var fs = require('fs')
var ospath = require('ospath')
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

var osmdir = path.join(ospath.data(), 'mapfilter-osm-p2p')
var mediadir = path.join(osmdir, 'media')
mkdirp.sync(mediadir)

var obsdb = level(path.join(osmdir, 'obsdb'))
var drivedb = level(path.join(osmdir, 'drivedb'))
var osm = osmdb(osmdir)
var obs = osmobs({ db: obsdb, log: osm.log })
var archive = require('./lib/drive.js')(drivedb, { dir: mediadir })

var body = require('body/any')
var router = require('routes')()
router.addRoute('GET /media/list', function (req, res, m) {
  res.setHeader('content-type', 'text/plain')
  pump(archive.list({ live: false }),
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
  function end (next) { next() }
})
router.addRoute('GET /media/:file', function (req, res, m) {
  var r = archive.createFileReadStream(m.params.file)
  r.once('error', function (err) {
    res.setHeader('content-type', 'text/plain')
    res.statusCode = 404
    res.end(err + '\n')
  })
  res.setHeader('content-type', mime.lookup(m.params.file))
  r.pipe(res)
})
router.addRoute('POST /media/jpg', function (req, res, m) {
  var r = pump(req, through())
  var sent = false
  pump(req, jpeg(), through.obj(write, end), function (err) {
    if (err && err.message !== 'premature close') {
      res.statusCode = 500
      res.end(err + '\n')
    }
  })
  function write (marker, enc, next) {
    if (marker.type === 'EXIF') {
      var d = marker.exif.DateTimeOriginal || marker.image.ModifyDate
      if (!sent) fromDate(d || new Date)
      sent = true
    }
    next()
  }
  function end () {
    if (!sent) fromDate(new Date)
    sent = true
  }
  function fromDate (date) {
    var hex = randombytes(4).toString('hex')
    var file = strftime('%F-%H.%M.%S', date) + '-' + hex + '.jpg'
    var w = archive.createFileWriteStream(file, { live: false })
    w.on('error', function (err) {
      res.statusCode = 500
      res.end(err + '\n')
    })
    w.once('finish', function () { // doesn't work
      res.end(file + '\n')
    })
    r.pipe(w)
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
    osm.create(doc, function (err, key, node) {
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
  pump(obs.links(m.params.id), through.obj(write), res, done)
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
  pump(osm.log.createReadStream(), through.obj(write), res, done)
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

var server = http.createServer(function (req, res) {
  console.log(req.method, req.url)
  var m = router.match(req.method + ' ' + req.url)
  if (m) m.fn(req, res, m)
  else {
    res.statusCode = 404
    res.end('not found\n')
  }
})
server.listen(3210)
