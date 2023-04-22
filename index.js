#!/usr/bin/env node

const argv = require('minimist')(process.argv.slice(2))
const sqlite3 = require('sqlite3')
const shaver = require('@mapbox/vtshaver')
const fs = require('fs')
const pako = require('pako')
const async = require('async')

if (!('db' in argv) || !('filter' in argv)) {
    console.log("Usage: ./index.js --db pack.db --filter filter.json")
    process.exit(1)
}

console.log(`Shaving ${argv.db} using ${argv.filter}`)

// Mapbox GL Offline Pack
const db = new sqlite3.Database(argv.db)

const filtersMetadata = JSON.parse(fs.readFileSync(argv.filter))

db.each("SELECT data FROM resources WHERE kind = 2", {}, function (err, row) {
  if (err) {
    console.log('Error reading TileJSON resources', err)
    process.exit(1)
  }

  const sourceLayers = JSON.parse(new TextDecoder('utf-8').decode(pako.inflate(row.data))).vector_layers
    .map(vector_layer => vector_layer.id)
  
  // set default allow filter metadata for all layers not in filters
  sourceLayers.forEach(sourceLayer => {
    if (!(sourceLayer in filtersMetadata)) {
      filtersMetadata[sourceLayer] = true
    }
  })
}, function (err, vtDataResourcesCount) {
  // console.log(JSON.stringify(filtersMetadata, null, 2))

  // shaver.Filters does not accept a simple true/false value, so expand these into something it understands
  for (const [key, value] of Object.entries(filtersMetadata)) {
    if (value === true) {
      filtersMetadata[key] = {
        filters: true,
        minzoom: 0,
        maxzoom: 22,
        properties: true
      }
    } else if (value === false) {
      filtersMetadata[key] = {
        filters: ["==", "foo", "false"],
        minzoom: 0,
        maxzoom: 22,
        properties: []
      }
    }
  }

  const filters = new shaver.Filters(filtersMetadata)

  // tile index
  let index = 0

  const tiles = []

  // read list of tiles
  db.each("SELECT x, y, z, data, compressed, url_template, pixel_ratio, expires, modified, etag, accessed, must_revalidate FROM tiles ORDER BY z, y, x;", {}, function(err, row) {
      tiles.push(row)

      if (err) {
          console.log('Error reading tile: ', err)
          process.exit(1);
      }
  }, function (err, count) {
      console.log(`Found ${count} tiles`)

      if (err) {
          console.log('Error selecting tiles ', err)
          process.exit(1)
      }

      // for each tile
      async.eachSeries(tiles, (row, cb) => {
          index++

          let unshavedTile

          if (row.compressed === 0) {
              unshavedTile = row.data
          } else {
              try {
                  unshavedTile = pako.inflate(row.data)
              } catch (e) {
                  console.error('Tile data error:', e, row.z, row.x, row.y)
                  process.exit(1)
              }
          }

          const shaveOptions = {
              filters: filters,
              zoom: row.z
          }

          shaver.shave(unshavedTile, shaveOptions, (err, shavedTile) => {
              if (err) {
                  console.error('Error shaving tile:', row.z, row.x, row.y, err)
                  process.exit(1)
              }

              const newTile = pako.deflate(shavedTile)

              db.run('UPDATE tiles SET data = $data, compressed = 1 WHERE x = $x AND y = $y AND z = $z', {
                  $data: newTile,
                  $x: row.x,
                  $y: row.y,
                  $z: row.z
              }, errUpdate => {
                  if (errUpdate) {
                      console.log('Error updating tile: ', errUpdate);
                  }

                  if (index % 1 === 0) {
                      process.stdout.clearLine(0);
                      process.stdout.cursorTo(0);
                      process.stdout.write(`${row.z}/${row.x}/${row.y}: ${index} of ${tiles.length}, ${Math.round((index + 1) * 100 / tiles.length)}%`)
                  }
                  cb(null, null);
              })
          })

      }, (err) => {
          process.stdout.write("\n")
          console.log('VACUUM')
          db.run('VACUUM', err => {
            console.log('closing database')
            db.close()
          })
      })
  })
})
