# Labelling Tool


[Labelling Tool](https://github.com/iwanders/labelling_tool), a tool to annotate images by drawing polygons on them. It uses a webinterface as frontend and a very thin Python server as backend.

![Screenshot labelling tool](/../master/screenshot.png "A screenshot of the webinterface.")


## Data Structure / Concept

The current backend recursively reads through the data directory, the label specification (and any other config) is read from yaml files, information from yaml files in a folder propagates down to its subfolders. Whenever an image is encountered the configuration as constructed up to that point is associated to it. The entries are ordered by path.

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

Running the webserver with `./server.py` hosts the frontend on [http://localhost:8080](http://localhost:8080), images are selected by numeric id. All changes made in the UI are immediately send to the server process which writes the updated json to disk. 


## Help

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
 - Keyboard shortcuts are show in the UI in parenthesis.

## Segment Anything Model
The Python segment anything backend uses the official `segment_anything` package. The UI detects whether the SAM backend is running on the same hostname but on port `8081`, if it finds the backend, the UI shows the SAM control bar. If it doesn't this control bar is hidden.

The requests to the backend contain the entire image, so this makes the SAM backend completely independent from the `server.py` process and it does not need to know where the images are on the disk. This does mean that a lot of data is exchanged between the frontend and the SAM backend.

Setup:
  - Download `vit_b` checkpoint from [here](https://github.com/facebookresearch/segment-anything/blob/6fdee8f2727f4506cfbbe553e23b895e27956588/README.md#model-checkpoints).
  - `cd segment_backend_py`
  - `pip install -r requirements.txt`
  - `SAM_PTH=/path/to/sam_vit_b_01ec64.pth ./backend.py host` to run the backend.

It is also possibly to run the SAM steps from the commandline with `./backend.py sam --help` and output the mask to a file.

Points (foreground and background) points can be created by clicking the 'point' tool from the edit bar. Whenever the points are changed, a request is fired off to the backend. The backend checks if this is the same image as previously, if it is it reuses the previously calculated embeddings, else it calculates them. The return from the SAM backend contains a set of proposed contours, in the UI there's a slider to select only the first 'n' largest polygons. To convert the proposal to actual labels press the convert button in the SAM bar, this changes the proposal over to a real label and removes the current SAM points.



## Misc

Sample images provided by [xkcd](https://xkcd.com/).

License is MIT.

