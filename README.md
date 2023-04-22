# mbgl-offline shaver

Utility to shave layers and features from a mbgl-offline pack.

## Usage

    ./index.js --db mbgl-offline.db --filter filter.json

Example `filter.json`:

```json
{
  "road": {
    "filters": ["==", "class", "path"],
    "minzoom": 0,
    "maxzoom": 22,
    "properties": true
  },
  "water": true,
  "land": false
  ...
}
```
