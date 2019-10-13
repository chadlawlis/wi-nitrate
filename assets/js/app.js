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

  var canColors = ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c']; // blue
  // var canColors = ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f']; // purple

  var nitColors = ['#fef0d9', '#fdcc8a', '#fc8d59', '#e34a33', '#b30000']; // red
  // var nitColors = ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c']; // green

  var resColors = ['#0571b0', '#92c5de', '#f7f7f7', '#f4a582', '#ca0020']; // red/white/blue
  // var resColors = ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c']; // red/yellow/blue
  // var resColors = ['#7b3294', '#c2a5cf', '#f7f7f7', '#a6dba0', '#008837']; // purple/white/green

  // var resColors = ['#d73027', '#fc8d59', '#fee090', '#ffffbf', '#e0f3f8', '#91bfdb', '#4575b4'] // red/white/blue
  // var resColors = ['#762a83', '#af8dc3', '#e7d4e8', '#f7f7f7', '#d9f0d3', '#7fbf7b', '#1b7837']; // purple/white/green

  var tracts,
    tractCentroids,
    wells,
    canPointGrid,
    grid,
    regressionEquation,
    rSquared;

  var distDecay; // 2-100
  var cellSize; // 6-15; cellSize must be >= 6 for each grid hexbin to intersect a canPointGrid point

  // Declare sample data layers as objects of array
  var sampleLayers = [{
    label: 'Census Tracts',
    id: 'tracts',
    source: {},
    sourceName: 'tracts',
    visibility: 'visible',
    uid: 'geoid',
    uidAlias: 'Tract #',
    attr: 'canrate',
    attrAlias: 'Cancer Rate',
    breaks: [],
    colors: canColors
  }, {
    label: 'Test Wells',
    id: 'wells',
    source: {},
    sourceName: 'wells',
    visibility: 'visible',
    uid: 'id',
    uidAlias: 'Well #',
    attr: 'nitconc',
    attrAlias: 'Nitrate Concentration',
    breaks: [],
    colors: nitColors
  }];

  // Declare regression layers as objects of array
  var regressionLayers = [{
    label: 'Regression',
    id: 'residuals',
    source: {},
    sourceName: 'grid',
    visibility: 'visible',
    attr: 'residual',
    breaks: [],
    colors: resColors
  }, {
    label: 'Nitrate Interpolation',
    id: 'nitconc-grid',
    source: {},
    sourceName: 'grid',
    visibility: 'none',
    attr: 'nitconc',
    breaks: [],
    colors: nitColors
  }, {
    label: 'Cancer Interpolation',
    id: 'canrate-grid',
    source: {},
    sourceName: 'grid',
    visibility: 'none',
    attr: 'canrate',
    breaks: [],
    colors: canColors
  }];

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
    zoomButton.addEventListener('click', function () {
      map.fitBounds(zoomToBounds, zoomToOptions);
    });

    // Create map style switcher structure
    var layersToggle = document.getElementById('layers-toggle'); // Create "layers-toggle" parent div
    layersToggle.className = 'layers-toggle map-overlay';

    var layersImage = document.createElement('div'); // Create "layers-image" div with Leaflet layers icon; default display
    layersImage.className = 'layers-image';
    var layersImageAnchor = document.createElement('a');
    layersImage.appendChild(layersImageAnchor);
    layersToggle.appendChild(layersImage);

    var layersMenu = document.createElement('div'); // Create "layers-menu" div; displays on mouseover
    layersMenu.className = 'layers-menu';

    var sampleLayersMenu = document.createElement('div');
    sampleLayersMenu.className = 'form-menu sample-layers';

    sampleLayers.forEach(function (l) {
      var layerDiv = document.createElement('div');
      layerDiv.className = 'toggle';
      var layerInput = document.createElement('input');
      layerInput.type = 'checkbox';
      layerInput.id = l.id;
      layerInput.checked = true;
      var layerLabel = document.createElement('label');
      layerLabel.textContent = l.label;
      layerDiv.appendChild(layerInput);
      layerDiv.appendChild(layerLabel);
      sampleLayersMenu.appendChild(layerDiv);

      layerInput.addEventListener('change', function (e) {
        map.setLayoutProperty(l.id, 'visibility', e.target.checked ? 'visible' : 'none');
        l.visibility = map.getLayoutProperty(l.id, 'visibility');

        if (l.id === 'tracts') {
          map.setLayoutProperty(l.id + '-line', 'visibility', e.target.checked ? 'visible' : 'none');
        }
      });
    });

    layersMenu.appendChild(sampleLayersMenu);

    var regressionLayersMenu = document.createElement('div');
    regressionLayersMenu.className = 'form-menu regression-layers';

    regressionLayers.forEach(function (l) { // Instantiate layersMenu with an input for each regression layer declared at top of script
      var layerDiv = document.createElement('div'); // Store each input in a div for vertical list display
      layerDiv.className = 'toggle';
      var layerInput = document.createElement('input');
      layerInput.type = 'radio';
      layerInput.id = l.id;
      layerInput.name = 'regression-layer';
      layerInput.value = l.id;
      layerInput.disabled = true;
      var layerLabel = document.createElement('label');
      layerLabel.for = l.label.toLowerCase();
      layerLabel.textContent = l.label;
      layerDiv.appendChild(layerInput);
      layerDiv.appendChild(layerLabel);
      regressionLayersMenu.appendChild(layerDiv);

      layerInput.addEventListener('click', function (e) {
        var layerId = e.target.id;

        regressionLayers.forEach(function (l) {
          if (layerId === l.id) {
            map.setLayoutProperty(l.id, 'visibility', 'visible');
            map.setLayoutProperty(l.id + '-line', 'visibility', 'visible');
            l.visibility = 'visible';
          } else {
            map.setLayoutProperty(l.id, 'visibility', 'none');
            map.setLayoutProperty(l.id + '-line', 'visibility', 'none');
            l.visibility = 'none';
          }
        });
      });
    });

    layersMenu.appendChild(regressionLayersMenu);

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
    form.className = 'bottom-left map-overlay';

    var title = document.createElement('div');
    title.id = 'title';
    title.className = 'form-menu title';
    title.innerHTML = '<h1>Nitrate & Cancer in WI</h1>' +
    '<p>Explore the relationship between well water nitrate concentrations and cancer rates in Wisconsin' +
    '&nbsp;<a href="#about"><i class="fas fa-question-circle small" title="About"></i></a></p>'; // "&nbsp;" = non-breaking space
    form.appendChild(title);

    var formInputs = document.createElement('form');
    formInputs.id = 'form-inputs';
    formInputs.className = 'form-menu';

    var distDecayLabelDiv = document.createElement('div');
    distDecayLabelDiv.id = 'dist-decay-label';
    distDecayLabelDiv.className = 'form-label';

    var distDecayLabel = document.createElement('label');
    distDecayLabel.innerHTML = '<b class="v-middle">Distance decay coefficient</b>';
    distDecayLabelDiv.appendChild(distDecayLabel);

    var distDecayInputDiv = document.createElement('div');
    distDecayInputDiv.id = 'dist-decay';
    distDecayInputDiv.className = 'dist-decay';

    var distDecayInput = document.createElement('input');
    distDecayInput.id = 'dist-decay-input';
    distDecayInput.className = 'dist-decay-input';
    distDecayInput.type = 'number';
    distDecayInput.name = 'dist-decay';
    distDecayInput.placeholder = '2-100';
    distDecayInput.min = '2';
    distDecayInput.max = '100';
    distDecayInput.required = 'true';

    distDecayInput.addEventListener('change', function () {
      if (distDecayInput.validity.valid && cellSizeInput.validity.valid) {
        if (parseFloat(distDecayInput.value) !== distDecay) {
          submitButton.disabled = false;
        }

        if (parseFloat(distDecayInput.value) === distDecay && parseFloat(cellSizeInput.value) === cellSize) {
          submitButton.disabled = true;
        }
      }
    });

    distDecayInputDiv.appendChild(distDecayInput);

    var distDecayValidity = document.createElement('span');
    distDecayValidity.className = 'validity';
    distDecayInputDiv.appendChild(distDecayValidity);

    formInputs.appendChild(distDecayLabelDiv);
    formInputs.appendChild(distDecayInputDiv);

    var cellSizeLabelDiv = document.createElement('div');
    cellSizeLabelDiv.id = 'cell-size-label';
    cellSizeLabelDiv.className = 'form-label';

    var cellSizeLabel = document.createElement('label');
    cellSizeLabel.innerHTML = '<b class="v-middle">Cell size</b>&nbsp;' +
    '<span class="small v-middle">(KM)</span>';
    cellSizeLabelDiv.appendChild(cellSizeLabel);

    var cellSizeInputDiv = document.createElement('div');
    cellSizeInputDiv.id = 'cell-size';
    cellSizeInputDiv.className = 'cell-size';

    var cellSizeInput = document.createElement('input');
    cellSizeInput.id = 'cell-size-input';
    cellSizeInput.className = 'cell-size-input';
    cellSizeInput.type = 'number';
    cellSizeInput.name = 'cell-size';
    cellSizeInput.placeholder = '6-15';
    cellSizeInput.min = '6';
    cellSizeInput.max = '15';
    cellSizeInput.required = 'true';

    cellSizeInput.addEventListener('change', function () {
      if (cellSizeInput.validity.valid && distDecayInput.validity.valid) {
        if (parseFloat(cellSizeInput.value) !== cellSize) {
          submitButton.disabled = false;
        }

        if (parseFloat(cellSizeInput.value) === cellSize && parseFloat(distDecayInput.value) === distDecay) {
          submitButton.disabled = true;
        }
      }
    });

    cellSizeInputDiv.appendChild(cellSizeInput);

    var cellSizeValidity = document.createElement('span');
    cellSizeValidity.className = 'validity';
    cellSizeInputDiv.appendChild(cellSizeValidity);

    formInputs.appendChild(cellSizeLabelDiv);
    formInputs.appendChild(cellSizeInputDiv);

    form.appendChild(formInputs);

    var formInputButtonsDiv = document.createElement('div');
    formInputButtonsDiv.className = 'form-input-buttons';

    var submitButton = document.createElement('button');
    submitButton.id = 'submit-button';
    submitButton.className = 'input-button';
    submitButton.type = 'button';
    submitButton.disabled = true;
    submitButton.textContent = 'Submit';

    submitButton.addEventListener('click', function () {
      sampleLayers.forEach(function (l) {
        map.setLayoutProperty(l.id, 'visibility', 'none');
        l.visibility = 'none';

        if (l.id === 'tracts') {
          map.setLayoutProperty(l.id + '-line', 'visibility', 'none');
        }

        var input = document.getElementById(l.id);
        input.checked = false;
        input.disabled = true;
      });

      regressionLayers.forEach(function (l) {
        var input = document.getElementById(l.id);
        input.disabled = false;

        if (l.id === 'residuals') {
          input.checked = true;
          l.visibility = 'visible';
        } else {
          l.visibility = 'none';
        }
      });

      distDecay = parseFloat(distDecayInput.value);
      cellSize = parseFloat(cellSizeInput.value);

      calculate();

      submitButton.disabled = true;
      resetButton.disabled = false;
    });

    var resetButton = document.createElement('button');
    resetButton.id = 'reset-button';
    resetButton.className = 'input-button';
    resetButton.type = 'button';
    resetButton.disabled = true;
    resetButton.textContent = 'Reset';

    resetButton.addEventListener('click', function () {
      regressionLayers.forEach(function (l) {
        map.removeLayer(l.id);
        map.removeLayer(l.id + '-line');

        var input = document.getElementById(l.id);
        input.disabled = true;
        input.checked = false;
      });

      map.removeSource('grid');

      sampleLayers.forEach(function (l) {
        map.setLayoutProperty(l.id, 'visibility', 'visible');
        l.visibility = 'visible';

        if (l.id === 'tracts') {
          map.setLayoutProperty(l.id + '-line', 'visibility', 'visible');
        }

        var input = document.getElementById(l.id);
        input.checked = true;
        input.disabled = false;
      });

      distDecay = undefined;
      cellSize = undefined;

      distDecayInput.value = '';
      cellSizeInput.value = '';

      resetButton.disabled = true;
      submitButton.disabled = true;
    });

    formInputButtonsDiv.appendChild(submitButton);
    formInputButtonsDiv.appendChild(resetButton);
    formInputs.appendChild(formInputButtonsDiv);

    loadData();
  });

  function loadData () {
    var promises = [];

    promises.push(d3.json('assets/data/tracts.json'));
    promises.push(d3.json('assets/data/wells.json'));

    Promise.all(promises).then(function (data) {
      tracts = data[0];
      wells = data[1];

      for (let i = 0; i < sampleLayers.length; i++) {
        sampleLayers[i].source = data[i];
      }

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

      // Add sample layers
      sampleLayers.forEach(function (l) {
        addSource(l.sourceName, l.source);
        l.breaks = calcBreaks(l.source, l.id, l.attr);
        mapSampleLayers(l.id, l.sourceName, l.attr, l.visibility, l.breaks, l.colors);
        addPopups(l.id, l.uid, l.uidAlias, l.attr, l.attrAlias);
      });

      // TODO
      // Create legend
      // REMEMBER TO CONVERT DECIMAL TO PERCENTAGE INTEGER FOR TRACT/CANCER INTERPOLATION LEGEND LABELS

      // Stop spinner once all page load functions have been called
      spinner.stop();
    });
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

    console.log(layerName + ' breaks:', breaks);
    return breaks;
  }

  function mapSampleLayers (layerName, sourceName, attr, visibility, breaks, colors) {
    if (layerName === 'tracts') {
      var lineLayerName = layerName + '-line';

      map.addLayer({
        id: layerName,
        type: 'fill',
        source: sourceName,
        layout: {
          visibility: visibility
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
          visibility: visibility
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
    } else if (layerName === 'wells') {
      map.addLayer({
        id: layerName,
        type: 'circle',
        source: layerName,
        layout: {
          visibility: visibility
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

  function calculate () {
    regressionLayers.forEach(function (l) {
      if (map.getLayer(l.id)) {
        map.removeLayer(l.id);
        map.removeLayer(l.id + '-line');
      }
    });

    // Generate interpolated hexbin grid on well nitrate concentrations
    grid = interpolate(wells, 'hex', 'nitconc', distDecay, cellSize);

    // Generate interpolated point grid on tract centroid cancer rates
    canPointGrid = interpolate(tractCentroids, 'point', 'canrate', distDecay, cellSize);

    // Merge "canrate" property from canPointGrid into grid as "values" property (array)
    joinGrid();

    // Calculate "canrate_predicted" via linear regression
    // along with residuals and standard deviation of residuals breaks for symbolizing
    calcRegression();

    console.log('grid:', grid);
    addSource('grid', grid);

    regressionLayers.forEach(function (l) {
      l.source = grid;

      if (l.id !== 'residuals') {
        l.breaks = calcBreaks(l.source, l.id, l.attr);
      }

      mapGrid(l.id, l.sourceName, l.attr, l.visibility, l.breaks, l.colors);
    });

    // TODO: INCLUDE LOGIC FOR nitconc-grid + canrate-grid (ADD ATTRIBUTES/ALIASES TO OBJECTS?)
    // BUILD LOGIC INTO addPopups FUNCTION ?
    addGridPopups();
  }

  function interpolate (input, gridType, attr, distDecay, cellSize) {
    var options = {
      gridType: gridType,
      property: attr,
      weight: distDecay,
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
    console.log('regressionEquation:', regressionEquation);

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
    console.log('rSquared:', rSquared);

    var stanDev = ss.sampleStandardDeviation(residuals);

    // value < breaks[0] (< -2 stanDev)
    // breaks[0] <= value <= breaks[1] (-2 stanDev <= value <= -1 standDev)
    // breaks[1] <= value <= breaks[2] (-1 stanDev <= value <= 1 standDev)
    // breaks[2] <= value <= breaks[3] (1 stanDev <= value <= 2 standDev)
    // value > breaks[3] (value > 2 standDev)
    regressionLayers.forEach(function (l) {
      if (l.id === 'residuals') {
        l.breaks = [parseFloat((-2 * stanDev).toFixed(4)), parseFloat((-1 * stanDev).toFixed(4)), parseFloat(stanDev.toFixed(4)), parseFloat((2 * stanDev).toFixed(4))];
        // l.breaks = [parseFloat((-1.5 * stanDev).toFixed(4)), parseFloat((-1 * stanDev).toFixed(4)), parseFloat((-0.5 * stanDev).toFixed(4)), parseFloat((0.5 * stanDev).toFixed(4)), parseFloat(stanDev.toFixed(4)), parseFloat((1.5 * stanDev).toFixed(4))];
        console.log(l.id + ' breaks:', l.breaks);
      }
    });
  }

  function mapGrid (layerName, sourceName, attr, visibility, breaks, colors) {
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
        visibility: visibility
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
    }, 'tracts'); // place under tracts, so tracts will render above grid if decide to enable tracts checkbox after submit

    map.addLayer({
      id: lineLayerName,
      type: 'line',
      source: sourceName,
      layout: {
        visibility: visibility
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
    }, 'tracts'); // place under tracts, so tracts will render above grid if decide to enable tracts checkbox after submit
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
})();
