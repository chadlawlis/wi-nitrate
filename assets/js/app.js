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

  var nitGridVis = 'visible';
  var nitGridBreaks = [];

  var canPointGrid;

  var canGridVis = 'visible';
  var canGridBreaks = [];

  var grid;
  var gridVis = 'visible';
  var gridBreaks = [];
  // var gridColors = ['#0571b0', '#92c5de', '#f7f7f7', '#f4a582', '#ca0020'];
  // var gridColors = ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c'];
  var gridColors = ['#7b3294', '#c2a5cf', '#f7f7f7', '#a6dba0', '#008837'];

  var weight = 2;
  var cellSize = 6; // !!! cellSize must be >= 6 for each grid hexbin to intersect a canPointGrid point !!!

  var regressionEquation;
  var rSquared;

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

    // Create map style switcher structure
    var layersToggle = document.getElementById('layers-toggle'); // Create "layers-toggle" parent div
    layersToggle.className = 'layers-toggle map-overlay';

    var layersImage = document.createElement('div'); // Create "layers-image" div with Leaflet layers icon; default display
    layersImage.id = 'layers-image';
    layersImage.className = 'layers-image';
    var layersImageAnchor = document.createElement('a');
    var layersImageIcon = document.createElement('img');
    layersImageIcon.src = 'assets/img/layers.png';
    layersImageIcon.className = 'layers-icon';
    layersImageIcon.alt = 'layers icon';
    layersImageAnchor.appendChild(layersImageIcon);
    layersImage.appendChild(layersImageAnchor);
    layersToggle.appendChild(layersImage);

    var layersMenu = document.createElement('div'); // Create "layers-menu" div; displays on mouseover
    layersMenu.id = 'layers-menu';
    layersMenu.className = 'layers-menu';

    var overlayLayersMenu = document.createElement('div');
    overlayLayersMenu.id = 'overlay-layers-menu';
    overlayLayersMenu.className = 'layers-form-menu';

    var tractsOverlayToggle = document.createElement('div');
    tractsOverlayToggle.className = 'overlay-layer-checkbox toggle';
    var tractsOverlayToggleInput = document.createElement('input');
    tractsOverlayToggleInput.type = 'checkbox';
    tractsOverlayToggleInput.id = 'tracts-checkbox-input';
    tractsOverlayToggleInput.checked = true;
    var tractsOverlayToggleLabel = document.createElement('label');
    tractsOverlayToggleLabel.textContent = 'Tracts';
    tractsOverlayToggle.appendChild(tractsOverlayToggleInput);
    tractsOverlayToggle.appendChild(tractsOverlayToggleLabel);
    overlayLayersMenu.appendChild(tractsOverlayToggle);

    tractsOverlayToggleInput.addEventListener('change', function (e) {
      map.setLayoutProperty('tracts', 'visibility', e.target.checked ? 'visible' : 'none');
      tractsVis = map.getLayoutProperty('tracts', 'visibility');
    });

    var wellsOverlayToggle = document.createElement('div');
    wellsOverlayToggle.className = 'overlay-layer-checkbox toggle';
    var wellsOverlayToggleInput = document.createElement('input');
    wellsOverlayToggleInput.type = 'checkbox';
    wellsOverlayToggleInput.id = 'wells-checkbox-input';
    wellsOverlayToggleInput.checked = true;
    var wellsOverlayToggleLabel = document.createElement('label');
    wellsOverlayToggleLabel.textContent = 'Wells';
    wellsOverlayToggle.appendChild(wellsOverlayToggleInput);
    wellsOverlayToggle.appendChild(wellsOverlayToggleLabel);
    overlayLayersMenu.appendChild(wellsOverlayToggle);

    wellsOverlayToggleInput.addEventListener('change', function (e) {
      map.setLayoutProperty('wells', 'visibility', e.target.checked ? 'visible' : 'none');
      wellsVis = map.getLayoutProperty('wells', 'visibility');
    });

    layersMenu.appendChild(overlayLayersMenu);
    layersToggle.appendChild(layersMenu);

    layersToggle.addEventListener('mouseover', function (e) {
      layersMenu.style.display = 'block'; // Display layer switcher menu on hover ..
      layersImage.style.display = 'none'; // ... replacing layers icon
    });

    layersToggle.addEventListener('mouseout', function (e) {
      layersImage.style.display = 'block'; // Return to default display of layers icon on mouseout ...
      layersMenu.style.display = 'none'; // ... hiding layer switcher menu
    });

    var form = document.getElementById('form');
    form.className = 'map-overlay bottom-left';

    var title = document.createElement('div');
    title.id = 'title';
    title.className = 'form form-menu title';
    title.innerHTML = '<h1>Nitrate & Cancer in WI</h1>' +
    '<p>Explore the relationship between well water nitrate concentrations and cancer rates in Wisconsin' +
    '&nbsp;<a href="#about"><i class="fas fa-question-circle small" title="About"></i></a></p>'; // "&nbsp;" = non-breaking space
    form.appendChild(title);

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

      // Add map sources
      addSource('tracts', tracts);
      addSource('wells', wells);

      // Calculate breakpoints
      tractsBreaks = calcBreaks(tracts, 'tracts', 'canrate');
      wellsBreaks = calcBreaks(wells, 'wells', 'nitconc');

      // Add map layers
      mapTracts('tracts', 'canrate', tractsBreaks, tractsColors);
      mapWells('wells', 'nitconc', wellsBreaks, wellsColors);

      addPopups('tracts', 'geoid', 'Tract #', 'canrate', 'Cancer Rate');
      addPopups('wells', 'id', 'Well #', 'nitconc', 'Nitrate Concentration');

      // TODO
      // Create legend
      // REMEMBER TO CONVERT DECIMAL TO PERCENTAGE INTEGER FOR TRACT/CANCER INTERPOLATION LEGEND LABELS

      // // Generate interpolated hexbin grid on well nitrate concentrations
      // grid = interpolate(wells, 'hex', 'nitconc', weight, cellSize);
      //
      // // Generate interpolated point grid on tract centroid cancer rates
      // canPointGrid = interpolate(tractCentroids, 'point', 'canrate', weight, cellSize);
      //
      // // Merge "canrate" property from canPointGrid into grid as "values" property (array)
      // joinGrid();
      //
      // // Calculate "canrate_predicted" via linear regression
      // // along with residuals and standard deviation of residuals breaks for symbolizing
      // calcRegression();
      //
      // addSource('grid', grid);

      // // Calculate interpolated nitrate concentrations hexbin grid breakpoints
      // nitGridBreaks = calcBreaks(grid, 'nitGrid', 'nitconc');
      //
      // // Map interpolated nitrate concentrations hexbin grid
      // mapGrid('nitGrid', 'grid', 'nitconc', nitGridVis, nitGridBreaks, wellsColors);

      // // Calculate interpolated cancer rate breakpoints for hexbins
      // canGridBreaks = calcBreaks(grid, 'canGrid', 'canrate');
      //
      // // Map interpolated cancer rates hexbin grid
      // mapGrid('canGrid', 'grid', 'canrate', canGridVis, canGridBreaks, tractsColors);

      // // Map cancer rate residuals (observed - predicted) to standard deviation of residuals breakpoints
      // mapGrid('residuals', 'grid', 'residual', gridVis, gridBreaks, gridColors);
      //
      // // For testing (?)
      // // TODO: BUILD LOGIC INTO addPopups FUNCTION
      // addGridPopups();

      // For testing / beta demo
      // addSource('tractCentroids', tractCentroids);
      // mapPoints('tractCentroids');

      // For testing
      // addSource('canPointGrid', canPointGrid);
      // mapPoints('canPointGrid');

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
    var lineLayerName = layerName + '-line';

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
      id: lineLayerName,
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

      // TODO: ADD LOGIC FOR NITRATE INTERPOLATION, CANCER INTERPOLATION, AND REGRESSION
      if (layerName === 'tracts') {
        popupContent = '<div class="popup-menu"><p><b>' + titleAttrAlias + props[titleAttr] + '</b></p></div><hr>' +
        '<div class="popup-menu"><p><b>' + attrAlias + '</b></p><p>' + Math.round(props[attr] * 100) + '%</p></div>';
      } else if (layerName === 'wells') {
        popupContent = '<div class="popup-menu"><p><b>' + titleAttrAlias + props[titleAttr] + '</b></p></div><hr>' +
        '<div class="popup-menu"><p><b>' + attrAlias + '</b></p><p>' + props[attr] + ' ppm</p></div>';
      }

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

  function addGridPopups () {
    map.on('mousemove', 'residuals', function (e) {
      // Change cursor to pointer on mouseover
      map.getCanvas().style.cursor = 'pointer';

      var popupContent;
      var props = e.features[0].properties;

      popupContent = '<div class="popup-menu"><p><b>nitconc:</b> ' + props.nitconc + '</p>' +
      '<p><b>values:</b> ' + props.values + '</p>' +
      '<p><b>canrate:</b> ' + props.canrate + '</p>' +
      '<p><b>canrate_predicted:</b> ' + props.canrate_predicted + '</p>' +
      '<p><b>residual:</b> ' + props.residual + '</p></div>';

      popup.setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(map);
    });

    map.on('mouseleave', 'residuals', function () {
      // Change cursor back to default ("grab") on mouseleave
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }

  function interpolate (input, gridType, attr, weight, cellSize) {
    var options = {
      gridType: gridType, // 1392 overlapping tractCentroids w/ square gridType, 1383 w/ hex
      property: attr,
      weight: weight,
      units: 'kilometers'
    };

    var interpolation = turf.interpolate(input, cellSize, options);

    interpolation.features.forEach(function (d) {
      d.properties[attr] = parseFloat(d.properties[attr].toFixed(4));
    });

    return interpolation;
  }

  function joinGrid () {
    // Remove "canrate" property if previously joined to grid
    if (grid.features[0].properties.canrate) {
      grid.features.forEach(function (d) {
        delete d.properties.canrate;
      });
    }

    // Remove "values" property (array of collected canrate values) if previously joined to grid
    if (grid.features[0].properties.values) {
      grid.features.forEach(function (d) {
        delete d.properties.values;
      });
    }

    // Merge "canrate" property from canPointGrid into grid as "values" property (array)
    turf.collect(grid, canPointGrid, 'canrate', 'values');

    // Calculate average canrate and add as property to grid features
    grid.features.forEach(function (d) {
      if (d.properties.values) {
        var values = d.properties.values;

        var count = values.length;
        var sum = 0;

        for (var i in values) {
          sum += parseFloat(values[i]);
        }

        d.properties.canrate = parseFloat((sum / count).toFixed(4));
      }
    });

    console.log(grid);
  }

  function calcRegression () {
    // Remove "canrate_predicted" property if previously calculated
    if (grid.features[0].properties.canrate_predicted) {
      grid.features.forEach(function (d) {
        delete d.properties.canrate_predicted;
      });
    }

    // Remove "residual" property if previously calculated
    if (grid.features[0].properties.residual) {
      grid.features.forEach(function (d) {
        delete d.properties.residual;
      });
    }

    var regressionCoords = [];
    var residuals = [];

    grid.features.forEach(function (d) {
      // Create [x, y] arrays for regression calculation using nitrate concentration as x, cancer rate as y
      var coord = [d.properties.nitconc, d.properties.canrate];
      regressionCoords.push(coord);
    });

    // Calculate regression to find slope and y-intercept of regression line
    var regression = ss.linearRegression(regressionCoords);
    console.log(regression);

    var slope = regression.m;
    var yIntercept = regression.b;

    regressionEquation = 'y = ' + slope.toFixed(4) + 'x + ' + yIntercept.toFixed(4);
    console.log(regressionEquation);

    grid.features.forEach(function (d) {
      // Calculate predicted cancer rate using regression equation output
      var predictedCanrate = parseFloat((slope * d.properties.nitconc + yIntercept).toFixed(4));
      // Residual = observed - predicted
      var residual = parseFloat((d.properties.canrate - predictedCanrate).toFixed(4));

      // Push each residual to "residuals" array for use in standard deviation calculation
      residuals.push(residual);

      // Assign "canrate_predicted" and "residual" properties to each feature
      d.properties.canrate_predicted = predictedCanrate;
      d.properties.residual = residual;
    });

    var regressionLine = ss.linearRegressionLine(regression);

    rSquared = parseFloat((ss.rSquared(regressionCoords, regressionLine)).toFixed(4));
    console.log(rSquared);

    var stanDev = ss.sampleStandardDeviation(residuals);

    // value < gridBreaks[0] (< -2 stanDev)
    // gridBreaks[0] <= value <= gridBreaks[1] (-2 stanDev <= value <= -1 standDev)
    // gridBreaks[1] <= value <= gridBreaks[2] (-1 stanDev <= value <= 1 standDev)
    // gridBreaks[2] <= value <= gridBreaks[3] (1 stanDev <= value <= 2 standDev)
    // value > gridBreaks[3] (value > 2 standDev)
    gridBreaks = [parseFloat((-2 * stanDev).toFixed(4)), parseFloat((-1 * stanDev).toFixed(4)), parseFloat(stanDev.toFixed(4)), parseFloat((2 * stanDev).toFixed(4))];
    console.log(gridBreaks);
  }

  function mapGrid (layerName, sourceName, attr, vis, breaks, colors) {
    var lineLayerName = layerName + '-line';

    if (map.getLayer(layerName)) {
      map.removeLayer(layerName);
    }

    if (map.getLayer(lineLayerName)) {
      map.removeLayer(lineLayerName);
    }

    map.addLayer({
      id: layerName,
      type: 'fill',
      source: sourceName,
      layout: {
        visibility: vis
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
      id: lineLayerName,
      type: 'line',
      source: sourceName,
      layout: {
        visibility: gridVis
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

  function mapPoints (layerName) {
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
