Labelling Tool
==============

[Labelling Tool](https://github.com/iwanders/labelling_tool), a tool to annotate images by drawing polygons on them. It uses a webinterface as frontend and a very thin Python server as backend.

![Screenshot labelling tool](/../master/screenshot.png "A screenshot of the webinterface.")

Data Structure
--------------
The current backend recursively reads through the data directory.

The label specification (and any other config) is read from yaml files, information from yaml files in a folder propagates down to its subfolders. Whenever an image is encountered the configuration as constructed up to that point is associated to it. The entries are ordered by path.

The yaml format has the following entries:
```yaml
attributions: '© <a href="http://xkcd.com/license.html">xkcd</a>'  # optional entry, sets the attribution field for the map.
classes:  # list of clasess, configurations in subdirs will be appended.
  - label: anything  # the name of the label, this will be associated to the features.
    description: This root specifies you can label anything.  # a mouseover description of the label.
    color: 4CAF50  # The color this label should use.
```
See the `label_test` folder for an example on how to use this.

The tool will save labels in a `.json` sidecar file with the same name as each image. The content of which is created by OpenLayers' GeoJSON export:

```json
{"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[12.5, 382.75], [28, 331.75], [104.5, 342.25], [107, 388.25], [12.5, 382.75]]]}, "properties": {"label": "math"}}]}
```

The dataset may be disjoint from the label specification and sidecar files by passing the `--sidecar` argument. By default label files and sidecar data is inside the data directory.


Help
----
 - Available labels per entry are shown on the right.
 - The currently selected label type has a thick border, new polygons will be of this type. Select the active type by left clicking on the labels.
 - Right click on other labels to hide them from the view.
 - Use the select tool from the toolbar to modify a polygon.
 - Delete vertices of a polygon by selecting the polygon and rightclicking vertices.
 - Delete polygons by selecting them with shift-click and pressing delete on the keyboard or the X from the control bar.
 - Change type of a polygon by selecting them and left clicking a label.
 - Undo and redo changes with ctrl+z and ctrl+y or from the control bar, this is an experimental feature from ol-ext.
 - While drawing a polygon use ctrl+z or ctrl+rightclick to remove the previously inserted point.
 - Close new polygons quickly with doubleclick. Use ctrl+z to remove the last placed control point while drawing.
 - Try the dropdown for some options... :)

Segment Anything
----------------
The Python segment anything backend uses the official `segment_anything` package, only positive points can be added.


The `segment_backend_rs` directory holds a simple backend server that runs the Segment Anything model through candle, this currently produces different results than the python implementation.

Start it with `cargo r --features=cuda --release`, after which segmentation masks can be created from the points in the current category.

If the segmentation backend is not running this functionality is hidden.

Misc
----
This label tool makes use of the following libraries:

 - [OpenLayers 5](https://openlayers.org/)
 - [Open Layers Ext (ol-ext)](https://github.com/Viglino/ol-ext)
 - [CherryPy](https://cherrypy.org/)

Sample images provided by [xkcd](https://xkcd.com/).

This labelling tool is written by Ivor Wanders and <a href="https://github.com/iwanders/labelling_tool">available</a> under MIT license.

