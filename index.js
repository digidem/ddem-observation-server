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
var symgroup = require('symmetric-protocol-group')
var body = require('body/any')

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
  function end (next) { next() }
})
router.addRoute('GET /media/:link/:name', function (req, res, m) {
  var entry = { link: m.params.link, name: m.params.name }
  var r = m.archive.createFileReadStream(entry)
  r.once('error', function (err) {
    res.setHeader('content-type', 'text/plain')
    res.statusCode = 404
    res.end(err + '\n')
  })
  res.setHeader('content-type', mime.lookup(m.params.name))
  r.pipe(res)
})
router.addRoute('POST /media/jpg', function (req, res, m) {
  var r = pump(req, through())
  var sent = false
  var j = jpeg()
  j.on('error', function (err) {
    // parsing didn't work, use current time
    end()
  })
  req.pipe(j).pipe(through.obj(write, end))

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
    var w = m.archive.createFileWriteStream(file, { live: false })
    w.on('error', function (err) {
      res.statusCode = 500
      res.end(err + '\n')
    })
    w.once('finish', function () { // doesn't work
      res.end(m.archive.key.toString('hex') + '/' + file + '\n')
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
router.addRoute('POST /replicate', function (req, res, m) {
  var sent = false
  body(req, res, function (err, params) {
    if (err) return error(err)
    if (!params.dir) return error('dir not given')
    var dst = create(params.dir)
    var pending = 2
    var a = rep(m, done)
    var b = rep(dst, done)
    a.pipe(b).pipe(a)
    function done () {
      console.log('done', pending)
      if (--pending === 0) res.end('ok\n')
    }
  })
  function rep (x, cb) {
    var archive = x.archive.replicate()
    setTimeout(function () {
      console.log('BEGIN')
      x.archive.list({ live: false }, function (err, entries) {
        var pending = entries.length
        entries.forEach(function (entry) {
          x.archive.download(entry, function (err) {
            console.log('P', pending)
            if (--pending === 0) done()
          })
        })
        console.log('E', entries)
      })
      function done () {
        x.archive.close()
        archive.emit('end')
      }
    }, 2000)
    var log = x.osm.log.replicate({ live: false })
    return symgroup({
      archive: archive,
      log: log
    }, cb)
  }
  function error (err) {
    if (sent) return
    sent = true
    res.statusCode = 500
    res.end(err + '\n')
  }
})

function create (dir) {
  var osm = osmdb(dir)
  var mediadir = path.join(dir, 'media')
  mkdirp.sync(mediadir)
  var obsdb = level(path.join(dir, 'obsdb'))
  var drivedb = level(path.join(dir, 'drivedb'))
  return {
    osm: osm,
    archive: drive(drivedb, { dir: mediadir }),
    obs: osmobs({ db: obsdb, log: osm.log })
  }
}

module.exports = function (dir) {
  var h = create(dir)
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
