
var Control = function ()
{
};

Control.prototype.init = function(static_layer, edit_layer, map, projection)
{
  var self = this;
  this.static_layer = static_layer;
  this.edit_layer = edit_layer;
  this.map = map;
  this.projection = projection;
  this.current = 1;

  self.entry_info = {config:{classes:[]}};
  self.entry_current_label = "";
  self.entry_shown = new Set([]);
  self.entry_addition_type = "unknown";
  self.entry_labels = {};
  self.entry_features = [];  // always holds the current features.

  $.getJSON( "info_data_extent", function( data ) {
    console.log("Info data extent!");
    self.info_data_extent = data;
    self.updateInfoBox();
    self.setEntry(1);
  });

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

  // Hook map entries.
  this.edit_layer.setStyle(function(feature, view_res)
    {
      return self.layerStyleFunction(feature, view_res, 3);
    });

  // patch ourselves into the interactions.
  self.map.getInteractions().forEach(function (el, i, arr)
  {
    console.log(el);
    if ((el instanceof ol.interaction.Draw) || el instanceof ol.interaction.DrawRegular)
    {
      el.on('drawend', function(e) {
        console.log("draw end!!");
        console.log(e);
        e.feature.setProperties({
          'label': self.entry_addition_type
        })
        self.entry_features.push(e.feature);
        console.log(e.feature, e.feature.getProperties());
        setTimeout(function(){ self.saveFeatures(e); }, 10);  // needs small delay to get out of drawend processing.
      });
    }
    if ((el instanceof ol.interaction.ModifyFeature))
    {
      console.log("Hooking");
      el.on('modifyend', function(e)
      {
        self.saveFeatures(e);
      });
    }
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
        setTimeout(function(){ self.saveFeatures(event); }, 10);  // needs small delay to get out of drawend processing.
      });
    }
  });
};

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

Control.prototype.nextClick = function()
{
  var self = this;
  console.log("Next clicked");
  self.setEntry(self.current + 1);
};

Control.prototype.prevClick = function()
{
  var self = this;
  self.setEntry(self.current - 1);
};

Control.prototype.getEntry = function()
{
  return this.current - 1;
}

Control.prototype.setEntry = function (entry)
{
  var self = this;
  var correct_entry = Math.max(1, Math.min(entry, this.info_data_extent.entries));  // enforce sanity.
  this.current = correct_entry;
  console.log("Going to: " + this.current);
  $("#info_entry_current").val(this.current);
  // grab entry info.
  $.getJSON( "entry_info", {entry:self.getEntry()}, function( data ) {
    console.log("entry_info!");
    console.log(data)
    self.entry_info = data;

    // update the image.
    self.setStaticImage("entry_data?entry=" + (self.getEntry()));

    // Update the label handler.
    self.updateAvailableLabels();
  });
  self.loadFeatures();
}

Control.prototype.setStaticImage = function(img_path)
{
  var self = this;
  // Use browser to create the size and width of the image... xD
  // https://stackoverflow.com/a/626505
  var img = new Image();
  img.onload = function() {
    console.log(this.width + 'x' + this.height);
    self.projection.setExtent([0, 0, this.width, this.height]);
    self.static_layer.setSource(new Static({
      url: img_path,
      projection: self.projection,
      imageExtent: [0, 0, this.width, this.height]
    }));
    self.map.getView().fit([0, 0, this.width, this.height], self.map.getSize()); 
    //  self.map.getView().fit([0, 0, this.width, this.height], { constrainResolution: false });
  }
  img.src = img_path;   // load the image, then when that's done update the map now that we know the resolution.
};

Control.prototype.updateAvailableLabels = function ()
{
  var self = this;
  var labels = $("#labels");
  labels.text(""); // clear current labels.

  self.entry_shown = new Set([]);
  self.entry_labels = {};
  $.each(self.entry_info["config"]["classes"], function (index, entry) {
    var label = entry.label;
    var button = $('<input type="button" class="label" value="' + label + '" style="background-color: #' + entry.color + '" />');

    self.entry_labels[label] = entry;  // add thsi entry to the current entry labels.
    self.entry_shown.add(label);  // show by default.
    button.contextmenu(function(event) {
      if (self.entry_current_label == label)  // if editable, don't allow changing visibilify
      {
        event.preventDefault();
        return;
      }
      if (self.entry_shown.has(label))
      {
        self.entry_shown.delete(label);
        button.addClass( "hidden" );
      }
      else
      {
        self.entry_shown.add(label);
        button.removeClass( "hidden" );
      }
      event.preventDefault();
      console.log(self.entry_shown);
      self.updateLayers();
    });


    button.click(function (event)
    {
      self.entry_addition_type = label;
      self.entry_current_label = label;  // This is the new addition type we'll do.
      self.entry_shown.add(label);
      button.removeClass( "hidden" );
      // remove all editable labels.
      $(".info .label.editable").each( function (i, entry)
      {
        $(entry).removeClass( "editable" );
      });
      // Add the editable label to this one.
      button.addClass( "editable" );
      event.preventDefault();
      console.log(self.entry_current_label);

      self.updateLayers();
    });
    labels.append(button);

    if (index == 0)
    {
      console.log("whehee");
      button.click();
    }
  });
}


Control.prototype.updateLayers = function()
{
  var self = this;
  // Put the editable layers into the self.edit_layer
  // Style edit layer.

  var already_shown = new Set(self.edit_layer.getSource().getFeatures());

  self.edit_layer.getSource().clear();

  // Move anything that's not in editable to fixed.
  for (let feature of self.entry_features)
  {
    var label_type = feature.getProperties()["label"];
    if ((self.entry_current_label == label_type) || self.entry_shown.has(label_type))  // should be editable.
    {
      self.edit_layer.getSource().addFeature(feature);
    }
  }
  console.log("entry_shown: ", self.entry_shown);
}

Control.prototype.layerStyleFunction = function(feature, view_res, border_width)
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
    // Return style.
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: stroke_color,
        width: border_width
      }),
      fill: new ol.style.Fill({
        color: fill_color,
      })
    });
  }
  else
  {
    console.log("Unknown label: " + label_type + " returning pretty gray :( ");
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: 'gray',
        width: border_width
      }),
      fill: new ol.style.Fill({
        color: 'rgba(128, 128, 128, 0.1)'
      })
    });
  }
}


Control.prototype.loadFeatures = function ()
{
  var self = this;
  self.entry_features = [];
  this.edit_layer.getSource().clear();
  //  entry_features
  // grab entry info.
  $.getJSON( "entry_features", {entry: self.getEntry()}, function( data ) {
    console.log("entry_features!");
    console.log(data)
    if (data != undefined)
    {
      self.entry_features = ((new ol.format.GeoJSON()).readFeatures(data));
      //  self.edit_layer.getSource().addFeatures(self.entry_features);
    }
    self.updateLayers()
  });
}

Control.prototype.saveFeatures = function (event)
{
  var self = this;
  // Post all the features to the server!
  var writer = new ol.format.GeoJSON();
  var geojson_str = writer.writeFeaturesObject(self.entry_features, {rightHanded:true});
  console.log(geojson_str);
  console.log(self.current);
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
