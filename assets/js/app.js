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
  var firstLandUseId;

  var tracts;
  var tractsVis = 'visible';
  var tractsBreaks = [];
  var tractsColors = ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'];
  var wells;
  var wellsVis = 'visible';
  var wellsBreaks = [];
  var wellsColors = ['#fef0d9', '#fdcc8a', '#fc8d59', '#e34a33', '#b30000'];

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

  // Animate spinner when map source begins loading / changing
  // https://docs.mapbox.com/mapbox-gl-js/api/#map.event:sourcedataloading
  // https://docs.mapbox.com/mapbox-gl-js/api/#mapdataevent
  // map.on('sourcedataloading', function (event) {
  //   // if (event.source.type === 'geojson') {
  //   //   console.log('sourcedataloading:', event.source);
  //   // }
  //   spinner.spin(target);
  // });

  // Stop spinner when map source loads / changes
  // https://docs.mapbox.com/mapbox-gl-js/api/#map.event:sourcedata
  // map.on('sourcedata', function (event) {
  //   // if (event.source.type === 'geojson') {
  //   //   console.log('sourcedata:', event.source);
  //   // }
  //   spinner.stop();
  // });

  map.on('load', function () {
    // Set minZoom as floor of (rounded down to nearest integer from) fitBounds zoom
    var minZoom = map.getZoom();
    map.setMinZoom(Math.floor(minZoom));

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

      // Round nitrate levels to two decimal places
      wells.features.forEach(function (d) {
        d.properties.nitconc = parseFloat(d.properties.nitconc.toFixed(2));
      });

      // Calculate breakpoints
      tractsBreaks = calcBreaks(tracts, 'canrate');
      wellsBreaks = calcBreaks(wells, 'nitconc');

      // Add map sources
      addSource('tracts', tracts);
      addSource('wells', wells);

      // Add map layers
      mapTracts('tracts', 'canrate', tractsBreaks, tractsColors);
      mapWells('wells', 'nitconc', wellsBreaks, wellsColors);

      addPopups('tracts', 'canrate', 'Cancer Rate');
      addPopups('wells', 'nitconc', 'Nitrate Concentration');

      // Create legend

      // Stop spinner once all page load functions have been called
      spinner.stop();
    });
  }

  function calcBreaks (input, attr) {
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
      return d3.min(d);
    });

    // Use native JS shift() method to remove first value from breaks array
    // to create actual breakpoints for Mapbox (minimum value of each break is included in classification)
    breaks.shift();

    return breaks;
  }

  function addSource (sourceName, sourceData) {
    map.addSource(sourceName, {
      type: 'geojson',
      data: sourceData
    });
  }

  function mapTracts (layerName, attr, breaks, colors) {
    mapLayers = map.getStyle().layers;

    // Find the index of the settlement-label layer in the loaded map style, to place new layer below
    for (let i = 0; i < mapLayers.length; i++) {
      if (mapLayers[i].id === 'settlement-label') {
        firstLandUseId = mapLayers[i].id;
        break;
      }
    }

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
    }, firstLandUseId);

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
    }, firstLandUseId);
  }

  function mapWells (layerName, attr, breaks, colors) {
    mapLayers = map.getStyle().layers;

    // Find the index of the settlement-label layer in the loaded map style, to place new layer below
    for (let i = 0; i < mapLayers.length; i++) {
      if (mapLayers[i].id === 'settlement-label') {
        firstLandUseId = mapLayers[i].id;
        break;
      }
    }

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
    }, firstLandUseId);
  }

  function addPopups (layerName, attr, attrAlias) {
    // Change cursor to pointer on mouseover
    map.on('mousemove', layerName, function (e) {
      map.getCanvas().style.cursor = 'pointer';

      var popupContent;
      var props = e.features[0].properties;

      popupContent = '<div class="popup-menu"><p><b>' + attrAlias + '</b></p><p>' + props[attr] + '</p>';

      popup.setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(map);
    });

    // Change cursor back to default ("grab") on mouseleave
    map.on('mouseleave', layerName, function () {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }
})();
