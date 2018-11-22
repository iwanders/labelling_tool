/*
  The MIT License (MIT)
  Copyright (c) 2018 Ivor Wanders
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
*/

var Control = function ()
{
};

/**
 * @brief init function that registers all callbacks and initialises state variables.
 */
Control.prototype.init = function(static_layer, edit_layer, map, projection, undo_interaction, colorize_filter)
{
  var self = this;
  this.static_layer = static_layer;
  this.edit_layer = edit_layer;
  this.map = map;
  this.projection = projection;
  this.undo_interaction = undo_interaction;
  this.colorize_filter = colorize_filter;

  this.current = 1;  // current entry from the backend.

  this.selecting_interactions = [];  // interactions that can select features.
  this.delete_vertex_interactions = [];
  this.drawing_interactions = [];
  this.draw_active = false;

  // Hook keydown such that we can do ctrl+z, delete and ctrl+y
  document.addEventListener('keydown', function (event)
  {
    self.deletePressed(event);
  }, false);

  // Hook rightclick for removal of vertices.
  this.map.getViewport().addEventListener('contextmenu', function (e) {
    self.rightClicked(e);
    e.preventDefault();
  });

  self.entry_info = {config:{classes:[]}};
  self.entry_shown = new Set([]);  // currently shown classes
  self.entry_current_label = "unknown";  // the current label we'll add.
  self.entry_labels = {};    // holds all labels that we know for this entry.
  self.entry_features = new Set([]);  // always holds the current features.

  // Retrieve the max entry index from the backend.
  $.getJSON("info_data_extent", function( data ) {
    self.info_data_extent = data;
    self.updateInfoBox();
    self.setEntry(1);
  });

  // Bind forwards / backwards buttons.
  $("#info_next").click(function (event)
  {
    self.nextClick();
    event.preventDefault();
  });

  $("#info_prev").click(function (event)
  {
    self.prevClick();
    event.preventDefault();
  });

  $("#filter").change(function(event)
  {
    self.changeFilter(event);
  });

  // Set the map style function.
  this.edit_layer.setStyle(function(feature, view_res)
  {
    return self.layerStyleFunction(feature, view_res);
  });

  // Patch ourselves into the interactions.
  self.map.getInteractions().forEach(function (el, i, arr)
  {
    console.log(el);
    if ((el instanceof ol.interaction.Draw) || el instanceof ol.interaction.DrawRegular)
    {
      // Need to hook draw end to set the label.
      el.on('drawend', function(e) {
        e.feature.setProperties({
          'label': self.entry_current_label
        })
        self.entry_features.add(e.feature);
        self.deferedSave();
        self.draw_active = false;
      });
      if ((el instanceof ol.interaction.Draw))
      {
        self.drawing_interactions.push(el);
        el.on('drawstart', function(e) {
          self.draw_active = true;
        });
      }
    }

    // Need to hook modify to save.
    if ((el instanceof ol.interaction.ModifyFeature))
    {
      //  delete_vertex_interactions.
      self.delete_vertex_interactions.push(el);

      el.on('modifyend', function(e)
      {
        self.deferedSave();
      });

      // Hook the condition for deleting vertices.
      // https://stackoverflow.com/a/50755862
      el._condition = function(e)
      {
        // Check if there is a feature to select
        var f = this.getMap().getFeaturesAtPixel(e.pixel,
          {
            hitTolerance:5
          });
        if (f)
        {
          var p0 = e.pixel;
          var p1 = f[0].getGeometry().getClosestPoint(e.coordinate);
          p1 = this.getMap().getPixelFromCoordinate(p1);
          var dx = p0[0]-p1[0];
          var dy = p0[1]-p1[1];
          if (Math.sqrt(dx*dx+dy*dy) > 8) {
            f = null;
          }
        }
        return true;
      };
    }
    // Need to hook delete because we need to discard this from the feature list.
    if (el instanceof ol.interaction.Delete)
    {
      el.on("deleteend", function (event)
      {
        event.features.forEach(function (el, i, arr)
        {
          if (self.entry_features.has(el))
          {
            self.entry_features.delete(el);
          }
        });
        self.deferedSave();
      });
    }

    // Need selecting interactions to be able to switch labels on selected polygons.
    if (el instanceof ol.interaction.Select)
    {
      self.selecting_interactions.push(el);
    }

    // Need to hook transform to ensure we save.
    if (el instanceof ol.interaction.Transform)
    {
      el.on('rotateend', function(e)
      {
        self.deferedSave();
      });
      el.on('translateend', function(e)
      {
        self.deferedSave();
      });
      el.on('scaleend', function(e)
      {
        self.deferedSave();
      });
    }
    if (el instanceof ol.interaction.UndoRedo)
    {
      el.on("undo", function(e)
      {
        console.log(e);
        // On undo, if it was a remove feature, we need to add it back to the feature list.
        if (e.action.type == "removefeature")
        {
          self.entry_features.add(e.action.feature);
        }
        if (e.action.type == "addfeature")
        {
          self.entry_features.delete(e.action.feature);
        }
      });
      el.on("redo", function(e)
      {
        // On redo we have to remove the feature.
        if (e.action.type == "removefeature")
        {
          self.entry_features.delete(e.action.feature);
        }
        if (e.action.type == "addfeature")
        {
          self.entry_features.add(e.action.feature);
        }
      });
    }
  });
};

