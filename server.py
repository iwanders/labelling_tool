#!/usr/bin/env python3

# The MIT License (MIT)
# Copyright (c) 2018 Ivor Wanders
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import cherrypy
import os
import sys
import json
import glob
import yaml
import copy
import argparse
import io


curdir = os.path.join(os.getcwd(), os.path.dirname(__file__)) 

# https://stackoverflow.com/a/36584863
def extend_dict(extend_me, extend_by):
    if isinstance(extend_by, dict):
        for k, v in extend_by.items():
            if k in extend_me:
                extend_dict(extend_me.get(k), v)
            else:
                extend_me[k] = v
    else:
        extend_me += extend_by

class Image:
    """
        Simple class to represent a single image.
    """
    def __init__(self, path, sidecar_path, config):
        """Initialise an image given the path and the configuration that was created for this entry."""
        self.config = config
        self.path = path
        self.data_path = sidecar_path[0:sidecar_path.rindex(".")] + ".json"

    def __repr__(self):
        return "<{} - ({})>".format(self.path, ", ".join([x["label"] for x in self.config["classes"]]))

    def get_info(self):
        """Return a dictionary representing the information about this image."""
        return {"path":self.path, "config":self.config}

    def get_mime(self):
        mimes = {
            "png": "image/png",
            "jpg": "image/jpg",
            "jpeg": "image/jpeg"
        }
        return mimes[self.path[self.path.rindex('.')+1:].lower()]

    def get_data(self):
        """Gets the raw bytes that represent the image data."""
        with open(self.path, "rb") as f:
            return f.read()

    def save_features(self, features):
        """Write the features for this image to the disk."""
        directory_name = os.path.dirname(self.data_path)
        os.makedirs(directory_name, exist_ok=True)
        with open(self.data_path, "w") as f:
            json.dump(features, f)

    def get_features(self):
        """Attempt to get the features for this image from the disk."""
        try:
            if os.path.isfile(self.data_path):
                with open(self.data_path, "r") as f:
                    return json.load(f)
            else:
                return None
        except json.decoder.JSONDecodeError as e:
            print("Huge problem, failed to decode json: {}".format(str(e)))
        return None

    def __lt__(self, a):
        return self.path < a.path

class Data:
    def __init__(self, data_path, sidecar_path):
        self.data_path = data_path
        self.sidecar_path = sidecar_path
        self.update_data()

    @staticmethod
    def data_loader(data_path, sidecar_path, context):
        """
            Recursive functions that combines yaml files from each directory into one context that specifies classes.
            If it encounters a data file it creates an Image object with the current context.
        """
        entries = []
        print(f"loading data {data_path}  sidecar: {sidecar_path}")

        # first, we parse the yaml files in the sidecar directories.
        yamlfiles = glob.glob(os.path.join(sidecar_path, "*.yaml"))
        for yaml_fname in yamlfiles:
            print("Yamlfile: {}".format(yaml_fname))
            yaml_path = os.path.join(yaml_fname)
            with open(yaml_path, 'r') as f:
                try:
                    # we combine the current context with the yaml we load.
                    extend_dict(context, yaml.safe_load(f))
                except yaml.YAMLError as exc:
                    print("Failed parsing {}: {}".format(yaml_path, selfexc))

        # then we parse the data files in this directory.
        for content_fname in sorted(glob.glob(os.path.join(data_path, "*.*"))):
            relative = os.path.relpath(content_fname, data_path)
            if (content_fname.endswith("yaml") or content_fname.endswith("json")):
                continue
            # csv files contain a list of paths to image files to be loaded
            elif content_fname.endswith("csv"):
                with open(os.path.join(content_fname), 'r') as list_file:
                    for filename in list_file:
                        entries.append(Image(filename.strip(), filename.strip(), context))
            else:
                image_sidecar_path = os.path.join(sidecar_path, relative)
                entries.append(Image(content_fname, image_sidecar_path, context))

        # finally, we iterate down, copying the context.
        for root, dirs, files in os.walk(data_path):
            for d in sorted(dirs):
                combined = os.path.join(root, d)
                relative = os.path.relpath(combined, data_path)
                final_sidecar = os.path.join(sidecar_path, relative)
                entries.extend(Data.data_loader(combined, final_sidecar, copy.deepcopy(context)))
        return entries


    def data_extent(self):
        """Returns information about the extent of the data."""
        return {"entries":len(self.entries)}

    def update_data(self):
        """Updates the data object by traversing through the path again in search of yaml and data files."""
        self.entries = sorted(self.data_loader(self.data_path, self.sidecar_path, {"classes":[]}))
        print("Entries:")
        for index, img in enumerate(self.entries):
            print("{: >5d} {}".format(index, img))

    def entry_info(self, index):
        """Returns the info from a specific entry."""
        return self.entries[index].get_info()

    def entry_data(self, index):
        """Gets the mimetype and the data for the given entry."""
        entry = self.entries[index]
        return entry.get_mime(), entry.get_data()

    def save_features(self, index, features):
        """Saves features for this index."""
        self.entries[index].save_features(features)

    def get_features(self, index):
        """Retrieves features for this index."""
        return self.entries[index].get_features()

class Web(object):
    """
        This is the actual backend for the web interface. It's a very thin wrapper between Data and Image.
    """
    def __init__(self, data):
        self.data = data

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def info_data_extent(self):
        return self.data.data_extent()

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def entry_info(self, entry):
        return self.data.entry_info(int(entry))

    @cherrypy.expose
    def entry_data(self, entry):
        mime, data = self.data.entry_data(int(entry))
        cherrypy.response.headers['Content-Type'] = mime
        buffer = io.BytesIO(data)
        return cherrypy.lib.file_generator(buffer)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def entry_save_features(self, *args, **kwargs):
        input_json = cherrypy.request.json
        entry = input_json["entry"]
        features = input_json["features"]
        self.data.save_features(entry, features)
        return {}

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def entry_features(self, entry):
        return self.data.get_features(int(entry))

def start_classification_server(http_port, http_host, data):
    # set cherrypy configuration.
    cherrypy.config.update({"server.socket_port": http_port})
    cherrypy.config.update({"server.socket_host": http_host})

    web_root = Web(data)

    cherrypy.quickstart(web_root, "/", config={
        "/": {"tools.staticdir.on": True,
                "tools.staticdir.dir": os.path.join(curdir, "static"),
                "tools.staticdir.index": "index.html",
                'tools.staticdir.content_types' : {
                    'js': 'application/javascript;charset=utf-8', 
                    'css': 'text/css;charset=utf-8', 
                    'html': 'text/html;charset=utf-8'} # utf8 necessary for ol.
                },
        })


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Classification server webinterface.")
    parser.add_argument('--port', '-p',
                        help="The port used to listen.",
                        type=int,
                        default=8080)
    parser.add_argument('--host', '-l',
                        help="The interface on which to listen.",
                        type=str,
                        default="127.0.0.1")
    parser.add_argument('--dir', '-d', help="Folder which holds the to be labelled data.", type=str,
                        default=os.path.join(curdir, "label_test"))
    parser.add_argument('--sidecar', '-s', help="Folder where the sidecar files and label information is present, defaults to '--dir'.", default=None)

    args = parser.parse_args()
    print("Traversing data folder in search of data.")
    data_dir = args.dir
    sidecar_dir = args.dir if args.sidecar is None else args.sidecar
    data = Data(args.dir, sidecar_dir)
    print("Found {} entries.".format(len(data.entries)))
   
    start_classification_server(args.port, args.host, data)
