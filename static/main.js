
var Control = function ()
{
};

Control.prototype.init = function(static_layer, edit_layer, map, projection, undo_interaction)
{
  var self = this;
  this.static_layer = static_layer;
  this.edit_layer = edit_layer;
  this.map = map;
  this.projection = projection;
  this.undo_interaction = undo_interaction;

  this.current = 1;  // current entry from the backend.

  this.selecting_interactions = [];  // interactions that can select features.
  this.delete_vertex_interactions = [];

  // Hook keydown such that we can do ctrl+z and delete of vertices
  document.addEventListener('keydown', function (event)
  {
    self.deletePressed(event);
  }, false);

  self.entry_info = {config:{classes:[]}};
  self.entry_shown = new Set([]);  // currently shown classes
  self.entry_current_label = "unknown";  // the current label we'll add.
  self.entry_labels = {};    // holds all labels that we know for this entry.
  self.entry_features = [];  // always holds the current features.

  // Retrieve the max entry index from the backend.
  $.getJSON( "info_data_extent", function( data ) {
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

  // Set the map style function.
  this.edit_layer.setStyle(function(feature, view_res)
  {
    return self.layerStyleFunction(feature, view_res);
  });

  // Patch ourselves into the interactions.
  self.map.getInteractions().forEach(function (el, i, arr)
  {
    if ((el instanceof ol.interaction.Draw) || el instanceof ol.interaction.DrawRegular)
    {
      // Need to hook draw end to set the label.
      el.on('drawend', function(e) {
        e.feature.setProperties({
          'label': self.entry_current_label
        })
        self.entry_features.push(e.feature);
        self.deferedSave();
      });
    }

    // Need to hook modify to save.
    if ((el instanceof ol.interaction.ModifyFeature))
    {
      //  delete_vertex_interactions.
      self.delete_vertex_interactions.push(el);

      el.on('modifyend', function(e)
      {
        self.saveFeatures(e);
      });
    }
    // Need to hook delete because we need to discard this from the feature list.
    if (el instanceof ol.interaction.Delete)
    {
      el.on("deleteend", function (event)
      {
        event.features.forEach(function (el, i, arr)
        {
          var index = self.entry_features.indexOf(el);
          if (index > -1) {
            self.entry_features.splice(index, 1);
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
      console.log(arr);
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
  });

  // Load the features from the server.
  self.loadFeatures();
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
    var button = $('<input type="button" class="label button" value="' + label + '" style="background-color: #' + entry.color + '" />');

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
      for (let feature of self.getSelectedFeatures())
      {
        feature.setProperties({
          'label': self.entry_current_label
        });
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
  self.entry_features = [];  // clear currently known features

  // Request new features from the server.
  $.getJSON( "entry_features", {entry: self.getEntry()}, function( data ) {
    console.log("entry_features:", data);
    if (data != undefined)
    {
      self.entry_features = (new ol.format.GeoJSON()).readFeatures(data);
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
  var geojson_str = writer.writeFeaturesObject(self.entry_features, {rightHanded:true});
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

  if(event.keyCode == 46)
  {
    console.log("Delete key, trying to remove a vertex.");
    for (let interaction of this.delete_vertex_interactions)
    {
      interaction.removePoint();
      self.deferedSave();
    }
  }
  if ((event.keyCode == 90) && (event.ctrlKey))  // ctrl + z
  {
    this.undo_interaction.undo();
    self.deferedSave();
  }
  if ((event.keyCode == 89) && (event.ctrlKey))  // ctrl + y
  {
    this.undo_interaction.redo();
    self.deferedSave();
  }
}