/**
 * @brief Returns a flat array of the features that are currently selected.
 */
Control.prototype.getSelectedFeatures = function ()
{
  var selectees = [];
  for (let interaction of this.selecting_interactions)
  {
    interaction.getFeatures().forEach( function (el, i, arr)
    {
      selectees.push(el);
    });
  }
  return selectees;
}

/**
 * @brief Deselects features of a certain type.
 */
Control.prototype.deselect = function (deselect_labeltype)
{
  for (let interaction of this.selecting_interactions)
  {
    var features = interaction.getFeatures();
    features.forEach( function (feature, i, arr)
    {
      var label_type = feature.getProperties()["label"];
      if ((label_type == deselect_labeltype) || (deselect_labeltype == undefined))
      {
        features.removeAt(i);
      }
    });
  }
}

/**
 * @brief Updates the info box html with the current information regarding the info box.
 */
Control.prototype.updateInfoBox = function()
{
  var self = this;
  console.log(self.info_data_extent);
  $("#info_entry_current").attr({
     "max" : self.info_data_extent.entries,
     "min" : 1
  });
  $("#info_entry_current").change(function (event)
  {
    self.setEntry($("#info_entry_current").val());
  });
  $("#info_entry_count").text(self.info_data_extent.entries);
};

//! Advance the current entry index.
Control.prototype.nextClick = function()
{
  var self = this;
  console.log("Next clicked");
  self.setEntry(self.current + 1);
};

//! Rewind the current entry index.
Control.prototype.prevClick = function()
{
  var self = this;
  self.setEntry(self.current - 1);
};

//! Get the current entry number as it would be on the backend.
Control.prototype.getEntry = function()
{
  return this.current - 1;
}

/**
 * @brief Set the current entry index.
 */
Control.prototype.setEntry = function (entry)
{
  var self = this;
  var correct_entry = Math.max(1, Math.min(entry, this.info_data_extent.entries));  // enforce sanity.
  this.current = correct_entry;
  self.deselect();

  // Update the html value.
  $("#info_entry_current").val(this.current);

  // grab entry info from the backend
  $.getJSON( "entry_info", {entry:self.getEntry()}, function( data ) {
    console.log("entry_info:", data)
    self.entry_info = data;

    // update the image.
    self.setStaticImage("entry_data?entry=" + (self.getEntry()));

    // Update the label handler.
    self.updateAvailableLabels();

    // Load the features from the server.
    self.loadFeatures();
  });

}

