var multidrive = require('hyperdrive-multiwriter')
var hyperdrive = require('hyperdrive')
var filestore = require('random-access-file')
var sub = require('subleveldown')
var path = require('path')

var DRIVE = 'd', NAMED = 'n'

module.exports = function (db, opts) {
  var dir = opts.dir
  return multidrive({
    drive: hyperdrive(sub(db, DRIVE)),
    db: sub(db, NAMED),
    live: true,
    file: function (name) {
      var file = path.join(dir, name)
      return filestore(file)
    }
  })
}
