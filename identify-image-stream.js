var identify = require('imghdr').what
var peek = require('peek-stream')

module.exports = function (stream, done) {
  var parse = peek({
    maxBuffer: 10,
    newline: false
  }, function (data, swap) {
    console.log(data)
    var type = identify(data)
    if (!type || type.length === 0) {
      done(new Error('unknown type'))
    } else {
      done(null, type[0])
    }
  })
  stream.pipe(parse)
}
