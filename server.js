var http = require('http')
var ospath = require('ospath')
var path = require('path')
var Corsify = require('corsify')

var osmdir = path.join(ospath.data(), 'mapfilter-osm-p2p')
var obs = require('./')(osmdir)
var server = http.createServer(Corsify(obs))
server.listen(3210)
