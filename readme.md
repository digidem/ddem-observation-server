# ddem-observation-server

# routes

## GET /media/list

Return a newline-separated list of media filenames.

## GET /media/:file

Return the contents of a particular file.

## POST /media/jpg

Upload a jpeg file. The contents of upload should be the image data itself.

## POST /obs/create

Create an observation or observation-link document. The body of the POST data
should be json with `content-type: application/json`.

You must set the type to either `observation` or `observation-link`.
Consult the documentation for [osm-p2p-observations][1] for more information.

[1]: https://npmjs.com/package/osm-p2p-observations

## GET /obs/links/:id

Return a newline-separated list of ids which link to the provided `:id`..

## GET /obs/list

Return a newline-separated list of JSON documents for each observation in the
database.

# data

Data is stored in `path.join(require('ospath').data(), 'mapfilter-osm-p2p')`.
