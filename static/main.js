
var Control = function ()
{
};

Control.prototype.init = function(static_layer, vector_layer, map, projection)
{
  var self = this;
  this.static_layer = static_layer;
  this.vector_layer = vector_layer;
  this.map = map;
  this.projection = projection;
  this.current_labels = [];
  self.entry_info = {config:{classes:[]}};
  self.entry_editable = new Set([]);
  self.entry_shown = new Set([]);

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

Control.prototype.setEntry = function (entry)
{
  var self = this;
  var correct_entry = Math.max(1, Math.min(entry, this.info_data_extent.entries));  // enforce sanity.
  this.current = correct_entry;
  console.log("Going to: " + this.current);
  $("#info_entry_current").val(this.current);

  // grab entry info.
  $.getJSON( "entry_info", {entry:this.current - 1}, function( data ) {
    console.log("entry_info!");
    console.log(data)
    self.entry_info = data;

    // update the image.
    var img_path = "entry_data?entry=" + (self.current - 1);
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


    // Update the label handler.
    self.updateAvailableLabels();
  });
}

Control.prototype.updateAvailableLabels = function ()
{
  var self = this;
  var labels = $("#labels");
  labels.text(""); // clear current labels.
  var previous_editable = self.entry_editable

  self.entry_editable = new Set([]);
  self.entry_shown = new Set([]);

  var selected_editable = false;

  $.each(self.entry_info["config"]["classes"], function (index, entry) {
    var label = entry.label;
    var button = $('<input type="button" class="label" value="' + label + '" style="background-color: #' + entry.color + '" />');

    self.entry_shown.add(label);  // show by default.
    button.contextmenu(function(event) {
      if (self.entry_editable.has(label))  // if editable, don't allow changing visibilify
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
    });


    button.click(function (event)
    {
      self.entry_editable = new Set([label]);  // allow just one editable.
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
      console.log(self.entry_editable);
    });
    labels.append(button);

    // If it was previously editable, set it in this update as well...
    if (previous_editable.has(label))
    {
      button.click();
    }
  });
}


