/* global d3, mapboxgl, ss, turf */

import { Spinner } from './spin.js';

(function () {
  var opts = {
    lines: 13, // The number of lines to draw
    length: 38, // The length of each line
    width: 17, // The line thickness
    radius: 45, // The radius of the inner circle
    scale: 0.6, // Scales overall size of the spinner
    corners: 1, // Corner roundness (0..1)
    color: '#aaa', // CSS color or array of colors
    fadeColor: 'transparent', // CSS color or array of colors
    speed: 1, // Rounds per second
    rotate: 0, // The rotation offset
    animation: 'spinner-line-fade-quick', // The CSS animation name for the lines
    direction: 1, // 1: clockwise, -1: counterclockwise
    zIndex: 2e9, // The z-index (defaults to 2000000000)
    className: 'spinner', // The CSS class to assign to the spinner
    top: '50%', // Top position relative to parent
    left: '50%', // Left position relative to parent
    shadow: '0 0 1px transparent', // Box-shadow for the lines
    position: 'absolute' // Element positioning
  };

  var target = document.getElementById('loading');
  var spinner = new Spinner(opts);

  // Animate spinner on page load
  spinner.spin(target);

  var mapLayers;
  var firstLabelLayer;

  var tracts;
  var tractsVis = 'visible';
  var tractsBreaks = [];
  var tractsColors = ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'];

  var tractCentroids;

  var wells;
  var wellsVis = 'visible';
  var wellsBreaks = [];
  var wellsColors = ['#fef0d9', '#fdcc8a', '#fc8d59', '#e34a33', '#b30000'];

  var nitGrid;
  var nitGridVis = 'visible';
  var nitGridBreaks = [];
  var weight = 2;
  var cellSize = 5;

  mapboxgl.accessToken = 'pk.eyJ1IjoiY2hhZGxhd2xpcyIsImEiOiJlaERjUmxzIn0.P6X84vnEfttg0TZ7RihW1g';

  var map = new mapboxgl.Map({
    container: 'map',
    hash: true,
    maxZoom: 12,
    style: 'mapbox://styles/mapbox/light-v10',
    customAttribution: '<a href="https://chadlawlis.com">Chad Lawlis</a>'
  });

  // [[sw],[ne]]
  var zoomToBounds = [[-92.889433, 42.491912], [-86.750119, 47.309822]];
  var zoomToOptions = {
    linear: true,
    padding: {
      top: 60,
      right: 80,
      bottom: 80,
      left: 80
    }
  };

  map.fitBounds(zoomToBounds, zoomToOptions);

  // Create popup, but don't add it to the map yet
  var popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false
  });

  map.on('load', function () {
    // Set minZoom as floor of (rounded down to nearest integer from) fitBounds zoom
    var minZoom = map.getZoom();
    map.setMinZoom(Math.floor(minZoom));

    mapLayers = map.getStyle().layers;

    // Find the index of the settlement-label layer in the loaded map style, to place added layers below
    for (let i = 0; i < mapLayers.length; i++) {
      if (mapLayers[i].id === 'settlement-label') {
        firstLabelLayer = mapLayers[i].id;
        break;
      }
    }

    // Add zoom and rotation controls
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }));

    // Create custom "zoom to" control and implement as ES6 class
    // https://docs.mapbox.com/mapbox-gl-js/api/#icontrol
    class ZoomToControl {
      onAdd (map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.id = 'zoom-to-control';
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group zoom-to-control';
        this._container.appendChild(document.createElement('button'));
        return this._container;
      }

      onRemove () {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
      }
    }

    // Add custom "zoom to" control to map
    var zoomToControl = new ZoomToControl();
    map.addControl(zoomToControl);

    // Customize "zoom to" control to display custom icon and fitBounds functionality
    // using same usBounds bounding box from page landing extent above
    var zoomControl = document.getElementById('zoom-to-control');
    var zoomButton = zoomControl.firstElementChild;
    zoomButton.id = 'zoom-to-button';
    zoomButton.title = 'Zoom to WI';
    zoomButton.innerHTML = '<img width="20" height="20" src="assets/img/wi.svg">';
    zoomButton.addEventListener('click', function () {
      map.fitBounds(zoomToBounds, zoomToOptions);
    });

    loadData();
  });

  function loadData () {
    var promises = [];

    promises.push(d3.json('assets/data/tracts.json'));
    promises.push(d3.json('assets/data/wells.json'));

    Promise.all(promises).then(function (data) {
      tracts = data[0];
      wells = data[1];

      // Create deep copy tractCentroids of tracts for use in interpolation aggregation and regression
      // (changes to copy tractCentroids properties should not affect original tract properties)
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign
      tractCentroids = JSON.parse(JSON.stringify(tracts));

      // Calculate centroids and set as feature geometry
      tractCentroids.features.forEach(function (d) {
        var centroid = turf.centroid(d.geometry);
        d.geometry = centroid.geometry;
      });

      // Round nitrate levels to two decimal places
      wells.features.forEach(function (d) {
        d.properties.nitconc = parseFloat(d.properties.nitconc.toFixed(2));
      });

      // Calculate breakpoints
      tractsBreaks = calcBreaks(tracts, 'tracts', 'canrate');
      wellsBreaks = calcBreaks(wells, 'wells', 'nitconc');

      // Add map sources
      addSource('tracts', tracts);
      addSource('wells', wells);

      // Add map layers
      mapTracts('tracts', 'canrate', tractsBreaks, tractsColors);
      mapWells('wells', 'nitconc', wellsBreaks, wellsColors);

      addPopups('tracts', 'geoid', 'Tract #', 'canrate', 'Cancer Rate');
      addPopups('wells', 'id', 'Well #', 'nitconc', 'Nitrate Concentration');

      // TODO
      // Create legend

      // // Generate interpolated layer on well nitrate concentrations
      // interpolate(wells, weight, cellSize);
      //
      // // For testing / beta demo
      // nitGridBreaks = calcBreaks(nitGrid, 'nitGrid', 'nitconc');
      // addSource('nitGrid', nitGrid);
      // mapNitGrid('nitGrid', 'nitconc', nitGridBreaks, tractsColors);
      //
      // joinNitGrid(tractCentroids, nitGrid, 'nitconc', 'nitconc');
      //
      // // For testing / beta demo
      // addSource('tractCentroids', tractCentroids);
      // mapTractCentroids('tractCentroids', 'nitconc');

      // TODO
      // Calculate regression (residuals + standard deviation of residuals)
      // -> add predicted canrate + standard deviation of residuals to each tract polygon
      // -> (include if statement to delete these attributes if they exist, i.e., if regression has already been run)
      // Regression calcBreaks (add global variable up top)
      // Regression addSource
      // Regression map (add global variable for colors up top)

      // Stop spinner once all page load functions have been called
      spinner.stop();
    });
  }

  function calcBreaks (input, layerName, attr) {
    var values = [];
    // Build array of all values from input
    input.features.forEach(function (d) {
      var v = d.properties[attr];
      values.push(v);
    });

    // Cluster data using ckmeans algorithm to create natural breaks
    // Use simple-statistics ckmeans() method to generate clusters
    // Returns a nested array, with each cluster an array instantiated with attribute values that comprise it
    var clusters = ss.ckmeans(values, 5);

    // Use native JS map() function to set each item of breaks array to minimum value of its cluster
    // No longer a nested array; results in minimum value of each cluster as each item of array
    var breaks = clusters.map(function (d) {
      // Round to two decimal places
      return parseFloat(d3.min(d).toFixed(2));
    });

    // Use native JS shift() method to remove first value from breaks array
    // to create actual breakpoints for Mapbox (minimum value of each break is included in classification)
    breaks.shift();

    console.log(layerName + 'Breaks', breaks);
    return breaks;
  }

  function addSource (sourceName, sourceData) {
    if (map.getSource(sourceName)) {
      map.removeSource(sourceName);
    }

    map.addSource(sourceName, {
      type: 'geojson',
      data: sourceData
    });
  }

  function mapTracts (layerName, attr, breaks, colors) {
    map.addLayer({
      id: layerName,
      type: 'fill',
      source: layerName,
      layout: {
        visibility: tractsVis
      },
      paint: {
        'fill-color': [
          'step',
          ['get', attr],
          colors[0],
          breaks[0], colors[1],
          breaks[1], colors[2],
          breaks[2], colors[3],
          breaks[3], colors[4]
        ],
        'fill-opacity': 1
      }
    }, firstLabelLayer);

    map.addLayer({
      id: layerName + '-line',
      type: 'line',
      source: layerName,
      layout: {
        visibility: tractsVis
      },
      paint: {
        'line-color': '#fff',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          // when zoom <= 6, line-width: 0.25
          6, 0.25,
          // when zoom >= 12, line-width: 1.5
          12, 1.5
          // in between, line-width will be linearly interpolated between 0.25 and 1.5 pixels
        ]
      }
    }, firstLabelLayer);
  }

  function mapWells (layerName, attr, breaks, colors) {
    map.addLayer({
      id: layerName,
      type: 'circle',
      source: layerName,
      layout: {
        visibility: wellsVis
      },
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          // when zoom <= 4, circle-radius: 2
          4, 2,
          // when zoom >= 12, circle-radius: 6
          12, 6
          // in between, circle-radius will be linearly interpolated between 2 and 6 pixels
        ],
        'circle-color': [
          'step',
          ['get', attr],
          colors[0],
          breaks[0], colors[1],
          breaks[1], colors[2],
          breaks[2], colors[3],
          breaks[3], colors[4]
        ],
        'circle-stroke-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          // when zoom <= 4, circle-stroke-width: 0.25
          4, 0.25,
          // when zoom >= 12, circle-stroke-width: 0.5
          12, 0.5
          // in between, circle-stroke-width will be linearly interpolated between 0.25 and 0.5 pixels
        ],
        'circle-stroke-color': '#333'
      }
    }, firstLabelLayer);
  }

  function addPopups (layerName, titleAttr, titleAttrAlias, attr, attrAlias) {
    map.on('mousemove', layerName, function (e) {
      // Change cursor to pointer on mouseover
      map.getCanvas().style.cursor = 'pointer';

      var popupContent;
      var props = e.features[0].properties;

      popupContent = '<div class="popup-menu"><p><b>' + titleAttrAlias + props[titleAttr] + '</b></p></div><hr>' +
      '<div class="popup-menu"><p><b>' + attrAlias + '</b></p><p>' + props[attr] + '</p></div>';

      popup.setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(map);
    });

    map.on('mouseleave', layerName, function () {
      // Change cursor back to default ("grab") on mouseleave
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }

  function interpolate (input, weight, cellSize) {
    var options = {
      gridType: 'square', // 1392 overlapping tractCentroids w/ square gridType, 1383 w/ hex
      property: 'nitconc',
      weight: weight,
      units: 'kilometers'
    };

    nitGrid = turf.interpolate(input, cellSize, options);

    nitGrid.features.forEach(function (d) {
      d.properties.nitconc = parseFloat(d.properties.nitconc.toFixed(2));
    });
  }

  function mapNitGrid (layerName, attr, breaks, colors) {
    if (map.getLayer(layerName)) {
      map.removeLayer(layerName);
    }

    map.addLayer({
      id: layerName,
      type: 'fill',
      source: layerName,
      layout: {
        visibility: nitGridVis
      },
      paint: {
        'fill-color': [
          'step',
          ['get', attr],
          colors[0],
          breaks[0], colors[1],
          breaks[1], colors[2],
          breaks[2], colors[3],
          breaks[3], colors[4]
        ],
        'fill-opacity': 1
      }
    }, firstLabelLayer);

    map.addLayer({
      id: layerName + '-line',
      type: 'line',
      source: layerName,
      layout: {
        visibility: nitGridVis
      },
      paint: {
        'line-color': '#fff',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          // when zoom <= 4, line-width: 0.5
          4, 0.25,
          // when zoom >= 9, line-width: 1.2
          9, 1.2
          // in between, line-width will be linearly interpolated between 0.5 and 1.2 pixels
        ]
      }
    }, firstLabelLayer);
  }

  function joinNitGrid (points, polygons, inputAttr, outputAttr) {
    // Remove nitconc property if previously joined to tract centroids
    if (tractCentroids.features[0].properties.nitconc) {
      tractCentroids.features.forEach(function (d) {
        delete d.properties.nitconc;
      });
    }

    // Spatial join points (tract centroids) to polygons (interpolated hexbins) to assign nitconc to tracts
    // https://turfjs.org/docs/#tag
    tractCentroids = turf.tag(points, polygons, inputAttr, outputAttr);

    // Remove nitconc property if previously joined to tract polygons
    if (tracts.features[0].properties.nitconc) {
      tracts.features.forEach(function (d) {
        delete d.properties.nitconc;
      });
    }

    // Assign nitconc property to tract polygons through join on geoid with tract centroids
    for (let i = 0; i < tracts.features.length; i++) {
      var nitconc = tractCentroids.features[i].properties[outputAttr];
      var cKey = tractCentroids.features[i].properties.geoid;
      var tKey = tracts.features[i].properties.geoid;

      if (cKey === tKey) {
        tracts.features[i].properties[outputAttr] = nitconc;
      }
    }

    var count = 0;
    tractCentroids.features.forEach(function (d) {
      if (d.properties.nitconc) {
        count += 1;
      }
    });
    console.log('Tracts intersecting nitGrid (of 1401):', count);
  }

  function mapTractCentroids (layerName, attr) {
    map.addLayer({
      id: layerName,
      type: 'circle',
      source: layerName,
      paint: {
        'circle-radius': 3,
        'circle-color': '#333',
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#fff'
      }
    });
  }
})();
