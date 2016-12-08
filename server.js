var http = require('http')
var fs = require('fs')
var ospath = require('ospath')
var path = require('path')
var strftime = require('strftime')
var jpeg = require('jpeg-marker-stream')
var through = require('through2')
var randombytes = require('randombytes')
var mkdirp = require('mkdirp')

var level = require('level')
var osmdb = require('osm-p2p')
var osmobs = require('osm-p2p-observations')

var osmdir = path.join(ospath.data(), 'mapfilter-osm-p2p')
var mediadir = path.join(osmdir, 'media')
mkdirp.sync(mediadir)

var obsdb = level(path.join(osmdir, 'obsdb'))
var drivedb = level(path.join(osmdir, 'drivedb'))
var osm = osmdb(osmdir)
var obs = osmobs({ db: obsdb, log: osm.log })
var archive = require('./lib/drive.js')(drivedb, { dir: mediadir })

var router = require('routes')()
router.addRoute('GET /media/:id', function (req, res, m) {
})
router.addRoute('POST /upload/jpg', function (req, res, m) {
  var r = through()
  var j = jpeg()
  j.pipe(through.obj(write, end))
  req.pipe(j)
  req.pipe(r)

  function write (marker, enc, next) {
    if (marker.type === 'EXIF') {
      fromDate(marker.image.ModifyDate || new Date)
      this.destroy()
    }
    next()
  }
  function end () {
    fromDate(new Date)
  }

  function fromDate (date) {
    var hex = randombytes(4).toString('hex')
    var file = strftime('%F-%H.%M.%S', date) + '-' + hex + '.jpg'
    console.log('create file', file)
    var w = archive.createFileWriteStream(file, { live: false })
    w.on('error', function (err) {
      console.log('ERR', err)
      res.statusCode = 500
      res.end(err + '\n')
    })
    w.once('finish', function () { // doesn't work
      res.end(file)
    })
    r.pipe(w)
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