Control.prototype.setStaticImage = function(img_path)
{
  var self = this;
  // Use browser to create the size and width of the image... xD
  // https://stackoverflow.com/a/626505
  var img = new Image();
  img.onload = function() {
    // When load is finished, create the new static layer.
    console.log("Image to be loaded is: " + this.width + 'x' + this.height);
    self.projection.setExtent([0, 0, this.width, this.height]);
    var layer_attributions = undefined;
    if (self.entry_info["config"]["attributions"])
    {
      layer_attributions = self.entry_info["config"]["attributions"];
    }
    self.static_layer.setSource(new Static({
      url: img_path,
      projection: self.projection,
      imageExtent: [0, 0, this.width, this.height],
      attributions: layer_attributions
    }));
    self.map.getView().fit([0, 0, this.width, this.height], self.map.getSize()); 
  }
  img.src = img_path;   // load the image, then when that's done update the map now that we know the resolution.
};

/**
 * @brief Update the available labels in the top right and bind functions to them.
 */
Control.prototype.updateAvailableLabels = function ()
{
  var self = this;
  var labels = $("#labels");
  labels.text(""); // clear current labels.

  self.entry_shown = new Set([]);
  self.entry_labels = {};
  if (self.entry_info["config"]["classes"] == undefined)
  {
    return;
  }
  $.each(self.entry_info["config"]["classes"], function (index, entry) {
    var label = entry.label;
    var title = entry.description;
    if (title == undefined)
    {
      title = "";
    }
    var button = $('<input type="button" class="label button" title="' + title + '" value="' + label+ '" style="background-color: #' + entry.color + '"/>');

    self.entry_labels[label] = entry;  // add thsi entry to the current entry labels.
    self.entry_shown.add(label);  // show by default.

    // Right click
    button.contextmenu(function(event)
    {
      if (self.entry_current_label == label)  // if editable, don't allow changing visibility
      {
        event.preventDefault();
        return;
      }

      if (self.entry_shown.has(label))
      {
        self.deselect(label);  // deselecting all entries of this label, as we are hiding them.
        self.entry_shown.delete(label);
        button.addClass( "hidden" );
      }
      else
      {
        // We are showing an entry.
        self.entry_shown.add(label);
        button.removeClass( "hidden" );
      }
      event.preventDefault();

      // Make sure the layer represents this.
      self.updateLayers();
    });

    // left click
    button.click(function (event)
    {
      self.entry_current_label = label;  // This is the new addition type we'll do.

      // Be sure to show this entry.
      self.entry_shown.add(label);
      button.removeClass( "hidden" );

      // Remove all other editable labels.
      $(".info .label.editable").each( function (i, entry)
      {
        $(entry).removeClass( "editable" );
      });

      // Add the editable label to this one.
      button.addClass( "editable" );
      event.preventDefault();

      // If we had any selected components, switch their type;
      var selected_features = self.getSelectedFeatures();
      if (selected_features.length)
      {
        for (let feature of selected_features)
        {
          feature.setProperties({
            'label': self.entry_current_label
          });
        }
        self.deferedSave();
      }

      // Make sure the layer represents this.
      self.updateLayers();
    });
    labels.append(button);

    // By default, select the 0th index label.
    if (index == 0)
    {
      button.click();
    }
  });
}

/**
 * @brief Update the entries that can be shown on layers.
 */
Control.prototype.updateLayers = function()
{
  var self = this;

  // Clear the layer.
  self.edit_layer.getSource().clear();

  // Add the entries to the layer that we are interested in.
  for (let feature of self.entry_features)
  {
    var label_type = feature.getProperties()["label"];
    if (self.entry_shown.has(label_type))
    {
      self.edit_layer.getSource().addFeature(feature);
    }
  }
}

/**
 * @brief Function to style by the label associated to a feature.
 */
