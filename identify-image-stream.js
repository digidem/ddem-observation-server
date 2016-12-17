var identify = require('imghdr').what
var jpeg = require('jpeg-marker-stream')
var peek = require('peek-stream')

module.exports = function () {
  return peek({
    maxBuffer: 10,
    newline: false
  }, function (data, swap) {
    var type = identify(data)
    switch (type[0]) {
      case 'jpg':
      case 'jpeg': {
        return swap(null, jpeg())
      }

      default:
        return swap(new Error('unknown type'))
    }
  })
}
