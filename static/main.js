

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

  $.getJSON( "entry_info", {entry:this.current - 1}, function( data ) {
    console.log("entry_info!");
    console.log(data)
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
    }
    img.src = img_path;
  });
}