Control.prototype.layerStyleFunction = function(feature, view_res)
{
  var self = this;

  // Try to retrieve the color.
  var label_type = feature.getProperties()["label"];
  if (label_type in self.entry_labels)
  {
    var entry = self.entry_labels[label_type];
    var raw_color = ol.color.asArray("#" + entry.color);

    // Slice them to prevent tainting ol.color's internal tables.
    var stroke_color = raw_color.slice();
    stroke_color[3] = 0.3;
    var fill_color = raw_color.slice();
    fill_color[3] = 0.3;

    // Return the newly created style.
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: stroke_color,
        width: 3
      }),
      fill: new ol.style.Fill({
        color: fill_color,
      })
    });
  }
  else
  {
    console.log("Unknown label: " + label_type + " returning gray :( ");
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: 'gray',
        width: 3
      }),
      fill: new ol.style.Fill({
        color: 'rgba(128, 128, 128, 0.1)'
      })
    });
  }
}

/**
 * @brief Load features from the backend.
 */
Control.prototype.loadFeatures = function ()
{
  var self = this;
  self.entry_features = new Set([]);  // clear currently known features

  // Request new features from the server.
  $.getJSON( "entry_features", {entry: self.getEntry()}, function( data ) {
    if (data != undefined)
    {
      self.entry_features = new Set((new ol.format.GeoJSON()).readFeatures(data));
    }
    self.updateLayers();
  });
}

/**
 * @brief Save features to the backend.
 */
Control.prototype.saveFeatures = function (event)
{
  var self = this;
  // Post all the features to the server!
  var writer = new ol.format.GeoJSON();
  var geojson_str = writer.writeFeaturesObject(Array.from(self.entry_features), {rightHanded:true});
  $.ajax({
    type: "POST",
    url: "entry_save_features",
    data: JSON.stringify({entry: self.getEntry(), features:geojson_str}),
    dataType: 'JSON',
    contentType: 'application/json',
  }).fail(function() {
    alert( "Failed to submit data to the server, closing page will lose changes." );
  })
};

/**
 * @brief Perform a save a few milliseconds after the call. This allows finishing current work before save.
 */
Control.prototype.deferedSave = function ()
{
  var self = this;
  setTimeout(function(){ self.saveFeatures(event); }, 10);
}

/**
 * @brief Handler for key presses.
 */
Control.prototype.deletePressed = function (event)
{
  var self = this;

  if(event.keyCode == 46)  // Delete key, simulate 'click' on delete.
  {
    $(".ol-delete.ol-button button")[0].click();
  }
  if ((event.keyCode == 90) && (event.ctrlKey))  // ctrl + z
  {
    if (self.draw_active)
    {
      // If drawing, undo one point.
      for (let interaction of self.drawing_interactions)
      {
        interaction.removeLastPoint();
      }
      return;
    }
    this.undo_interaction.undo();
    self.deferedSave();
  }
  if ((event.keyCode == 89) && (event.ctrlKey))  // ctrl + y
  {
    this.undo_interaction.redo();
    self.deferedSave();
  }
}

/**
 * @brief Handler for right clicks on the map.
 */
Control.prototype.rightClicked = function(event)
{
  var self = this;
  if (self.draw_active && (event.button == 2) && (event.ctrlKey))
  {
    for (let interaction of self.drawing_interactions)
    {
      interaction.removeLastPoint();
    }
    return;
  }

  var have_selected = self.getSelectedFeatures().length;
  if (have_selected == 0)
  {
    return; // don't allow deletion if not selected, made for a confusing interaction.
  }
  for (let interaction of this.delete_vertex_interactions)
  {
    interaction.removePoint();
    self.deferedSave();
  }
}

/**
 * @brief Callback for the change filter dropdown.
 */
Control.prototype.changeFilter = function(event)
{
  var self = this;
  self.colorize_filter.setActive(false);

  var f = $("#filter").val();
  switch (f)
  {
    case 'disabled':
      self.colorize_filter.setActive(false);
      break;
    case 'grayscale':
    case 'invert':
    case 'sepia':
      self.colorize_filter.setActive(true);
      self.colorize_filter.setFilter(f);
      break;
  default:
    self.colorize_filter.setActive(true);
    self.colorize_filter.setFilter({
      operation:f,
      red: 255,
      green: 255,
      blue: 255, 
      value: 1.0,
    });
  break;

  }

}
